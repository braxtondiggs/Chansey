import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import { Coin } from './coin.entity';

import { CorrelationCalculator } from '../common/metrics/correlation.calculator';
import { MetricsService } from '../metrics/metrics.service';
import { OHLCService } from '../ohlc/ohlc.service';

/** Multiplier used by callers to oversample the risk-level shortlist before pruning. */
export const SHORTLIST_MULTIPLIER = 3;

const CORRELATION_THRESHOLD = 0.85;
const CORRELATION_WINDOW_DAYS = 90;
const MIN_ALIGNED_RETURNS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Correlation-aware shortlist pruning for coin selection.
 *
 * Oversampling the ranked coin universe and then vetoing near-duplicates keeps the
 * final selection from being dominated by co-moving assets (e.g., alt-coins that
 * track BTC). Rank #1 is always locked; rank #2 is locked only when it's not
 * strongly correlated with #1.
 */
@Injectable()
export class CoinDiversityService {
  private readonly logger = new Logger(CoinDiversityService.name);

  constructor(
    @Inject(forwardRef(() => OHLCService))
    private readonly ohlc: OHLCService,
    private readonly correlationCalculator: CorrelationCalculator,
    private readonly metrics: MetricsService
  ) {}

  async pruneByDiversity(shortlist: Coin[], take: number): Promise<Coin[]> {
    if (shortlist.length <= take) return shortlist;

    const now = new Date();
    const start = new Date(now.getTime() - CORRELATION_WINDOW_DAYS * MS_PER_DAY);
    const coinIds = shortlist.map((c) => c.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
    const candlesByCoin = await this.ohlc.getCandlesByDateRangeGrouped(coinIds, start, now);

    const priceMaps = new Map<string, Map<number, number>>();
    let totalCandles = 0;
    for (const [coinId, candles] of Object.entries(candlesByCoin)) {
      const m = new Map<number, number>();
      for (const candle of candles) {
        m.set(candle.timestamp.getTime(), candle.close);
      }
      if (m.size > 0) priceMaps.set(coinId, m);
      totalCandles += m.size;
    }

    if (totalCandles === 0) {
      this.logger.warn(
        `diversity_fallback_no_ohlc: no OHLC data for any of ${shortlist.length} shortlisted coins — returning rank-order top ${take}`
      );
      this.metrics.recordDiversityPruningFallback('no_ohlc');
      return shortlist.slice(0, take);
    }

    const picked: Coin[] = [shortlist[0]];
    let vetoedCount = 0;

    if (shortlist.length > 1 && picked.length < take) {
      const second = shortlist[1];
      const corr = this.computePairwiseCorrelation(shortlist[0], second, priceMaps);
      if (corr === null || corr <= CORRELATION_THRESHOLD) {
        picked.push(second);
      } else {
        vetoedCount++;
      }
    }

    for (let i = 2; i < shortlist.length && picked.length < take; i++) {
      const candidate = shortlist[i];
      if (!priceMaps.has(candidate.id)) {
        picked.push(candidate);
        continue;
      }
      let rejected = false;
      for (const already of picked) {
        const corr = this.computePairwiseCorrelation(candidate, already, priceMaps);
        if (corr !== null && corr > CORRELATION_THRESHOLD) {
          rejected = true;
          break;
        }
      }
      if (rejected) {
        vetoedCount++;
      } else {
        picked.push(candidate);
      }
    }

    if (picked.length < take) {
      const pickedIds = new Set(picked.map((c) => c.id));
      let backfilledCount = 0;
      for (const coin of shortlist) {
        if (picked.length >= take) break;
        if (!pickedIds.has(coin.id)) {
          picked.push(coin);
          backfilledCount++;
        }
      }
      this.logger.warn(
        `diversity_backfilled: shortlistSize=${shortlist.length} vetoedCount=${vetoedCount} backfilledCount=${backfilledCount}`
      );
      this.metrics.recordDiversityPruningFallback('backfill_after_veto');
    }

    return picked;
  }

  /**
   * Pairwise Pearson correlation of simple returns over the intersection of
   * available timestamps. Returns `null` when price history is missing or the
   * aligned window is too short to be statistically meaningful — callers should
   * treat `null` as "unknown, don't veto".
   */
  private computePairwiseCorrelation(
    coinA: Coin,
    coinB: Coin,
    priceMaps: Map<string, Map<number, number>>
  ): number | null {
    const mapA = priceMaps.get(coinA.id);
    const mapB = priceMaps.get(coinB.id);
    if (!mapA || !mapB || mapA.size === 0 || mapB.size === 0) return null;

    const sharedTimestamps: number[] = [];
    // mapA preserves ascending-timestamp insertion order from OHLCService.getCandlesByDateRange
    // (`.orderBy('candle.timestamp', 'ASC')`), so iterating mapA.keys() yields sorted timestamps.
    for (const ts of mapA.keys()) {
      if (mapB.has(ts)) sharedTimestamps.push(ts);
    }
    if (sharedTimestamps.length < MIN_ALIGNED_RETURNS + 1) return null;

    const closesA: number[] = [];
    const closesB: number[] = [];
    for (const ts of sharedTimestamps) {
      closesA.push(mapA.get(ts) as number);
      closesB.push(mapB.get(ts) as number);
    }

    const returnsA: number[] = [];
    const returnsB: number[] = [];
    for (let i = 1; i < closesA.length; i++) {
      const prevA = closesA[i - 1];
      const prevB = closesB[i - 1];
      if (prevA === 0 || prevB === 0) continue;
      returnsA.push(closesA[i] / prevA - 1);
      returnsB.push(closesB[i] / prevB - 1);
    }

    if (returnsA.length < MIN_ALIGNED_RETURNS) return null;

    return this.correlationCalculator.calculatePearsonCorrelation(returnsA, returnsB);
  }
}
