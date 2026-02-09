import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { SD } from 'technicalindicators';
import { Between, In, Repository } from 'typeorm';

import { AlgorithmActivationService } from './algorithm-activation.service';

import { Order, OrderStatus } from '../../order/order.entity';
import { toErrorInfo } from '../../shared/error.util';
import { AlgorithmPerformance } from '../algorithm-performance.entity';

/**
 * AlgorithmPerformanceService
 *
 * Calculates and manages performance metrics for algorithm activations.
 * Uses technicalindicators package for financial calculations.
 */
@Injectable()
export class AlgorithmPerformanceService {
  private readonly logger = new Logger(AlgorithmPerformanceService.name);

  constructor(
    @InjectRepository(AlgorithmPerformance)
    private readonly algorithmPerformanceRepository: Repository<AlgorithmPerformance>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly algorithmActivationService: AlgorithmActivationService
  ) {}

  /**
   * Calculate performance metrics for an algorithm activation
   * @param activationId - AlgorithmActivation ID
   * @returns Calculated AlgorithmPerformance record
   */
  async calculatePerformance(activationId: string): Promise<AlgorithmPerformance> {
    const activation = await this.algorithmActivationService.findById(activationId);

    // Fetch all filled and partially filled orders for this activation
    const orders = await this.orderRepository.find({
      where: {
        algorithmActivationId: activationId,
        status: In([OrderStatus.PARTIALLY_FILLED, OrderStatus.FILLED])
      },
      order: { transactTime: 'ASC' }
    });

    const totalTrades = orders.length;

    if (totalTrades === 0) {
      // Return empty performance metrics if no trades
      const performance = new AlgorithmPerformance({
        algorithmActivationId: activationId,
        userId: activation.userId,
        roi: 0,
        winRate: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        totalTrades: 0,
        riskAdjustedReturn: 0,
        volatility: 0,
        alpha: 0,
        beta: 0,
        rank: undefined,
        calculatedAt: new Date()
      });

      return await this.algorithmPerformanceRepository.save(performance);
    }

    // Calculate metrics
    const returns = this.calculateReturns(orders);
    const roi = this.calculateROI(orders);
    const winRate = this.calculateWinRate(orders);
    const maxDrawdown = this.calculateMaxDrawdown(returns);
    const volatility = this.calculateVolatility(returns);
    const sharpeRatio = this.calculateSharpeRatio(returns, volatility);
    const riskAdjustedReturn = sharpeRatio > 0 ? roi / sharpeRatio : 0;

    // Alpha and Beta would require benchmark data (e.g., BTC price)
    // For now, setting to 0 as we don't have benchmark implementation
    const alpha = 0;
    const beta = 0;

    const performance = new AlgorithmPerformance({
      algorithmActivationId: activationId,
      userId: activation.userId,
      roi: Number(roi.toFixed(2)),
      winRate: Number(winRate.toFixed(4)), // Decimal format (0.0-1.0)
      sharpeRatio: Number(sharpeRatio.toFixed(4)),
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      totalTrades,
      riskAdjustedReturn: Number(riskAdjustedReturn.toFixed(4)),
      volatility: Number(volatility.toFixed(4)),
      alpha: Number(alpha.toFixed(4)),
      beta: Number(beta.toFixed(4)),
      rank: undefined, // Will be set by calculateRankings()
      calculatedAt: new Date()
    });

    return await this.algorithmPerformanceRepository.save(performance);
  }

  /**
   * Calculate returns array from orders
   * @param orders - Array of orders
   * @returns Array of percentage returns
   */
  private calculateReturns(orders: Order[]): number[] {
    const returns: number[] = [];

    for (const order of orders) {
      if (order.gainLoss !== null && order.gainLoss !== undefined && order.cost) {
        const returnPct = (order.gainLoss / order.cost) * 100;
        returns.push(returnPct);
      }
    }

    return returns.length > 0 ? returns : [0];
  }

  /**
   * Calculate total ROI from orders
   * @param orders - Array of orders
   * @returns ROI percentage
   */
  private calculateROI(orders: Order[]): number {
    let totalInvested = 0;
    let totalReturns = 0;

    for (const order of orders) {
      const cost = order.cost || order.executedQuantity * order.price;
      const gainLoss = order.gainLoss || 0;

      totalInvested += cost;
      totalReturns += gainLoss;
    }

    return totalInvested > 0 ? (totalReturns / totalInvested) * 100 : 0;
  }

