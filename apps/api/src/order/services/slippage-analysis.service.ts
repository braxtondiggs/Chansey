import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Order, OrderStatus } from '../order.entity';

export interface SlippageStats {
  symbol: string;
  avgSlippageBps: number;
  minSlippageBps: number;
  maxSlippageBps: number;
  stdDevBps: number;
  orderCount: number;
  favorableCount: number; // Negative slippage (got better price)
  unfavorableCount: number; // Positive slippage (got worse price)
}

export interface SlippageTrend {
  date: string;
  avgSlippageBps: number;
  orderCount: number;
}

export interface SlippageSummary {
  totalOrders: number;
  avgSlippageBps: number;
  maxSlippageBps: number;
  totalSlippageCostUsd: number;
  highSlippageOrderCount: number;
}

/**
 * SlippageAnalysisService
 *
 * Provides analytics and reporting for order execution slippage.
 * Enables tracking of execution quality across trading pairs and time periods.
 */
@Injectable()
export class SlippageAnalysisService {
  private readonly logger = new Logger(SlippageAnalysisService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>
  ) {}

  /**
   * Get overall slippage summary for a user
   * @param userId - User ID
   * @returns Summary statistics including total orders, average slippage, and cost impact
   */
  async getSlippageSummary(userId: string): Promise<SlippageSummary> {
    const result = await this.orderRepository
      .createQueryBuilder('order')
      .select('COUNT(*)', 'totalOrders')
      .addSelect('AVG(order.actualSlippageBps)', 'avgSlippageBps')
      .addSelect('MAX(ABS(order.actualSlippageBps))', 'maxSlippageBps')
      .addSelect('SUM(CASE WHEN ABS(order.actualSlippageBps) > 50 THEN 1 ELSE 0 END)', 'highSlippageOrderCount')
      .addSelect('SUM(order.cost * order.actualSlippageBps / 10000)', 'totalSlippageCostUsd')
      .where('order.userId = :userId', { userId })
      .andWhere('order.actualSlippageBps IS NOT NULL')
      .andWhere('order.status = :status', { status: OrderStatus.FILLED })
      .getRawOne();

    return {
      totalOrders: parseInt(result?.totalOrders) || 0,
      avgSlippageBps: parseFloat(result?.avgSlippageBps) || 0,
      maxSlippageBps: parseFloat(result?.maxSlippageBps) || 0,
      totalSlippageCostUsd: parseFloat(result?.totalSlippageCostUsd) || 0,
      highSlippageOrderCount: parseInt(result?.highSlippageOrderCount) || 0
    };
  }

  /**
   * Get slippage statistics grouped by trading pair
   * @param userId - User ID
   * @returns Array of slippage stats per symbol
   */
  async getSlippageBySymbol(userId: string): Promise<SlippageStats[]> {
    const result = await this.orderRepository
      .createQueryBuilder('order')
      .select('order.symbol', 'symbol')
      .addSelect('AVG(order.actualSlippageBps)', 'avgSlippageBps')
      .addSelect('MIN(order.actualSlippageBps)', 'minSlippageBps')
      .addSelect('MAX(order.actualSlippageBps)', 'maxSlippageBps')
      .addSelect('STDDEV(order.actualSlippageBps)', 'stdDevBps')
      .addSelect('COUNT(*)', 'orderCount')
      .addSelect('SUM(CASE WHEN order.actualSlippageBps < 0 THEN 1 ELSE 0 END)', 'favorableCount')
      .addSelect('SUM(CASE WHEN order.actualSlippageBps > 0 THEN 1 ELSE 0 END)', 'unfavorableCount')
      .where('order.userId = :userId', { userId })
      .andWhere('order.actualSlippageBps IS NOT NULL')
      .andWhere('order.status = :status', { status: OrderStatus.FILLED })
      .groupBy('order.symbol')
      .orderBy('AVG(order.actualSlippageBps)', 'DESC')
      .getRawMany();

    return result.map((row) => ({
      symbol: row.symbol,
      avgSlippageBps: parseFloat(row.avgSlippageBps) || 0,
      minSlippageBps: parseFloat(row.minSlippageBps) || 0,
      maxSlippageBps: parseFloat(row.maxSlippageBps) || 0,
      stdDevBps: parseFloat(row.stdDevBps) || 0,
      orderCount: parseInt(row.orderCount) || 0,
      favorableCount: parseInt(row.favorableCount) || 0,
      unfavorableCount: parseInt(row.unfavorableCount) || 0
    }));
  }

