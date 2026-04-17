import { Injectable } from '@nestjs/common';

import { binarySearchLeft, binarySearchRight } from './binary-search.util';
import { MultiTimeframeAggregatorService } from './multi-timeframe-aggregator.service';
import { PRICE_TIMEFRAME_WINDOW_SIZES, PriceTimeframe } from './price-timeframe';

import { Coin } from '../../../../coin/coin.entity';
import { OHLCCandle, PriceSummary, PriceSummaryByPeriod } from '../../../../ohlc/ohlc-candle.entity';
import { IncrementalSma } from '../../incremental-sma';
import { RingBuffer } from '../../ring-buffer';
import { ImmutablePriceTrackingData, PrecomputedWindowData } from '../optimization';

/** Maximum price history entries kept per coin in the sliding window. */
const MAX_WINDOW_SIZE = 500;

/**
 * Per-timeframe mutable state mirroring the base 1h tracking context.
 * Populated by `initMultiTimeframe` and advanced by
 * `advanceMultiTimeframeWindows` in lockstep with the base loop.
 */
export interface TimeframeTrackingState {
  summariesByCoin: Map<string, PriceSummary[]>;
  timestampsByCoin: Map<string, Date[]>;
  indexByCoin: Map<string, number>;
  windowsByCoin: Map<string, RingBuffer<PriceSummary>>;
}

export interface PriceTrackingContext {
  timestampsByCoin: Map<string, Date[]>;
  summariesByCoin: Map<string, PriceSummary[]>;
  indexByCoin: Map<string, number>;
  windowsByCoin: Map<string, RingBuffer<PriceSummary>>;
  /** Optional higher-timeframe tracking (4h / 1d / 1w). */
  higherTimeframes?: Map<PriceTimeframe, TimeframeTrackingState>;
  btcRegimeSma?: IncrementalSma;
  btcCoinId?: string;
}

/**
 * Pre-aggregated higher-TF summaries organized by coin, used to prime
 * optimization runs (built once per unique date range, reused per combo).
 */
export type AggregatedTimeframes = Map<PriceTimeframe, Map<string, PriceSummary[]>>;

@Injectable()
export class PriceWindowService {
  constructor(private readonly aggregator: MultiTimeframeAggregatorService) {}

  getPriceTimestamp(candle: OHLCCandle): Date {
    return candle.timestamp;
  }

  getPriceValue(candle: OHLCCandle): number {
    return candle.close;
  }

  buildPriceSummary(candle: OHLCCandle): PriceSummary {
    return {
      avg: candle.close,
      coin: candle.coinId,
      date: candle.timestamp,
      high: candle.high,
      low: candle.low,
      open: candle.open,
      close: candle.close,
      volume: candle.volume
    };
  }

  /**
   * Resolve the opening price for next-bar execution.
   * Falls back to `avg` for aggregated summaries where `open` may be missing.
   */
  getOpenPriceValue(candle: OHLCCandle | PriceSummary): number {
    if ('coinId' in candle) {
      return candle.open;
    }
    return candle.open ?? candle.avg;
  }

  initPriceTracking(historicalPrices: OHLCCandle[], coinIds: string[]): PriceTrackingContext {
    const { timestampsByCoin, summariesByCoin } = this.groupAndSortByCoins(historicalPrices, coinIds);
    const indexByCoin = new Map<string, number>();
    const windowsByCoin = new Map<string, RingBuffer<PriceSummary>>();

    for (const coinId of coinIds) {
      indexByCoin.set(coinId, -1);
      windowsByCoin.set(coinId, new RingBuffer<PriceSummary>(MAX_WINDOW_SIZE));
    }

    return { timestampsByCoin, summariesByCoin, indexByCoin, windowsByCoin };
  }

  buildImmutablePriceData(historicalPrices: OHLCCandle[], coinIds: string[]): ImmutablePriceTrackingData {
    return this.groupAndSortByCoins(historicalPrices, coinIds);
  }