  /**
   * Calculate win rate (ratio of profitable trades)
   * @param orders - Array of orders
   * @returns Win rate as decimal (0.0-1.0), e.g., 0.65 = 65% win rate
   */
  private calculateWinRate(orders: Order[]): number {
    if (orders.length === 0) return 0;

    const profitableTrades = orders.filter((order) => order.gainLoss && order.gainLoss > 0).length;

    return profitableTrades / orders.length;
  }

  /**
   * Calculate maximum drawdown from returns
   * @param returns - Array of returns
   * @returns Maximum drawdown percentage
   */
  private calculateMaxDrawdown(returns: number[]): number {
    if (returns.length === 0) return 0;

    let peak = returns[0];
    let maxDrawdown = 0;
    let cumulativeReturn = 0;

    for (const ret of returns) {
      cumulativeReturn += ret;
      if (cumulativeReturn > peak) {
        peak = cumulativeReturn;
      }
      const drawdown = peak - cumulativeReturn;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * Calculate volatility using standard deviation from technicalindicators
   * @param returns - Array of returns
   * @returns Volatility (standard deviation)
   */
  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0;

    try {
      const result = SD.calculate({
        values: returns,
        period: returns.length
      });

      return result.length > 0 ? result[result.length - 1] : 0;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error calculating volatility: ${err.message}`);
      return 0;
    }
  }

  /**
   * Calculate Sharpe ratio (risk-adjusted return)
   * Sharpe Ratio = (Mean Return - Risk Free Rate) / Standard Deviation of Returns
   * @param returns - Array of returns
   * @param volatility - Volatility (standard deviation)
   * @param riskFreeRate - Risk-free rate (default 0)
   * @returns Sharpe ratio
   */
  private calculateSharpeRatio(returns: number[], volatility: number, riskFreeRate = 0): number {
    if (returns.length === 0 || volatility === 0) return 0;

    const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const excessReturn = meanReturn - riskFreeRate;

    return excessReturn / volatility;
  }

  /**
   * Calculate and update rankings for all user's algorithm activations
   * Uses composite scoring: 50% ROI + 30% algorithm weight + 20% risk-adjusted score
   * Allocates proportionally with clamping [0.5%, 10.0%]
   * @param userId - User ID
   */
  async calculateRankings(userId: string): Promise<void> {
    // Get all active activations for the user (includes algorithm relation)
    const activations = await this.algorithmActivationService.findUserActiveAlgorithms(userId);

    if (activations.length === 0) return;

    // Build activation ID → algorithm weight map
    const activationWeightMap = new Map<string, number>();
    for (const activation of activations) {
      activationWeightMap.set(activation.id, activation.algorithm?.weight ?? 5);
    }

    // Get latest performance for each activation in a single query
    const activationIds = activations.map((a) => a.id);
    const performanceRecords = await this.algorithmPerformanceRepository
      .createQueryBuilder('perf')
      .distinctOn(['perf.algorithmActivationId'])
      .where('perf.algorithmActivationId IN (:...activationIds)', { activationIds })
      .orderBy('perf.algorithmActivationId')
      .addOrderBy('perf.calculatedAt', 'DESC')
      .getMany();

    if (performanceRecords.length === 0) return;

    // Calculate composite scores
    const compositeScores = new Map<string, number>();
    let totalComposite = 0;

    for (const perf of performanceRecords) {
      const normalizedROI = Math.max(0, Math.min(((perf.roi || 0) + 100) / 200, 1));
      const algorithmWeight = activationWeightMap.get(perf.algorithmActivationId) ?? 5;
      const normalizedWeight = (algorithmWeight - 1) / 9;
      const riskAdjustedScore = perf.getRiskAdjustedScore();

      const composite = 0.5 * normalizedROI + 0.3 * normalizedWeight + 0.2 * riskAdjustedScore;
      compositeScores.set(perf.algorithmActivationId, composite);
      totalComposite += composite;
    }

    // Sort by composite score descending for rank assignment
    performanceRecords.sort(
      (a, b) =>
        (compositeScores.get(b.algorithmActivationId) || 0) - (compositeScores.get(a.algorithmActivationId) || 0)
    );

    // Budget = n × 2.0% (preserves current allocation magnitude)
    const budget = performanceRecords.length * 2.0;
    const minAllocation = 0.5;
    const maxAllocation = 10.0;

    // Compute raw proportional allocations
    const allocations = new Map<string, number>();
    for (const perf of performanceRecords) {
      const composite = compositeScores.get(perf.algorithmActivationId) || 0;
      let allocation: number;
      if (totalComposite === 0) {
        allocation = budget / performanceRecords.length;
      } else {
        allocation = (composite / totalComposite) * budget;
      }
      allocations.set(perf.algorithmActivationId, allocation);
    }

    // Iterative clamping with redistribution to preserve budget
    const frozen = new Set<string>();
    const maxIterations = performanceRecords.length + 1;
    for (let iter = 0; iter < maxIterations; iter++) {
      let surplus = 0;
      let unfrozenTotal = 0;
      let changed = false;

      for (const perf of performanceRecords) {
        const id = perf.algorithmActivationId;
        if (frozen.has(id)) continue;

        const alloc = allocations.get(id)!;
        if (alloc < minAllocation) {
          surplus += alloc - minAllocation; // negative (deficit)
          allocations.set(id, minAllocation);
          frozen.add(id);
          changed = true;
        } else if (alloc > maxAllocation) {
          surplus += alloc - maxAllocation; // positive (excess)
          allocations.set(id, maxAllocation);
          frozen.add(id);
          changed = true;
        } else {
          unfrozenTotal += alloc;
        }
      }

      if (!changed || surplus === 0 || unfrozenTotal === 0) break;

      // Redistribute surplus proportionally among unfrozen entries
      for (const perf of performanceRecords) {
        const id = perf.algorithmActivationId;
        if (frozen.has(id)) continue;
        const alloc = allocations.get(id)!;
        allocations.set(id, alloc + (alloc / unfrozenTotal) * surplus);
      }
    }

    // Save ranks and allocations
    for (let i = 0; i < performanceRecords.length; i++) {
      const rank = i + 1;
      const performance = performanceRecords[i];
      const allocationPercentage = allocations.get(performance.algorithmActivationId)!;

      // Update rank in performance record
      performance.rank = rank;
      await this.algorithmPerformanceRepository.save(performance);

      // Update activation allocation
      await this.algorithmActivationService.updateAllocationPercentage(
        performance.algorithmActivationId,
        allocationPercentage
      );

      const composite = compositeScores.get(performance.algorithmActivationId) || 0;
      this.logger.log(
        `Ranked activation ${performance.algorithmActivationId} as #${rank} ` +
          `(composite: ${composite.toFixed(3)}) with ${allocationPercentage.toFixed(2)}% allocation`
      );
    }
  }