  /**
   * Get slippage trends over time
   * @param userId - User ID
   * @param period - Time period ('7d', '30d', or '90d')
   * @returns Daily slippage averages
   */
  async getSlippageTrends(userId: string, period: '7d' | '30d' | '90d' = '30d'): Promise<SlippageTrend[]> {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await this.orderRepository
      .createQueryBuilder('order')
      .select("DATE_TRUNC('day', order.transactTime)", 'date')
      .addSelect('AVG(order.actualSlippageBps)', 'avgSlippageBps')
      .addSelect('COUNT(*)', 'orderCount')
      .where('order.userId = :userId', { userId })
      .andWhere('order.actualSlippageBps IS NOT NULL')
      .andWhere('order.transactTime >= :startDate', { startDate })
      .andWhere('order.status = :status', { status: OrderStatus.FILLED })
      .groupBy("DATE_TRUNC('day', order.transactTime)")
      .orderBy('date', 'ASC')
      .getRawMany();

    return result.map((row) => ({
      date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date),
      avgSlippageBps: parseFloat(row.avgSlippageBps) || 0,
      orderCount: parseInt(row.orderCount) || 0
    }));
  }

  /**
   * Identify trading pairs with high average slippage
   * @param thresholdBps - Slippage threshold in basis points (default: 50)
   * @returns List of symbol names exceeding threshold
   */
  async getHighSlippagePairs(thresholdBps = 50): Promise<string[]> {
    const result = await this.orderRepository
      .createQueryBuilder('order')
      .select('order.symbol', 'symbol')
      .addSelect('AVG(order.actualSlippageBps)', 'avgSlippage')
      .where('order.actualSlippageBps IS NOT NULL')
      .andWhere('order.status = :status', { status: OrderStatus.FILLED })
      .groupBy('order.symbol')
      .having('AVG(order.actualSlippageBps) > :threshold', { threshold: thresholdBps })
      .orderBy('avgSlippage', 'DESC')
      .getRawMany();

    return result.map((row) => row.symbol);
  }

  /**
   * Get slippage statistics for a specific symbol
   * @param userId - User ID
   * @param symbol - Trading pair symbol
   * @returns Slippage stats for the symbol
   */
  async getSlippageForSymbol(userId: string, symbol: string): Promise<SlippageStats | null> {
    const result = await this.orderRepository
      .createQueryBuilder('order')
      .select('order.symbol', 'symbol')
      .addSelect('AVG(order.actualSlippageBps)', 'avgSlippageBps')
      .addSelect('MIN(order.actualSlippageBps)', 'minSlippageBps')
      .addSelect('MAX(order.actualSlippageBps)', 'maxSlippageBps')
      .addSelect('STDDEV(order.actualSlippageBps)', 'stdDevBps')
      .addSelect('COUNT(*)', 'orderCount')
      .addSelect('SUM(CASE WHEN order.actualSlippageBps < 0 THEN 1 ELSE 0 END)', 'favorableCount')
      .addSelect('SUM(CASE WHEN order.actualSlippageBps > 0 THEN 1 ELSE 0 END)', 'unfavorableCount')
      .where('order.userId = :userId', { userId })
      .andWhere('order.symbol = :symbol', { symbol })
      .andWhere('order.actualSlippageBps IS NOT NULL')
      .andWhere('order.status = :status', { status: OrderStatus.FILLED })
      .groupBy('order.symbol')
      .getRawOne();

    if (!result) return null;

    return {
      symbol: result.symbol,
      avgSlippageBps: parseFloat(result.avgSlippageBps) || 0,
      minSlippageBps: parseFloat(result.minSlippageBps) || 0,
      maxSlippageBps: parseFloat(result.maxSlippageBps) || 0,
      stdDevBps: parseFloat(result.stdDevBps) || 0,
      orderCount: parseInt(result.orderCount) || 0,
      favorableCount: parseInt(result.favorableCount) || 0,
      unfavorableCount: parseInt(result.unfavorableCount) || 0
    };
  }
}