  private groupAndSortByCoins(
    historicalPrices: OHLCCandle[],
    coinIds: string[]
  ): { timestampsByCoin: Map<string, Date[]>; summariesByCoin: Map<string, PriceSummary[]> } {
    const timestampsByCoin = new Map<string, Date[]>();
    const summariesByCoin = new Map<string, PriceSummary[]>();

    const pricesByCoin = new Map<string, OHLCCandle[]>();
    for (const candle of historicalPrices) {
      let group = pricesByCoin.get(candle.coinId);
      if (!group) {
        group = [];
        pricesByCoin.set(candle.coinId, group);
      }
      group.push(candle);
    }

    for (const coinId of coinIds) {
      const history = (pricesByCoin.get(coinId) ?? []).sort(
        (a, b) => this.getPriceTimestamp(a).getTime() - this.getPriceTimestamp(b).getTime()
      );
      timestampsByCoin.set(
        coinId,
        history.map((price) => this.getPriceTimestamp(price))
      );
      summariesByCoin.set(
        coinId,
        history.map((price) => this.buildPriceSummary(price))
      );
    }

    return { timestampsByCoin, summariesByCoin };
  }

  initPriceTrackingFromPrecomputed(
    immutable: ImmutablePriceTrackingData,
    aggregatedTimeframes?: AggregatedTimeframes
  ): PriceTrackingContext {
    const indexByCoin = new Map<string, number>();
    const windowsByCoin = new Map<string, RingBuffer<PriceSummary>>();

    for (const coinId of immutable.timestampsByCoin.keys()) {
      indexByCoin.set(coinId, -1);
      windowsByCoin.set(coinId, new RingBuffer<PriceSummary>(MAX_WINDOW_SIZE));
    }

    const ctx: PriceTrackingContext = {
      timestampsByCoin: immutable.timestampsByCoin,
      summariesByCoin: immutable.summariesByCoin,
      indexByCoin,
      windowsByCoin
    };

    if (aggregatedTimeframes) {
      this.initMultiTimeframe(ctx, aggregatedTimeframes);
    }

    return ctx;
  }

  advancePriceWindows(ctx: PriceTrackingContext, coins: Coin[], timestamp: Date): PriceSummaryByPeriod {
    const priceData: PriceSummaryByPeriod = {};
    for (const coin of coins) {
      const coinTimestamps = ctx.timestampsByCoin.get(coin.id) ?? [];
      const summaries = ctx.summariesByCoin.get(coin.id) ?? [];
      const window = ctx.windowsByCoin.get(coin.id);
      if (!window) continue;
      let pointer = ctx.indexByCoin.get(coin.id) ?? -1;
      while (pointer + 1 < coinTimestamps.length && coinTimestamps[pointer + 1] <= timestamp) {
        pointer += 1;
        window.push(summaries[pointer]);
        if (ctx.btcRegimeSma && coin.id === ctx.btcCoinId) {
          // close is optional on PriceSummary; fall back to avg (always present)
          ctx.btcRegimeSma.push(summaries[pointer].close ?? summaries[pointer].avg);
        }
      }
      ctx.indexByCoin.set(coin.id, pointer);
      if (window.length > 0) {
        priceData[coin.id] = window.toArray();
      }
    }
    return priceData;
  }

