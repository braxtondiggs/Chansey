import { Injectable, Logger } from '@nestjs/common';

import * as ccxt from 'ccxt';

import { toErrorInfo } from '../../shared/error.util';
import { OrderSide, OrderType } from '../order.entity';

/**
 * Stateless service for calculating exchange trading fees and slippage.
 *
 * Fee determination follows the 3-level fallback chain:
 *   1. Exchange API (fetchTradingFees)
 *   2. Pre-loaded exchange.markets data
 *   3. Hardcoded defaults per exchange slug
 *
 * Maker/Taker is determined by order TYPE, not side:
 *   - LIMIT orders add liquidity (maker)
 *   - MARKET/STOP/etc. take liquidity (taker)
 */
@Injectable()
export class TradingFeesService {
  private readonly logger = new Logger(TradingFeesService.name);

  /**
   * Get trading fees with proper maker/taker determination.
   */
  async getTradingFees(
    exchange: ccxt.Exchange,
    exchangeSlug: string,
    orderType: OrderType,
    orderValue: number,
    symbol?: string
  ): Promise<{ feeRate: number; feeAmount: number }> {
    const isMaker = orderType === OrderType.LIMIT;
    const feeKey = isMaker ? 'maker' : 'taker';

    try {
      const tradingFees = await exchange.fetchTradingFees();
      this.logger.debug(`Trading fees from API for ${exchangeSlug}: ${JSON.stringify(tradingFees)}`);

      // CCXT types fetchTradingFees() as Dictionary<TradingFeeInterface> keyed by symbol
      // (Kraken/Coinbase), but some exchanges return a flat { maker, taker } object (Binance).
      // Try symbol-keyed first, then top-level.
      const fees = tradingFees as Record<string, unknown>;
      let rawRate: unknown;
      if (symbol && fees[symbol] && typeof fees[symbol] === 'object') {
        rawRate = (fees[symbol] as Record<string, unknown>)[feeKey];
      }
      if (typeof rawRate !== 'number') {
        rawRate = fees[feeKey];
      }

      if (typeof rawRate === 'number') {
        const feeRate = rawRate;
        return { feeRate, feeAmount: orderValue * feeRate };
      }

      // Symbol-keyed response but symbol not found / non-numeric — fall through to markets/defaults
      throw new Error('Unable to resolve fee rate from fetchTradingFees response');
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to fetch trading fees from API for ${exchangeSlug}: ${err.message}`);

      // Fallback 1: Try to get fees from exchange.markets (pre-loaded market data)
      try {
        if (exchange.markets && Object.keys(exchange.markets).length > 0) {
          let market: ccxt.Market | undefined;
          if (symbol && exchange.markets[symbol]) {
            market = exchange.markets[symbol];
          } else {
            for (const key in exchange.markets) {
              market = exchange.markets[key];
              break;
            }
          }

          if (market) {
            const feeRate = isMaker ? market.maker || 0.001 : market.taker || 0.001;
            const feeAmount = orderValue * feeRate;

            this.logger.debug(`Using market fees for ${exchangeSlug}: ${feeRate} (${isMaker ? 'maker' : 'taker'})`);
            return { feeRate, feeAmount };
          }
        }
      } catch (marketError: unknown) {
        const mErr = toErrorInfo(marketError);
        this.logger.warn(`Failed to get fees from markets for ${exchangeSlug}: ${mErr.message}`);
      }

      // Fallback 2: Use exchange-specific default fees
      const defaultFees = this.getDefaultFees(exchangeSlug);
      const feeRate = isMaker ? defaultFees.maker : defaultFees.taker;
      const feeAmount = orderValue * feeRate;

      this.logger.debug(`Using default fees for ${exchangeSlug}: ${feeRate} (${isMaker ? 'maker' : 'taker'})`);
      return { feeRate, feeAmount };
    }
  }

  /**
   * Get default fees for exchanges when API is unavailable.
   */
  getDefaultFees(exchangeSlug: string): { maker: number; taker: number } {
    const defaultFees: Record<string, { maker: number; taker: number }> = {
      binanceus: { maker: 0.001, taker: 0.001 },
      binance: { maker: 0.001, taker: 0.001 },
      coinbase: { maker: 0.004, taker: 0.006 },
      coinbasepro: { maker: 0.004, taker: 0.006 },
      coinbaseexchange: { maker: 0.004, taker: 0.006 },
      kraken: { maker: 0.0016, taker: 0.0026 },
      kucoin: { maker: 0.001, taker: 0.001 },
      okx: { maker: 0.0008, taker: 0.001 }
    };

    return defaultFees[exchangeSlug] || { maker: 0.001, taker: 0.001 };
  }

  /**
   * Calculate estimated slippage (percentage) for a market order by walking the order book.
   */
  calculateSlippage(orderBook: ccxt.OrderBook, quantity: number, side: OrderSide): number {
    try {
      const orders = side === OrderSide.BUY ? orderBook.asks : orderBook.bids;
      if (!orders || orders.length === 0) return 0;

      let remainingQuantity = quantity;
      let totalCost = 0;

      for (const entry of orders) {
        if (remainingQuantity <= 0) break;

        const price = Number(entry[0] ?? 0);
        const availableQuantity = Number(entry[1] ?? 0);
        const quantityToTake = Math.min(remainingQuantity, availableQuantity);
        totalCost += quantityToTake * price;
        remainingQuantity -= quantityToTake;
      }

      if (quantity > 0) {
        const filledQuantity = quantity - remainingQuantity;
        if (filledQuantity <= 0) return 0;
        const weightedAveragePrice = totalCost / filledQuantity;
        const marketPrice = Number(orders[0][0] ?? 0);
        if (marketPrice === 0) return 0;
        const slippage = Math.abs((weightedAveragePrice - marketPrice) / marketPrice) * 100;
        return Math.round(slippage * 100) / 100;
      }

      return 0;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to calculate slippage: ${err.message}`);
      return 0;
    }
  }
}
