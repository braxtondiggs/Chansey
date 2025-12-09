import { Injectable, Logger } from '@nestjs/common';

import { PositionTrackingService } from '../strategy/position-tracking.service';

/**
 * Aggregates portfolio data across all algorithmic trading strategies.
 * Combines positions from multiple strategies into a unified view.
 */
@Injectable()
export class PortfolioAggregationService {
  private readonly logger = new Logger(PortfolioAggregationService.name);

  constructor(private readonly positionTracking: PositionTrackingService) {}

  /**
   * Get aggregated portfolio for a user across all algo trading strategies.
   * Combines positions from all strategies and groups by symbol.
   */
  async getAggregatedPortfolio(userId: string): Promise<{
    totalValue: number;
    positions: AggregatedPosition[];
    totalPnL: number;
    realizedPnL: number;
    unrealizedPnL: number;
  }> {
    try {
      // Get all positions across all strategies
      const allPositions = await this.positionTracking.getPositions(userId);

      // Get positions grouped by symbol
      const positionsBySymbol = await this.positionTracking.getAllUserPositionsBySymbol(userId);

      // Get total P&L
      const pnlSummary = await this.positionTracking.getUserTotalPnL(userId);

      // Convert Map to array of aggregated positions
      const aggregatedPositions: AggregatedPosition[] = [];
      positionsBySymbol.forEach((data, symbol) => {
        aggregatedPositions.push({
          symbol,
          quantity: data.quantity,
          avgEntryPrice: data.avgPrice,
          currentValue: data.quantity * data.avgPrice, // TODO: Use current market price
          unrealizedPnL: data.pnl,
          strategies: this.getStrategiesForSymbol(allPositions, symbol)
        });
      });

      // Calculate total portfolio value
      const totalValue = aggregatedPositions.reduce((sum, pos) => sum + pos.currentValue, 0);

      return {
        totalValue,
        positions: aggregatedPositions,
        totalPnL: pnlSummary.totalPnL,
        realizedPnL: pnlSummary.realizedPnL,
        unrealizedPnL: pnlSummary.unrealizedPnL
      };
    } catch (error) {
      this.logger.error(`Failed to get aggregated portfolio for user ${userId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get breakdown of positions by strategy for a user.
   * Shows which strategies hold which positions.
   */
  async getPositionsByStrategy(userId: string): Promise<StrategyPositionBreakdown[]> {
    try {
      const positions = await this.positionTracking.getPositions(userId);

      // Group by strategy
      const positionsByStrategy = new Map<string, typeof positions>();
      for (const position of positions) {
        const strategyId = position.strategyConfigId;
        if (!positionsByStrategy.has(strategyId)) {
          positionsByStrategy.set(strategyId, []);
        }
        positionsByStrategy.get(strategyId).push(position);
      }

      // Calculate P&L per strategy
      const breakdown: StrategyPositionBreakdown[] = [];
      for (const [strategyId, strategyPositions] of positionsByStrategy.entries()) {
        const pnl = await this.positionTracking.getStrategyPnL(userId, strategyId);

        breakdown.push({
          strategyId,
          positions: strategyPositions.map((p) => ({
            symbol: p.symbol,
            quantity: Number(p.quantity),
            avgEntryPrice: Number(p.avgEntryPrice),
            unrealizedPnL: Number(p.unrealizedPnL)
          })),
          totalPnL: pnl.totalPnL,
          realizedPnL: pnl.realizedPnL,
          unrealizedPnL: pnl.unrealizedPnL
        });
      }

      return breakdown;
    } catch (error) {
      this.logger.error(`Failed to get positions by strategy for user ${userId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get list of strategy IDs that hold a specific symbol.
   */
  private getStrategiesForSymbol(positions: any[], symbol: string): string[] {
    return positions
      .filter((p) => p.symbol === symbol && Number(p.quantity) !== 0)
      .map((p) => p.strategyConfigId)
      .filter((id, index, arr) => arr.indexOf(id) === index); // Unique
  }

  /**
   * Calculate portfolio allocation percentages by symbol.
   */
  async getAllocationBreakdown(userId: string): Promise<AllocationBreakdown[]> {
    try {
      const portfolio = await this.getAggregatedPortfolio(userId);

      if (portfolio.totalValue === 0) {
        return [];
      }

      return portfolio.positions.map((position) => ({
        symbol: position.symbol,
        value: position.currentValue,
        percentage: (position.currentValue / portfolio.totalValue) * 100,
        quantity: position.quantity
      }));
    } catch (error) {
      this.logger.error(`Failed to get allocation breakdown for user ${userId}: ${error.message}`, error.stack);
      throw error;
    }
  }
}

/**
 * Aggregated position combining holdings across multiple strategies.
 */
export interface AggregatedPosition {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  currentValue: number;
  unrealizedPnL: number;
  strategies: string[]; // Strategy IDs that hold this symbol
}

/**
 * Positions grouped by strategy with P&L.
 */
export interface StrategyPositionBreakdown {
  strategyId: string;
  positions: {
    symbol: string;
    quantity: number;
    avgEntryPrice: number;
    unrealizedPnL: number;
  }[];
  totalPnL: number;
  realizedPnL: number;
  unrealizedPnL: number;
}

/**
 * Portfolio allocation by symbol as percentage.
 */
export interface AllocationBreakdown {
  symbol: string;
  value: number;
  percentage: number;
  quantity: number;
}