  /**
   * Prime a tracking context with higher-timeframe state from pre-aggregated summaries.
   * Must be called after `initPriceTracking` (or `initPriceTrackingFromPrecomputed`)
   * but before the first `advanceMultiTimeframeWindows` call.
   */
  initMultiTimeframe(ctx: PriceTrackingContext, aggregated: AggregatedTimeframes): void {
    const higherTimeframes = new Map<PriceTimeframe, TimeframeTrackingState>();
    for (const [tf, perCoin] of aggregated) {
      if (tf === PriceTimeframe.HOURLY) continue;
      const windowSize = PRICE_TIMEFRAME_WINDOW_SIZES[tf];
      const summariesByCoin = new Map<string, PriceSummary[]>();
      const timestampsByCoin = new Map<string, Date[]>();
      const indexByCoin = new Map<string, number>();
      const windowsByCoin = new Map<string, RingBuffer<PriceSummary>>();

      for (const [coinId, summaries] of perCoin) {
        summariesByCoin.set(coinId, summaries);
        timestampsByCoin.set(
          coinId,
          summaries.map((s) => s.date)
        );
        indexByCoin.set(coinId, -1);
        windowsByCoin.set(coinId, new RingBuffer<PriceSummary>(windowSize));
      }

      higherTimeframes.set(tf, { summariesByCoin, timestampsByCoin, indexByCoin, windowsByCoin });
    }
    ctx.higherTimeframes = higherTimeframes;
  }

  /**
   * Advance each configured higher-timeframe window up to (and including) `timestamp`.
   * Returns a per-timeframe price data map for direct consumption by
   * `AlgorithmContext.priceDataByTimeframe`.
   */
  advanceMultiTimeframeWindows(
    ctx: PriceTrackingContext,
    coins: Coin[],
    timestamp: Date
  ): Partial<Record<PriceTimeframe, PriceSummaryByPeriod>> {
    const out: Partial<Record<PriceTimeframe, PriceSummaryByPeriod>> = {};
    if (!ctx.higherTimeframes) return out;

    for (const [tf, state] of ctx.higherTimeframes) {
      const tfData: PriceSummaryByPeriod = {};
      for (const coin of coins) {
        const coinTimestamps = state.timestampsByCoin.get(coin.id) ?? [];
        const summaries = state.summariesByCoin.get(coin.id) ?? [];
        const window = state.windowsByCoin.get(coin.id);
        if (!window) continue;
        let pointer = state.indexByCoin.get(coin.id) ?? -1;
        while (pointer + 1 < coinTimestamps.length && coinTimestamps[pointer + 1] <= timestamp) {
          pointer += 1;
          window.push(summaries[pointer]);
        }
        state.indexByCoin.set(coin.id, pointer);
        if (window.length > 0) {
          tfData[coin.id] = window.toArray();
        }
      }
      out[tf] = tfData;
    }

    return out;
  }

  clearPriceData(pricesByTimestamp: Record<string, OHLCCandle[]>, priceCtx: PriceTrackingContext): void {
    for (const key of Object.keys(pricesByTimestamp)) {
      delete pricesByTimestamp[key];
    }
    priceCtx.timestampsByCoin.clear();
    priceCtx.summariesByCoin.clear();
    priceCtx.windowsByCoin.clear();
    priceCtx.indexByCoin.clear();
    if (priceCtx.higherTimeframes) {
      for (const state of priceCtx.higherTimeframes.values()) {
        state.summariesByCoin.clear();
        state.timestampsByCoin.clear();
        state.windowsByCoin.clear();
        state.indexByCoin.clear();
      }
      priceCtx.higherTimeframes.clear();
      priceCtx.higherTimeframes = undefined;
    }
    priceCtx.btcRegimeSma = undefined;
    priceCtx.btcCoinId = undefined;
  }

  groupPricesByTimestamp(candles: OHLCCandle[]): Record<string, OHLCCandle[]> {
    return candles.reduce(
      (grouped, candle) => {
        const timestamp = candle.timestamp.toISOString();
        if (!grouped[timestamp]) {
          grouped[timestamp] = [];
        }
        grouped[timestamp].push(candle);
        return grouped;
      },
      {} as Record<string, OHLCCandle[]>
    );
  }