  /**
   * Get performance history for an algorithm activation within a time range
   * @param activationId - AlgorithmActivation ID
   * @param from - Start date
   * @param to - End date
   * @returns Array of AlgorithmPerformance records
   */
  async getPerformanceHistory(activationId: string, from: Date, to: Date): Promise<AlgorithmPerformance[]> {
    return await this.algorithmPerformanceRepository.find({
      where: {
        algorithmActivationId: activationId,
        calculatedAt: Between(from, to)
      },
      order: { calculatedAt: 'ASC' }
    });
  }

  /**
   * Get latest performance for an algorithm activation
   * @param activationId - AlgorithmActivation ID
   * @returns Latest AlgorithmPerformance or null
   */
  async getLatestPerformance(activationId: string): Promise<AlgorithmPerformance | null> {
    return await this.algorithmPerformanceRepository.findOne({
      where: { algorithmActivationId: activationId },
      order: { calculatedAt: 'DESC' }
    });
  }

  /**
   * Get all latest performance records for a user's active algorithms
   * @param userId - User ID
   * @returns Array of AlgorithmPerformance records with rankings
   */
  async getUserRankings(userId: string): Promise<AlgorithmPerformance[]> {
    const activations = await this.algorithmActivationService.findUserActiveAlgorithms(userId);

    if (activations.length === 0) return [];

    const activationIds = activations.map((a) => a.id);
    const performances = await this.algorithmPerformanceRepository
      .createQueryBuilder('perf')
      .distinctOn(['perf.algorithmActivationId'])
      .where('perf.algorithmActivationId IN (:...activationIds)', { activationIds })
      .orderBy('perf.algorithmActivationId')
      .addOrderBy('perf.calculatedAt', 'DESC')
      .getMany();

    // Sort by rank (undefined/nulls last)
    return performances.sort((a, b) => {
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    });
  }

  /**
   * Save a performance record (alias for repository save)
   * @param performance - AlgorithmPerformance record to save
   */
  async savePerformance(performance: AlgorithmPerformance): Promise<void> {
    await this.algorithmPerformanceRepository.save(performance);
  }
}
