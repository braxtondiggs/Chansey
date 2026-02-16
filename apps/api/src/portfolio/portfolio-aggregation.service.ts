import { Injectable, Logger } from '@nestjs/common';

import { Decimal } from 'decimal.js';

import { CoinService } from '../coin/coin.service';
import { RealtimeTickerService } from '../ohlc/services/realtime-ticker.service';
import { PositionTrackingService } from '../strategy/position-tracking.service';

const USD_QUOTE_CURRENCIES = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'USD']);

/**
 * Aggregates portfolio data across all algorithmic trading strategies.
 * Combines positions from multiple strategies into a unified view.
 */
@Injectable()
export class PortfolioAggregationService {
  private readonly logger = new Logger(PortfolioAggregationService.name);

  constructor(
    private readonly positionTracking: PositionTrackingService,
    private readonly coinService: CoinService,
    private readonly realtimeTickerService: RealtimeTickerService
  ) {}

  /**
   * Parses a CCXT-format trading pair symbol for USD-quoted pricing.
   * Returns the base symbol lowercased, or null if not USD-quoted or malformed.
   *
   * E.g., BTC/USDT → { base: 'btc' }, ETH/BTC → null, BTCUSDT → null
   */
  private parseSymbolForPricing(symbol: string): { base: string } | null {
    const parts = symbol.split('/');
    if (parts.length !== 2) return null;

    const [base, quote] = parts;
    if (!base || !quote) return null;
    if (!USD_QUOTE_CURRENCIES.has(quote.toUpperCase())) return null;

    return { base: base.toLowerCase() };
  }