  /**
   * Extract and concatenate candle segments for all coins within a time range.
   * Uses binary search for O(log N) range extraction per coin.
   */
  extractCandleSegments(
    coins: Coin[],
    preloadedCandlesByCoin: Map<string, OHLCCandle[]>,
    startTime: number,
    endTime: number
  ): OHLCCandle[] {
    const coinIds = new Set(coins.map((coin) => coin.id));
    const segments: OHLCCandle[][] = [];
    let totalLen = 0;

    for (const coinId of coinIds) {
      const coinCandles = preloadedCandlesByCoin.get(coinId);
      if (!coinCandles || coinCandles.length === 0) continue;

      const left = binarySearchLeft(coinCandles, startTime);
      const right = binarySearchRight(coinCandles, endTime);
      if (left < right) {
        const segment = coinCandles.slice(left, right);
        segments.push(segment);
        totalLen += segment.length;
      }
    }

    const result = new Array<OHLCCandle>(totalLen);
    let offset = 0;
    for (const seg of segments) {
      for (let i = 0; i < seg.length; i++) {
        result[offset++] = seg[i];
      }
    }
    return result;
  }

  /**
   * Pre-compute all expensive per-window data once for a single date range.
   * Called once per unique date range by the orchestrator, then reused across all parameter combinations.
   * Combines binary search filtering, groupPricesByTimestamp(), buildImmutablePriceData(), and volume map construction.
   */
  precomputeWindowData(
    coins: Coin[],
    preloadedCandlesByCoin: Map<string, OHLCCandle[]>,
    startDate: Date,
    endDate: Date
  ): PrecomputedWindowData {
    const filteredCandles = this.extractCandleSegments(
      coins,
      preloadedCandlesByCoin,
      startDate.getTime(),
      endDate.getTime()
    );

    const pricesByTimestamp = this.groupPricesByTimestamp(filteredCandles);
    const timestamps = Object.keys(pricesByTimestamp).sort();
    const coinIdArray = coins.map((c) => c.id);
    const immutablePriceData = this.buildImmutablePriceData(filteredCandles, coinIdArray);

    // Precompute volume lookup: timestamp+coinId -> volume
    const volumeMap = new Map<string, number>();
    for (const tsKey of timestamps) {
      for (const candle of pricesByTimestamp[tsKey]) {
        if (candle.volume != null) {
          const quoteVol = candle.quoteVolume ?? candle.volume * candle.close;
          volumeMap.set(`${tsKey}:${candle.coinId}`, quoteVol);
        }
      }
    }

    const aggregatedTimeframes = this.aggregator.aggregate(immutablePriceData.summariesByCoin);
    return {
      pricesByTimestamp,
      timestamps,
      immutablePriceData,
      volumeMap,
      filteredCandles,
      tradingStartIndex: 0,
      aggregatedTimeframes
    };
  }

  async filterCoinsWithSufficientData(
    algorithmId: string,
    coins: Coin[],
    parameters: Record<string, unknown>,
    summariesByCoin: Map<string, PriceSummary[]>,
    algorithmRegistry: {
      getStrategyForAlgorithm(
        id: string
      ): Promise<{ getMinDataPoints?: (params: Record<string, unknown>) => number } | null | undefined>;
    }
  ): Promise<{ filtered: Coin[]; excludedCount: number; excludedDetails: string[] }> {
    const strategy = await algorithmRegistry.getStrategyForAlgorithm(algorithmId);

    if (!strategy?.getMinDataPoints) {
      return { filtered: coins, excludedCount: 0, excludedDetails: [] };
    }

    const minRequired = strategy.getMinDataPoints(parameters);
    if (minRequired <= 0) {
      return { filtered: coins, excludedCount: 0, excludedDetails: [] };
    }

    const excluded: string[] = [];
    const filtered = coins.filter((coin) => {
      const totalBars = summariesByCoin.get(coin.id)?.length ?? 0;
      if (totalBars < minRequired) {
        excluded.push(`${coin.symbol}(${totalBars}/${minRequired})`);
        return false;
      }
      return true;
    });

    return { filtered, excludedCount: excluded.length, excludedDetails: excluded };
  }
}
