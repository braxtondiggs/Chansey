import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { MetricsCalculatorService, Portfolio, TimeframeType } from '../../backtest/shared';
import {
  PaperTradingOrder,
  PaperTradingOrderSide,
  PaperTradingSession,
  PaperTradingSnapshot,
  SnapshotHolding
} from '../entities';

/**
 * Encapsulates snapshot persistence and end-of-session metric aggregation
 * for the paper-trading engine.
 */
@Injectable()
export class PaperTradingSnapshotService {
  constructor(
    @InjectRepository(PaperTradingSnapshot)
    private readonly snapshotRepository: Repository<PaperTradingSnapshot>,
    @InjectRepository(PaperTradingOrder)
    private readonly orderRepository: Repository<PaperTradingOrder>,
    private readonly metricsCalculator: MetricsCalculatorService
  ) {}

  /**
   * Save a portfolio snapshot
   */
  async save(
    session: PaperTradingSession,
    portfolio: Portfolio,
    portfolioValue: number,
    prices: Record<string, number>,
    quoteCurrency: string,
    timestamp: Date
  ): Promise<PaperTradingSnapshot> {
    const cumulativeReturn = (portfolioValue - session.initialCapital) / session.initialCapital;

    // Calculate drawdown (clamp to 0 – portfolio may exceed stale peak before processor updates it)
    const peakValue = Math.max(session.peakPortfolioValue ?? session.initialCapital, portfolioValue);
    const drawdown = peakValue > 0 ? Math.min(1, Math.max(0, (peakValue - portfolioValue) / peakValue)) : 0;

    // Build holdings map
    const holdings: Record<string, SnapshotHolding> = {};
    for (const [coinId, position] of portfolio.positions) {
      const symbol = `${coinId}/${quoteCurrency}`;
      const price = prices[symbol] ?? 0;
      const value = position.quantity * price;
      const unrealizedPnL = position.averagePrice > 0 ? (price - position.averagePrice) * position.quantity : 0;
      const unrealizedPnLPercent =
        position.averagePrice > 0 ? (price - position.averagePrice) / position.averagePrice : 0;

      holdings[coinId] = {
        quantity: position.quantity,
        value,
        price,
        averageCost: position.averagePrice,
        unrealizedPnL,
        unrealizedPnLPercent
      };
    }

    // Calculate unrealized P&L
    let unrealizedPnL = 0;
    for (const holding of Object.values(holdings)) {
      unrealizedPnL += holding.unrealizedPnL ?? 0;
    }

    // Get realized P&L from orders
    const realizedPnLResult = await this.orderRepository
      .createQueryBuilder('order')
      .select('SUM(order.realizedPnL)', 'totalRealizedPnL')
      .where('order.sessionId = :sessionId', { sessionId: session.id })
      .andWhere('order.realizedPnL IS NOT NULL')
      .getRawOne();

    const snapshot = this.snapshotRepository.create({
      portfolioValue,
      cashBalance: portfolio.cashBalance,
      holdings,
      cumulativeReturn,
      drawdown,
      unrealizedPnL,
      realizedPnL: realizedPnLResult?.totalRealizedPnL ?? 0,
      prices,
      timestamp,
      session
    });

    return this.snapshotRepository.save(snapshot);
  }

  /**
   * Calculate final session metrics
   */
  async calculateSessionMetrics(session: PaperTradingSession): Promise<{
    sharpeRatio: number;
    winRate: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    maxDrawdown: number;
  }> {
    // Get all orders
    const orders = await this.orderRepository.find({
      where: { session: { id: session.id } }
    });

    const sellOrders = orders.filter((o) => o.side === PaperTradingOrderSide.SELL);
    const winningTrades = sellOrders.filter((o) => (o.realizedPnL ?? 0) > 0).length;
    const losingTrades = sellOrders.filter((o) => (o.realizedPnL ?? 0) < 0).length;
    const totalTrades = orders.length;
    const winRate = sellOrders.length > 0 ? winningTrades / sellOrders.length : 0;

    // Get snapshots for Sharpe ratio
    const snapshots = await this.snapshotRepository.find({
      where: { session: { id: session.id } },
      order: { timestamp: 'ASC' }
    });

    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const previous = snapshots[i - 1].portfolioValue;
      const current = snapshots[i].portfolioValue;
      if (previous > 0) {
        returns.push((current - previous) / previous);
      }
    }

    // Calculate Sharpe ratio using hourly intervals (crypto 24/7)
    const sharpeRatio =
      returns.length > 2
        ? this.metricsCalculator.calculateSharpeRatio(returns, {
            timeframe: TimeframeType.HOURLY,
            useCryptoCalendar: true,
            riskFreeRate: 0.02
          })
        : 0;

    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = session.initialCapital;
    for (const snapshot of snapshots) {
      if (snapshot.portfolioValue > peak) {
        peak = snapshot.portfolioValue;
      }
      const drawdown = peak > 0 ? Math.max(0, (peak - snapshot.portfolioValue) / peak) : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return {
      sharpeRatio,
      winRate,
      totalTrades,
      winningTrades,
      losingTrades,
      maxDrawdown
    };
  }
}
