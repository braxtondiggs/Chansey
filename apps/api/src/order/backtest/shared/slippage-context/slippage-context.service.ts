import { Injectable } from '@nestjs/common';

import { OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { SpreadEstimationContext } from '../slippage';

@Injectable()
export class SlippageContextService {
  /**
   * Extract daily volume from OHLC candles for a specific coin.
   * Accepts a pre-built Map<coinId, OHLCCandle> for O(1) lookup.
   */
  extractDailyVolume(priceMap: Map<string, OHLCCandle>, coinId: string): number | undefined {
    const candle = priceMap.get(coinId);
    if (!candle) return undefined;
    // Convert base-currency volume to quote-currency (USD) for participation rate math.
    // quoteVolume is preferred but typically NULL (CCXT fetchOHLCV doesn't provide it).
    return candle.quoteVolume ?? (candle.volume ? candle.volume * candle.close : undefined);
  }

  /**
   * Build spread estimation context from current and previous candle data.
   * Accepts a pre-built Map<coinId, OHLCCandle> for O(1) lookup.
   * Returns undefined if no candle found for the given coinId.
   */
  buildSpreadContext(
    priceMap: Map<string, OHLCCandle>,
    coinId: string,
    prevCandleMap: Map<string, OHLCCandle>
  ): SpreadEstimationContext | undefined {
    const candle = priceMap.get(coinId);
    if (!candle || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 || candle.high <= candle.low)
      return undefined;

    const prev = prevCandleMap.get(coinId);
    const prevHigh = prev?.high;
    const prevLow = prev?.low;
    return {
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      prevHigh: Number.isFinite(prevHigh) ? prevHigh : undefined,
      prevLow: Number.isFinite(prevLow) ? prevLow : undefined
    };
  }

  /**
   * Update the previous candle map with current prices for next iteration
   */
  updatePrevCandleMap(prevCandleMap: Map<string, OHLCCandle>, currentPrices: OHLCCandle[]): void {
    for (const candle of currentPrices) {
      prevCandleMap.set(candle.coinId, candle);
    }
  }

  /**
   * Get participation rate defaults based on risk level
   */
  getParticipationDefaults(riskLevel: number): {
    participationRateLimit: number;
    rejectParticipationRate: number;
  } {
    const defaults = [
      { participationRateLimit: 0.02, rejectParticipationRate: 0.25 }, // risk 1
      { participationRateLimit: 0.03, rejectParticipationRate: 0.3 }, // risk 2
      { participationRateLimit: 0.05, rejectParticipationRate: 0.5 }, // risk 3
      { participationRateLimit: 0.08, rejectParticipationRate: 0.6 }, // risk 4
      { participationRateLimit: 0.1, rejectParticipationRate: 0.75 } // risk 5
    ];
    return defaults[Math.max(0, Math.min(4, (riskLevel ?? 3) - 1))];
  }
}
