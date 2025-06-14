import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { Repository, In } from 'typeorm';

import { BacktestEngine } from './backtest-engine.service';
import { Backtest, BacktestTrade, BacktestPerformanceSnapshot, BacktestStatus } from './backtest.entity';
import {
  CreateBacktestDto,
  UpdateBacktestDto,
  BacktestFiltersDto,
  BacktestPerformanceDto,
  BacktestComparisonDto,
  BacktestProgressDto
} from './dto/backtest.dto';

import { AlgorithmService } from '../../algorithm/algorithm.service';
import { CoinService } from '../../coin/coin.service';
import { PriceService } from '../../price/price.service';
import { User } from '../../users/users.entity';
import { NotFoundCustomException } from '../../utils/filters/not-found.exception';

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    private readonly algorithmService: AlgorithmService,
    private readonly coinService: CoinService,
    private readonly priceService: PriceService,
    private readonly backtestEngine: BacktestEngine,
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(BacktestTrade) private readonly backtestTradeRepository: Repository<BacktestTrade>,
    @InjectRepository(BacktestPerformanceSnapshot)
    private readonly backtestSnapshotRepository: Repository<BacktestPerformanceSnapshot>,
    @InjectQueue('backtest-queue') private readonly backtestQueue: Queue
  ) {}

  /**
   * Create a new backtest
   */
  async createBacktest(user: User, createBacktestDto: CreateBacktestDto): Promise<Backtest> {
    this.logger.log(`Creating backtest: ${createBacktestDto.name}`);

    // Validate algorithm exists
    const algorithm = await this.algorithmService.getAlgorithmById(createBacktestDto.algorithmId);
    if (!algorithm) {
      throw new NotFoundCustomException('Algorithm', { id: createBacktestDto.algorithmId });
    }

    // Create backtest entity
    const backtest = new Backtest({
      name: createBacktestDto.name,
      description: createBacktestDto.description,
      type: createBacktestDto.type,
      status: BacktestStatus.PENDING,
      initialCapital: createBacktestDto.initialCapital,
      tradingFee: createBacktestDto.tradingFee || 0.001,
      startDate: new Date(createBacktestDto.startDate),
      endDate: new Date(createBacktestDto.endDate),
      strategyParams: createBacktestDto.strategyParams,
      user,
      algorithm
    });

    const savedBacktest = await this.backtestRepository.save(backtest);

    // Queue the backtest for processing
    await this.backtestQueue.add('execute-backtest', {
      backtestId: savedBacktest.id,
      userId: user.id
    });

    return savedBacktest;
  }

  /**
   * Get backtests with filtering
   */
  async getBacktests(user: User, filters: BacktestFiltersDto): Promise<Backtest[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const whereClause: any = { user: { id: user.id } };

    if (filters.type) {
      whereClause.type = filters.type;
    }

    if (filters.algorithmId) {
      whereClause.algorithm = { id: filters.algorithmId };
    }

    if (filters.createdAfter) {
      if (!whereClause.createdAt) whereClause.createdAt = {};
      whereClause.createdAt.gte = new Date(filters.createdAfter);
    }

    if (filters.createdBefore) {
      if (!whereClause.createdAt) whereClause.createdAt = {};
      whereClause.createdAt.lte = new Date(filters.createdBefore);
    }

    return this.backtestRepository.find({
      where: whereClause,
      relations: ['algorithm', 'user'],
      order: { createdAt: 'DESC' },
      take: filters.limit || 20,
      skip: filters.offset || 0
    });
  }

  /**
   * Get a specific backtest
   */
  async getBacktest(user: User, backtestId: string): Promise<Backtest> {
    const backtest = await this.backtestRepository.findOne({
      where: { id: backtestId, user: { id: user.id } },
      relations: ['algorithm', 'user', 'trades', 'performanceSnapshots']
    });

    if (!backtest) {
      throw new NotFoundCustomException('Backtest', { id: backtestId });
    }

    return backtest;
  }

  /**
   * Update a backtest
   */
  async updateBacktest(user: User, backtestId: string, updateDto: UpdateBacktestDto): Promise<Backtest> {
    const backtest = await this.getBacktest(user, backtestId);

    if (backtest.status === BacktestStatus.RUNNING) {
      throw new Error('Cannot update a running backtest');
    }

    Object.assign(backtest, updateDto);
    return this.backtestRepository.save(backtest);
  }

  /**
   * Delete a backtest
   */
  async deleteBacktest(user: User, backtestId: string): Promise<void> {
    const backtest = await this.getBacktest(user, backtestId);

    if (backtest.status === BacktestStatus.RUNNING) {
      throw new Error('Cannot delete a running backtest');
    }

    await this.backtestRepository.remove(backtest);
  }

  /**
   * Get backtest performance metrics
   */
  async getBacktestPerformance(user: User, backtestId: string): Promise<BacktestPerformanceDto> {
    const backtest = await this.getBacktest(user, backtestId);

    if (backtest.status !== BacktestStatus.COMPLETED) {
      throw new Error('Backtest must be completed to view performance');
    }

    // Get recent trades (last 50)
    const recentTrades = await this.backtestTradeRepository.find({
      where: { backtest: { id: backtestId } },
      relations: ['baseCoin', 'quoteCoin'],
      order: { executedAt: 'DESC' },
      take: 50
    });

    // Get performance history
    const snapshots = await this.backtestSnapshotRepository.find({
      where: { backtest: { id: backtestId } },
      order: { timestamp: 'ASC' }
    });

    return {
      backtestId: backtest.id,
      name: backtest.name,
      initialCapital: backtest.initialCapital,
      finalValue: backtest.finalValue || 0,
      totalReturn: backtest.totalReturn || 0,
      annualizedReturn: backtest.annualizedReturn || 0,
      sharpeRatio: backtest.sharpeRatio || 0,
      maxDrawdown: backtest.maxDrawdown || 0,
      totalTrades: backtest.totalTrades || 0,
      winningTrades: backtest.winningTrades || 0,
      winRate: backtest.winRate || 0,
      performanceHistory: snapshots.map((snapshot) => ({
        timestamp: snapshot.timestamp,
        portfolioValue: snapshot.portfolioValue,
        cumulativeReturn: snapshot.cumulativeReturn,
        drawdown: snapshot.drawdown
      })),
      recentTrades: recentTrades.map((trade) => ({
        id: trade.id,
        type: trade.type,
        quantity: trade.quantity,
        price: trade.price,
        totalValue: trade.totalValue,
        executedAt: trade.executedAt,
        baseCoin: { symbol: trade.baseCoin.symbol, name: trade.baseCoin.name },
        quoteCoin: { symbol: trade.quoteCoin.symbol, name: trade.quoteCoin.name }
      }))
    };
  }

  /**
   * Compare multiple backtests
   */
  async compareBacktests(user: User, comparisonDto: BacktestComparisonDto): Promise<Record<string, unknown>> {
    const backtests = await this.backtestRepository.find({
      where: {
        id: In(comparisonDto.backtestIds),
        user: { id: user.id }
      },
      relations: ['algorithm']
    });

    if (backtests.length !== comparisonDto.backtestIds.length) {
      throw new Error('One or more backtests not found');
    }

    // Get performance snapshots for all backtests
    const comparisons = await Promise.all(
      backtests.map(async (backtest) => {
        const snapshots = await this.backtestSnapshotRepository.find({
          where: { backtest: { id: backtest.id } },
          order: { timestamp: 'ASC' }
        });

        const metrics = this.backtestEngine.calculatePerformanceMetrics(backtest.initialCapital, snapshots);

        return {
          id: backtest.id,
          name: backtest.name,
          algorithm: backtest.algorithm.name,
          metrics,
          snapshots: snapshots.map((s) => ({
            timestamp: s.timestamp,
            portfolioValue: s.portfolioValue,
            cumulativeReturn: s.cumulativeReturn
          }))
        };
      })
    );

    return {
      backtests: comparisons,
      summary: {
        bestReturn: Math.max(...comparisons.map((c) => c.metrics.totalReturn)),
        bestSharpe: Math.max(...comparisons.map((c) => c.metrics.sharpeRatio)),
        lowestDrawdown: Math.min(...comparisons.map((c) => c.metrics.maxDrawdown))
      }
    };
  }

  /**
   * Get backtest progress (for running backtests)
   */
  async getBacktestProgress(user: User, backtestId: string): Promise<BacktestProgressDto> {
    const backtest = await this.getBacktest(user, backtestId);

    // For now, return a simple progress based on status
    switch (backtest.status) {
      case BacktestStatus.PENDING:
        return { progress: 0, message: 'Backtest queued for processing' };
      case BacktestStatus.RUNNING:
        return { progress: 50, message: 'Backtest in progress...' };
      case BacktestStatus.COMPLETED:
        return { progress: 100, message: 'Backtest completed successfully' };
      case BacktestStatus.FAILED:
        return { progress: 0, message: `Backtest failed: ${backtest.errorMessage || 'Unknown error'}` };
      case BacktestStatus.CANCELLED:
        return { progress: 0, message: 'Backtest was cancelled' };
      default:
        return { progress: 0, message: 'Unknown status' };
    }
  }

  /**
   * Cancel a running backtest
   */
  async cancelBacktest(user: User, backtestId: string): Promise<void> {
    const backtest = await this.getBacktest(user, backtestId);

    if (backtest.status !== BacktestStatus.RUNNING && backtest.status !== BacktestStatus.PENDING) {
      throw new Error('Can only cancel running or pending backtests');
    }

    backtest.status = BacktestStatus.CANCELLED;
    await this.backtestRepository.save(backtest);

    // TODO: Cancel the background job if it's still running
  }
}
