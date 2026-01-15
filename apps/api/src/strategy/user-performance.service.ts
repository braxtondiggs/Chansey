import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UserStrategyPosition } from './entities/user-strategy-position.entity';
import { PositionTrackingService } from './position-tracking.service';

import { Order, OrderSide, OrderStatus } from '../order/order.entity';

/**
 * Tracks and calculates performance metrics for users' algorithmic trading.
 * Provides historical performance data, returns, and risk metrics.
 */
@Injectable()
export class UserPerformanceService {
  private readonly logger = new Logger(UserPerformanceService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(UserStrategyPosition)
    private readonly positionRepo: Repository<UserStrategyPosition>,
    private readonly positionTracking: PositionTrackingService
  ) {}

  /**
   * Get overall algo trading performance for a user.
   * Returns total return, time-based returns, and risk metrics.
   */
  async getUserAlgoPerformance(userId: string): Promise<AlgoPerformanceMetrics> {
    try {
      const pnl = await this.positionTracking.getUserTotalPnL(userId);
      const orders = await this.getAlgoOrders(userId);
      const positions = await this.positionTracking.getPositions(userId);

      // Calculate total capital deployed
      const totalCapitalDeployed = this.calculateTotalCapitalDeployed(orders);

      // Calculate returns
      const totalReturnPct = totalCapitalDeployed > 0 ? (pnl.totalPnL / totalCapitalDeployed) * 100 : 0;

      // Calculate time-based returns
      const monthlyReturn = await this.calculateMonthlyReturn(userId);
      const weeklyReturn = await this.calculateWeeklyReturn(userId);

      // Calculate win rate
      const winRate = this.calculateWinRate(orders);

      // Calculate active positions count
      const activePositions = positions.filter((p) => Number(p.quantity) !== 0).length;

      return {
        totalPnL: pnl.totalPnL,
        realizedPnL: pnl.realizedPnL,
        unrealizedPnL: pnl.unrealizedPnL,
        totalReturnPct,
        monthlyReturnPct: monthlyReturn,
        weeklyReturnPct: weeklyReturn,
        winRate,
        totalTrades: orders.length,
        activePositions,
        totalCapitalDeployed
      };
    } catch (error) {
      this.logger.error(`Failed to get algo performance for user ${userId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get historical performance data for charting.
   * Returns daily P&L snapshots over time calculated from order history.
   */
  async getHistoricalPerformance(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<HistoricalPerformancePoint[]> {
    try {
      const effectiveStartDate = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Default: last 90 days
      const effectiveEndDate = endDate || new Date();

      // Get all filled algorithmic orders in the date range
      const orders = await this.orderRepo.find({
        where: {
          user: { id: userId },
          isAlgorithmicTrade: true,
          status: OrderStatus.FILLED
        },
        order: { createdAt: 'ASC' }
      });

      // Filter orders by date range
      const filteredOrders = orders.filter((o) => {
        const orderDate = new Date(o.createdAt);
        return orderDate >= effectiveStartDate && orderDate <= effectiveEndDate;
      });

      if (filteredOrders.length === 0) {
        return [];
      }

      // Group orders by date and calculate daily metrics
      const dailyData = new Map<string, { pnl: number; portfolioValue: number }>();
      let cumulativePnL = 0;
      let portfolioValue = 0;

      for (const order of filteredOrders) {
        const dateKey = new Date(order.createdAt).toISOString().split('T')[0];

        if (!dailyData.has(dateKey)) {
          dailyData.set(dateKey, { pnl: 0, portfolioValue: 0 });
        }

        const dayData = dailyData.get(dateKey)!;

        if (order.side === OrderSide.BUY) {
          // Buying adds to portfolio value
          portfolioValue += Number(order.price) * Number(order.quantity);
        } else if (order.side === OrderSide.SELL) {
          // Selling reduces portfolio value and may realize gain/loss
          portfolioValue -= Number(order.price) * Number(order.quantity);
          if (order.gainLoss !== null && order.gainLoss !== undefined) {
            dayData.pnl += Number(order.gainLoss);
            cumulativePnL += Number(order.gainLoss);
          }
        }

        dayData.portfolioValue = portfolioValue;
      }

      // Convert to array of performance points
      const result: HistoricalPerformancePoint[] = [];
      let runningCumulativePnL = 0;

      for (const [dateStr, data] of dailyData) {
        runningCumulativePnL += data.pnl;
        result.push({
          date: new Date(dateStr),
          dailyPnL: data.pnl,
          cumulativePnL: runningCumulativePnL,
          portfolioValue: data.portfolioValue
        });
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to get historical performance for user ${userId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get performance breakdown by strategy.
   * Shows which strategies are performing best/worst.
   */
  async getPerformanceByStrategy(userId: string): Promise<StrategyPerformance[]> {
    try {
      const positions = await this.positionTracking.getPositions(userId);

      // Group by strategy
      const strategyIds = [...new Set(positions.map((p) => p.strategyConfigId))];

      const strategyPerformance: StrategyPerformance[] = [];

      for (const strategyId of strategyIds) {
        const pnl = await this.positionTracking.getStrategyPnL(userId, strategyId);
        const strategyOrders = await this.getAlgoOrdersForStrategy(userId, strategyId);
        const strategyPositions = positions.filter((p) => p.strategyConfigId === strategyId);

        const capitalDeployed = this.calculateTotalCapitalDeployed(strategyOrders);
        const returnPct = capitalDeployed > 0 ? (pnl.totalPnL / capitalDeployed) * 100 : 0;

        strategyPerformance.push({
          strategyId,
          totalPnL: pnl.totalPnL,
          realizedPnL: pnl.realizedPnL,
          unrealizedPnL: pnl.unrealizedPnL,
          returnPct,
          tradesCount: strategyOrders.length,
          activePositions: strategyPositions.filter((p) => Number(p.quantity) !== 0).length
        });
      }

      // Sort by total P&L descending
      return strategyPerformance.sort((a, b) => b.totalPnL - a.totalPnL);
    } catch (error) {
      this.logger.error(`Failed to get performance by strategy for user ${userId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get all algorithmic orders for a user.
   */
  private async getAlgoOrders(userId: string): Promise<Order[]> {
    return this.orderRepo.find({
      where: {
        user: { id: userId },
        isAlgorithmicTrade: true
      },
      order: {
        createdAt: 'ASC'
      }
    });
  }

  /**
   * Get algorithmic orders for a specific strategy.
   */
  private async getAlgoOrdersForStrategy(userId: string, strategyConfigId: string): Promise<Order[]> {
    return this.orderRepo.find({
      where: {
        user: { id: userId },
        strategyConfigId,
        isAlgorithmicTrade: true
      },
      order: {
        createdAt: 'ASC'
      }
    });
  }

  /**
   * Calculate total capital deployed across all trades.
   */
  private calculateTotalCapitalDeployed(orders: Order[]): number {
    return orders
      .filter((o) => o.side === OrderSide.BUY && o.status === OrderStatus.FILLED)
      .reduce((sum, order) => sum + Number(order.price) * Number(order.quantity), 0);
  }

  /**
   * Calculate win rate from orders (ratio of profitable trades).
   * Uses the gainLoss field on sell orders to determine profitability.
   * @returns Win rate as decimal (0.0-1.0), e.g., 0.65 = 65% win rate
   */
  private calculateWinRate(orders: Order[]): number {
    // Filter to only filled sell orders (where we can determine profit/loss)
    const filledSellOrders = orders.filter((o) => o.status === OrderStatus.FILLED && o.side === OrderSide.SELL);

    if (filledSellOrders.length === 0) return 0;

    // Count orders with positive gainLoss (profitable trades)
    const profitableTrades = filledSellOrders.filter(
      (o) => o.gainLoss !== null && o.gainLoss !== undefined && Number(o.gainLoss) > 0
    ).length;

    return profitableTrades / filledSellOrders.length;
  }

  /**
   * Calculate monthly return percentage.
   * Return = (Total P&L from last 30 days / Capital deployed in last 30 days) * 100
   */
  private async calculateMonthlyReturn(userId: string): Promise<number> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const monthlyOrders = await this.orderRepo.find({
        where: {
          user: { id: userId },
          isAlgorithmicTrade: true,
          status: OrderStatus.FILLED
        }
      });

      const recentOrders = monthlyOrders.filter((o) => new Date(o.createdAt) >= thirtyDaysAgo);

      if (recentOrders.length === 0) return 0;

      // Calculate total P&L from sell orders in the period
      const totalPnL = recentOrders
        .filter((o) => o.side === OrderSide.SELL && o.gainLoss !== null && o.gainLoss !== undefined)
        .reduce((sum, order) => sum + Number(order.gainLoss), 0);

      // Calculate capital deployed (buy orders) in the period
      const capitalDeployed = recentOrders
        .filter((o) => o.side === OrderSide.BUY)
        .reduce((sum, order) => sum + Number(order.price) * Number(order.quantity), 0);

      if (capitalDeployed === 0) return 0;

      return (totalPnL / capitalDeployed) * 100;
    } catch (error) {
      this.logger.error(`Failed to calculate monthly return: ${error.message}`);
      return 0;
    }
  }

  /**
   * Calculate weekly return percentage.
   * Return = (Total P&L from last 7 days / Capital deployed in last 7 days) * 100
   */
  private async calculateWeeklyReturn(userId: string): Promise<number> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const weeklyOrders = await this.orderRepo.find({
        where: {
          user: { id: userId },
          isAlgorithmicTrade: true,
          status: OrderStatus.FILLED
        }
      });

      const recentOrders = weeklyOrders.filter((o) => new Date(o.createdAt) >= sevenDaysAgo);

      if (recentOrders.length === 0) return 0;

      // Calculate total P&L from sell orders in the period
      const totalPnL = recentOrders
        .filter((o) => o.side === OrderSide.SELL && o.gainLoss !== null && o.gainLoss !== undefined)
        .reduce((sum, order) => sum + Number(order.gainLoss), 0);

      // Calculate capital deployed (buy orders) in the period
      const capitalDeployed = recentOrders
        .filter((o) => o.side === OrderSide.BUY)
        .reduce((sum, order) => sum + Number(order.price) * Number(order.quantity), 0);

      if (capitalDeployed === 0) return 0;

      return (totalPnL / capitalDeployed) * 100;
    } catch (error) {
      this.logger.error(`Failed to calculate weekly return: ${error.message}`);
      return 0;
    }
  }
}

/**
 * Overall algo trading performance metrics for a user.
 */
export interface AlgoPerformanceMetrics {
  totalPnL: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalReturnPct: number;
  monthlyReturnPct: number;
  weeklyReturnPct: number;
  /** Win rate as decimal (0.0-1.0), e.g., 0.65 = 65% win rate */
  winRate: number;
  totalTrades: number;
  activePositions: number;
  totalCapitalDeployed: number;
}

/**
 * Historical performance data point for charting.
 */
export interface HistoricalPerformancePoint {
  date: Date;
  cumulativePnL: number;
  dailyPnL: number;
  portfolioValue: number;
}

/**
 * Performance metrics for a single strategy.
 */
export interface StrategyPerformance {
  strategyId: string;
  totalPnL: number;
  realizedPnL: number;
  unrealizedPnL: number;
  returnPct: number;
  tradesCount: number;
  activePositions: number;
}