  /**
   * Fetches current market prices for trading pair symbols.
   * Uses RealtimeTickerService with Coin.currentPrice as fallback.
   * Returns empty map on failure so callers can fall back to avgPrice.
   */
  private async fetchCurrentPrices(symbols: string[]): Promise<Map<string, number>> {
    const priceMap = new Map<string, number>();

    try {
      // Extract unique base symbols from trading pairs
      const symbolToBase = new Map<string, string>();
      for (const symbol of symbols) {
        const parsed = this.parseSymbolForPricing(symbol);
        if (parsed) {
          symbolToBase.set(symbol, parsed.base);
        }
      }

      const uniqueBases = [...new Set(symbolToBase.values())];
      if (uniqueBases.length === 0) return priceMap;

      // Batch-fetch coins by base symbol
      const coins = await this.coinService.getMultipleCoinsBySymbol(uniqueBases);
      const baseToCoins = new Map(coins.map((c) => [c.symbol.toLowerCase(), c]));

      // Collect coin IDs for realtime price fetch
      const coinIds = coins.filter((c) => c.id).map((c) => c.id);
      const tickerPrices = coinIds.length > 0 ? await this.realtimeTickerService.getPrices(coinIds) : new Map();

      // Map prices back to original trading pair symbols
      for (const [symbol, base] of symbolToBase) {
        const coin = baseToCoins.get(base);
        if (!coin) continue;

        // Fallback chain: ticker price → coin.currentPrice
        const ticker = tickerPrices.get(coin.id);
        const price = ticker?.price ?? coin.currentPrice;
        if (price != null && price > 0) {
          priceMap.set(symbol, price);
        }
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to fetch current prices, will fall back to avg prices: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return priceMap;
  }

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
      // Single DB call — compute by-symbol aggregation and realized PnL in-memory
      const allPositions = await this.positionTracking.getPositions(userId);

      // Aggregate positions by symbol (replicates getAllUserPositionsBySymbol logic)
      const positionsBySymbol = new Map<string, { quantity: Decimal; weightedCost: Decimal; pnl: Decimal }>();
      let totalRealizedPnL = new Decimal(0);

      for (const position of allPositions) {
        const qty = new Decimal(position.quantity);
        const price = new Decimal(position.avgEntryPrice);
        const realized = new Decimal(position.realizedPnL);
        const unrealized = new Decimal(position.unrealizedPnL);

        totalRealizedPnL = totalRealizedPnL.plus(realized);

        const existing = positionsBySymbol.get(position.symbol);
        if (existing) {
          const newWeightedCost = existing.weightedCost.plus(qty.times(price));
          existing.quantity = existing.quantity.plus(qty);
          existing.weightedCost = newWeightedCost;
          existing.pnl = existing.pnl.plus(realized).plus(unrealized);
        } else {
          positionsBySymbol.set(position.symbol, {
            quantity: qty,
            weightedCost: qty.times(price),
            pnl: realized.plus(unrealized)
          });
        }
      }

      // Fetch current market prices for all symbols
      const symbols = [...positionsBySymbol.keys()];
      const currentPrices = await this.fetchCurrentPrices(symbols);

      // Convert Map to array of aggregated positions
      const aggregatedPositions: AggregatedPosition[] = [];
      let totalUnrealizedPnL = new Decimal(0);

      for (const [symbol, data] of positionsBySymbol) {
        const quantity = data.quantity.toNumber();
        const avgPrice = data.quantity.gt(0) ? data.weightedCost.div(data.quantity).toNumber() : 0;
        const marketPrice = currentPrices.get(symbol);

        const currentValue = new Decimal(quantity).times(marketPrice ?? avgPrice).toNumber();
        const unrealizedPnL = marketPrice
          ? new Decimal(marketPrice).minus(avgPrice).times(quantity).toNumber()
          : data.pnl.toNumber();

        totalUnrealizedPnL = totalUnrealizedPnL.plus(unrealizedPnL);

        aggregatedPositions.push({
          symbol,
          quantity,
          avgEntryPrice: avgPrice,
          currentPrice: marketPrice,
          currentValue,
          unrealizedPnL,
          strategies: this.getStrategiesForSymbol(allPositions, symbol)
        });
      }

      // Calculate total portfolio value
      const totalValue = aggregatedPositions.reduce(
        (sum, pos) => new Decimal(sum).plus(pos.currentValue).toNumber(),
        0
      );
      const totalPnL = new Decimal(totalRealizedPnL).plus(totalUnrealizedPnL).toNumber();

      return {
        totalValue,
        positions: aggregatedPositions,
        totalPnL,
        realizedPnL: totalRealizedPnL.toNumber(),
        unrealizedPnL: totalUnrealizedPnL.toNumber()
      };
    } catch (error: unknown) {
      this.logger.error(
        `Failed to get aggregated portfolio for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
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

      // Fetch current market prices for all position symbols
      const allSymbols = [...new Set(positions.map((p) => p.symbol))];
      const currentPrices = await this.fetchCurrentPrices(allSymbols);

      // Group by strategy
      const positionsByStrategy = new Map<string, typeof positions>();
      for (const position of positions) {
        const strategyId = position.strategyConfigId;
        if (!positionsByStrategy.has(strategyId)) {
          positionsByStrategy.set(strategyId, []);
        }
        positionsByStrategy.get(strategyId)?.push(position);
      }

      // Calculate P&L per strategy from already-fetched positions (no extra DB calls)
      const breakdown: StrategyPositionBreakdown[] = [];
      for (const [strategyId, strategyPositions] of positionsByStrategy.entries()) {
        const realizedPnL = strategyPositions.reduce(
          (sum, pos) => new Decimal(sum).plus(pos.realizedPnL).toNumber(),
          0
        );

        let strategyUnrealizedPnL = new Decimal(0);
        const mappedPositions = strategyPositions.map((p) => {
          const qty = new Decimal(p.quantity);
          const avgPrice = new Decimal(p.avgEntryPrice);
          const marketPrice = currentPrices.get(p.symbol);
          const unrealizedPnL = marketPrice
            ? new Decimal(marketPrice).minus(avgPrice).times(qty).toNumber()
            : Number(p.unrealizedPnL);
          strategyUnrealizedPnL = strategyUnrealizedPnL.plus(unrealizedPnL);

          return {
            symbol: p.symbol,
            quantity: qty.toNumber(),
            avgEntryPrice: avgPrice.toNumber(),
            currentPrice: marketPrice,
            unrealizedPnL
          };
        });

        breakdown.push({
          strategyId,
          positions: mappedPositions,
          totalPnL: new Decimal(realizedPnL).plus(strategyUnrealizedPnL).toNumber(),
          realizedPnL,
          unrealizedPnL: strategyUnrealizedPnL.toNumber()
        });
      }

      return breakdown;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to get positions by strategy for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
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
        percentage: new Decimal(position.currentValue).div(portfolio.totalValue).times(100).toNumber(),
        quantity: position.quantity
      }));
    } catch (error: unknown) {
      this.logger.error(
        `Failed to get allocation breakdown for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
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
  currentPrice?: number; // Live market price (undefined if unavailable)
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
    currentPrice?: number;
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
