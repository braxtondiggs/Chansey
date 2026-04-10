import { Injectable, Logger } from '@nestjs/common';

import { Coin } from '../../../../coin/coin.entity';
import { BacktestTrade, TradeType } from '../../backtest-trade.entity';
import { BacktestExitTracker } from '../exits';
import { Portfolio, PortfolioStateService } from '../portfolio';
import { PositionManagerService } from '../positions';
import { MarketData } from '../types';

/**
 * Handles forced position exits during backtesting: liquidations
 * for leveraged positions and delisting-triggered exits.
 *
 * Extracted from BacktestEngine to isolate forced-exit logic
 * from the main simulation loop.
 */
@Injectable()
export class ForcedExitService {
  private readonly logger = new Logger('ForcedExitService');

  constructor(
    private readonly positionManager: PositionManagerService,
    private readonly portfolioState: PortfolioStateService
  ) {}

  /**
   * Check all leveraged positions for liquidation and force-close any that have been breached.
   * Returns an array of liquidation trade records.
   */
  checkAndApplyLiquidations(
    portfolio: Portfolio,
    marketData: MarketData,
    tradingFee: number,
    coinMap: Map<string, Coin>,
    quoteCoin: Coin
  ): Partial<BacktestTrade>[] {
    const liquidationTrades: Partial<BacktestTrade>[] = [];
    const positionsToDelete: string[] = [];

    for (const [coinId, position] of portfolio.positions) {
      if (!position.leverage || position.leverage <= 1) continue;

      const currentPrice = marketData.prices.get(coinId);
      if (currentPrice === undefined) continue;

      if (this.positionManager.isLiquidated(position, currentPrice)) {
        const marginLost = position.marginAmount ?? 0;

        // Record liquidation trade (total loss of margin)
        liquidationTrades.push({
          type: position.side === 'short' ? TradeType.BUY : TradeType.SELL,
          quantity: position.quantity,
          price: currentPrice,
          totalValue: 0,
          fee: 0,
          realizedPnL: -marginLost,
          realizedPnLPercent: -1,
          costBasis: position.averagePrice,
          positionSide: position.side,
          leverage: position.leverage,
          liquidationPrice: position.liquidationPrice,
          marginUsed: marginLost,
          baseCoin: coinMap.get(coinId),
          quoteCoin,
          metadata: { liquidated: true }
        });

        positionsToDelete.push(coinId);

        // Update margin tracking
        portfolio.totalMarginUsed = Math.max(0, (portfolio.totalMarginUsed ?? 0) - marginLost);

        this.logger.debug(
          `Position liquidated: ${coinId} ${position.side} at ${currentPrice} (liq price: ${position.liquidationPrice})`
        );
      }
    }

    // Delete liquidated positions
    for (const coinId of positionsToDelete) {
      portfolio.positions.delete(coinId);
    }

    if (positionsToDelete.length > 0) {
      portfolio.availableMargin = portfolio.cashBalance;
      portfolio.totalValue =
        portfolio.cashBalance + this.portfolioState.calculatePositionsValue(portfolio.positions, marketData.prices);
    }

    return liquidationTrades;
  }

  /**
   * Force-close open positions for coins that have been delisted.
   * Applies a penalty price (default: 90% loss) to simulate the near-total loss
   * that typically accompanies a delisting event.
   */
  checkAndApplyDelistingExits(
    portfolio: Portfolio,
    delistingDates: Map<string, Date>,
    lastKnownPrices: Map<string, number>,
    timestamp: Date,
    delistingPenalty: number,
    exitTracker: BacktestExitTracker | null,
    coinMap: Map<string, Coin>,
    quoteCoin: Coin
  ): Partial<BacktestTrade>[] {
    const delistingTrades: Partial<BacktestTrade>[] = [];
    const positionsToDelete: string[] = [];

    // Clamp to [0, 1] to guard against misconfigured snapshot/config values.
    // A value outside this range would produce negative or inflated prices and
    // violate @Min(0) constraints on BacktestTrade.price/totalValue.
    const safePenalty = Number.isFinite(delistingPenalty) ? Math.min(1, Math.max(0, delistingPenalty)) : 0.9;

    for (const [coinId, position] of portfolio.positions) {
      const delistingDate = delistingDates.get(coinId);
      if (!delistingDate || timestamp < delistingDate) continue;

      const lastPrice = lastKnownPrices.get(coinId) ?? position.averagePrice;
      const penaltyPrice = lastPrice * (1 - safePenalty);
      const totalValue = position.quantity * penaltyPrice;
      const costBasis = position.averagePrice * position.quantity;
      const realizedPnL =
        position.side === 'short'
          ? costBasis - totalValue // Short: profit when price drops
          : totalValue - costBasis; // Long: loss when price drops
      const realizedPnLPercent = costBasis > 0 ? realizedPnL / costBasis : 0;

      delistingTrades.push({
        type: position.side === 'short' ? TradeType.BUY : TradeType.SELL,
        quantity: position.quantity,
        price: penaltyPrice,
        totalValue,
        fee: 0, // No exchange to charge fees on a delisting
        realizedPnL,
        realizedPnLPercent,
        costBasis: position.averagePrice,
        positionSide: position.side,
        leverage: position.leverage,
        baseCoin: coinMap.get(coinId),
        quoteCoin,
        metadata: {
          delistingExit: true,
          delistingDate: delistingDate.toISOString(),
          lastKnownPrice: lastPrice,
          penaltyRate: safePenalty
        }
      });

      // Credit the penalty value to cash
      portfolio.cashBalance += totalValue;
      positionsToDelete.push(coinId);

      this.logger.debug(
        `Delisting forced exit: ${coinId} ${position.side} at penalty price ${penaltyPrice.toFixed(4)} (${(safePenalty * 100).toFixed(0)}% loss from ${lastPrice.toFixed(4)})`
      );
    }

    // Remove positions and clean up exit tracker
    for (const coinId of positionsToDelete) {
      portfolio.positions.delete(coinId);
      exitTracker?.removePosition(coinId);
    }

    if (positionsToDelete.length > 0) {
      portfolio.totalValue =
        portfolio.cashBalance + this.portfolioState.calculatePositionsValue(portfolio.positions, new Map());
    }

    return delistingTrades;
  }
}
