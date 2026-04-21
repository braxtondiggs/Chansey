import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { type QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { BacktestSignal, SignalDirection, SignalType } from './backtest-signal.entity';
import {
  BacktestSummary,
  ConfidenceBucketBreakdown,
  InstrumentSignalBreakdown,
  InstrumentTradeBreakdown,
  SignalOutcomeBucket
} from './backtest-summary.entity';
import { BacktestTrade, TradeType } from './backtest-trade.entity';
import { SimulatedOrderFill } from './simulated-order-fill.entity';
import { buildHistogram, HOLD_TIME_BUCKET_EDGES, SLIPPAGE_BPS_BUCKET_EDGES } from './summary-histogram.util';

import { Coin } from '../../coin/coin.entity';

const CONFIDENCE_BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
  { label: '0-20%', lo: 0, hi: 0.2 },
  { label: '20-40%', lo: 0.2, hi: 0.4 },
  { label: '40-60%', lo: 0.4, hi: 0.6 },
  { label: '60-80%', lo: 0.6, hi: 0.8 },
  { label: '80-100%', lo: 0.8, hi: 1.0001 }
];

function emptyOutcome(): SignalOutcomeBucket {
  return { count: 0, wins: 0, losses: 0, returnSum: 0, returnCount: 0 };
}

interface ResolvedSellTrade {
  executedAt: Date;
  realizedPnL: number | null;
  realizedPnLPercent: number | null;
  baseCoinId: string | null;
}

@Injectable()
export class BacktestSummaryService {
  private readonly logger = new Logger(BacktestSummaryService.name);

  constructor(
    @InjectRepository(BacktestSummary) private readonly summaryRepo: Repository<BacktestSummary>,
    @InjectRepository(BacktestSignal) private readonly signalRepo: Repository<BacktestSignal>,
    @InjectRepository(BacktestTrade) private readonly tradeRepo: Repository<BacktestTrade>,
    @InjectRepository(SimulatedOrderFill) private readonly fillRepo: Repository<SimulatedOrderFill>,
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>
  ) {}

  async computeAndPersist(backtestId: string): Promise<void> {
    const [signals, trades, fills] = await Promise.all([
      this.signalRepo
        .createQueryBuilder('s')
        .where('s.backtestId = :backtestId', { backtestId })
        .select(['s.id', 's.signalType', 's.direction', 's.instrument', 's.confidence', 's.timestamp'])
        .getMany(),
      this.tradeRepo
        .createQueryBuilder('t')
        .leftJoinAndSelect('t.baseCoin', 'bc')
        .leftJoinAndSelect('t.quoteCoin', 'qc')
        .where('t.backtestId = :backtestId', { backtestId })
        .getMany(),
      this.fillRepo
        .createQueryBuilder('f')
        .where('f.backtestId = :backtestId', { backtestId })
        .select(['f.slippageBps', 'f.filledQuantity', 'f.averagePrice'])
        .getMany()
    ]);

    // Build lookup maps for instrument resolution. Some signals store UUIDs; others
    // already use SYMBOL format. Resolve UUIDs → symbol-only (e.g., "BTC") so that
    // signals-by-instrument keys line up with trade base-coin symbols.
    const uuidSet = new Set<string>();
    for (const s of signals) {
      if (s.instrument && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.instrument)) {
        uuidSet.add(s.instrument);
      }
    }
    const coinLookup = new Map<string, string>();
    if (uuidSet.size > 0) {
      const coins = await this.coinRepo
        .createQueryBuilder('c')
        .select(['c.id', 'c.symbol'])
        .where('c.id IN (:...ids)', { ids: [...uuidSet] })
        .getMany();
      for (const c of coins) {
        coinLookup.set(c.id.toLowerCase(), c.symbol.toUpperCase());
      }
    }

    const resolveSignalInstrument = (raw: string | null | undefined): string => {
      if (!raw) return 'UNKNOWN';
      const resolved = coinLookup.get(raw.toLowerCase());
      return (resolved ?? raw).toUpperCase();
    };

    // ---- Sells: collect sell trades with resolved baseCoinId for hold-time/PnL ----
    const sellTrades: ResolvedSellTrade[] = [];
    for (const t of trades) {
      if (t.type !== TradeType.SELL) continue;
      const baseCoinId = t.baseCoin?.id ?? null;
      sellTrades.push({
        executedAt: t.executedAt,
        realizedPnL: t.realizedPnL ?? null,
        realizedPnLPercent: t.realizedPnLPercent ?? null,
        baseCoinId
      });
    }

    // Group sell trades by baseCoinId and by resolved symbol so signal-outcome
    // attribution is O(log T) per signal instead of O(T). Signals can either
    // store a coin UUID (matches `sellsByBaseId`) or a plain symbol (matches
    // `sellsByResolvedSymbol` via coinLookup).
    const sellsByBaseId = new Map<string, ResolvedSellTrade[]>();
    const sellsByResolvedSymbol = new Map<string, ResolvedSellTrade[]>();
    for (const t of sellTrades) {
      if (!t.baseCoinId) continue;
      const idKey = t.baseCoinId.toLowerCase();
      let byId = sellsByBaseId.get(idKey);
      if (!byId) {
        byId = [];
        sellsByBaseId.set(idKey, byId);
      }
      byId.push(t);
      const symbol = coinLookup.get(idKey);
      if (symbol) {
        let bySym = sellsByResolvedSymbol.get(symbol);
        if (!bySym) {
          bySym = [];
          sellsByResolvedSymbol.set(symbol, bySym);
        }
        bySym.push(t);
      }
    }
    const sortByExecutedAt = (a: ResolvedSellTrade, b: ResolvedSellTrade) =>
      a.executedAt.getTime() - b.executedAt.getTime();
    for (const arr of sellsByBaseId.values()) arr.sort(sortByExecutedAt);
    for (const arr of sellsByResolvedSymbol.values()) arr.sort(sortByExecutedAt);

    // ---- Aggregate signals ----
    const byTypeBuckets: Record<string, SignalOutcomeBucket> = {
      [SignalType.ENTRY]: emptyOutcome(),
      [SignalType.EXIT]: emptyOutcome(),
      [SignalType.ADJUSTMENT]: emptyOutcome(),
      [SignalType.RISK_CONTROL]: emptyOutcome()
    };
    const byDirectionBuckets: Record<string, SignalOutcomeBucket> = {
      [SignalDirection.LONG]: emptyOutcome(),
      [SignalDirection.SHORT]: emptyOutcome(),
      [SignalDirection.FLAT]: emptyOutcome()
    };
    const byConfidenceBuckets: ConfidenceBucketBreakdown[] = CONFIDENCE_BUCKETS.map((b) => ({
      bucket: b.label,
      signalCount: 0,
      wins: 0,
      losses: 0,
      returnSum: 0,
      returnCount: 0
    }));
    const byInstrumentMap = new Map<string, InstrumentSignalBreakdown>();

    let totalSignals = 0;
    let entryCount = 0;
    let exitCount = 0;
    let adjustmentCount = 0;
    let riskControlCount = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const s of signals) {
      totalSignals += 1;
      switch (s.signalType) {
        case SignalType.ENTRY:
          entryCount += 1;
          break;
        case SignalType.EXIT:
          exitCount += 1;
          break;
        case SignalType.ADJUSTMENT:
          adjustmentCount += 1;
          break;
        case SignalType.RISK_CONTROL:
          riskControlCount += 1;
          break;
      }

      if (typeof s.confidence === 'number' && Number.isFinite(s.confidence)) {
        confidenceSum += s.confidence;
        confidenceCount += 1;
      }

      // Resolve success by finding the next SELL trade on the same instrument after signal.timestamp.
      const signalInstrumentResolved = resolveSignalInstrument(s.instrument);
      const outcome = this.findNextSellOutcome(
        sellsByBaseId,
        sellsByResolvedSymbol,
        s.instrument,
        signalInstrumentResolved,
        s.timestamp
      );

      // byType
      const typeBucket = byTypeBuckets[s.signalType] ?? emptyOutcome();
      typeBucket.count += 1;
      if (outcome) {
        if (outcome.realizedPnL !== null) {
          if (outcome.realizedPnL > 0) typeBucket.wins += 1;
          else if (outcome.realizedPnL < 0) typeBucket.losses += 1;
        }
        if (outcome.realizedPnLPercent !== null) {
          typeBucket.returnSum += outcome.realizedPnLPercent;
          typeBucket.returnCount += 1;
        }
      }
      byTypeBuckets[s.signalType] = typeBucket;

      // byDirection
      const dirBucket = byDirectionBuckets[s.direction] ?? emptyOutcome();
      dirBucket.count += 1;
      if (outcome) {
        if (outcome.realizedPnL !== null) {
          if (outcome.realizedPnL > 0) dirBucket.wins += 1;
          else if (outcome.realizedPnL < 0) dirBucket.losses += 1;
        }
        if (outcome.realizedPnLPercent !== null) {
          dirBucket.returnSum += outcome.realizedPnLPercent;
          dirBucket.returnCount += 1;
        }
      }
      byDirectionBuckets[s.direction] = dirBucket;

      // byConfidenceBucket (only signals with confidence)
      if (typeof s.confidence === 'number' && Number.isFinite(s.confidence)) {
        for (let i = 0; i < CONFIDENCE_BUCKETS.length; i++) {
          const b = CONFIDENCE_BUCKETS[i];
          if (s.confidence >= b.lo && s.confidence < b.hi) {
            const bucket = byConfidenceBuckets[i];
            bucket.signalCount += 1;
            if (outcome) {
              if (outcome.realizedPnL !== null) {
                if (outcome.realizedPnL > 0) bucket.wins += 1;
                else if (outcome.realizedPnL < 0) bucket.losses += 1;
              }
              if (outcome.realizedPnLPercent !== null) {
                bucket.returnSum += outcome.realizedPnLPercent;
                bucket.returnCount += 1;
              }
            }
            break;
          }
        }
      }

      // byInstrument
      let ib = byInstrumentMap.get(signalInstrumentResolved);
      if (!ib) {
        ib = {
          instrument: signalInstrumentResolved,
          count: 0,
          wins: 0,
          losses: 0,
          returnSum: 0,
          returnCount: 0
        };
        byInstrumentMap.set(signalInstrumentResolved, ib);
      }
      ib.count += 1;
      if (outcome) {
        if (outcome.realizedPnL !== null) {
          if (outcome.realizedPnL > 0) ib.wins += 1;
          else if (outcome.realizedPnL < 0) ib.losses += 1;
        }
        if (outcome.realizedPnLPercent !== null) {
          ib.returnSum += outcome.realizedPnLPercent;
          ib.returnCount += 1;
        }
      }
    }

    // ---- Aggregate trades ----
    let totalTrades = 0;
    let buyCount = 0;
    let sellCountAll = 0;
    let totalVolume = 0;
    let totalFees = 0;
    let winCount = 0;
    let lossCount = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let largestWin: number | null = null;
    let largestLoss: number | null = null;
    let winAmountSum = 0;
    let lossAmountSum = 0;
    let totalRealizedPnLSum = 0;
    let totalRealizedPnLCount = 0;
    const holdTimeSamples: number[] = [];
    const tradeByInstrumentMap = new Map<string, InstrumentTradeBreakdown>();

    for (const t of trades) {
      totalTrades += 1;
      if (t.type === TradeType.BUY) buyCount += 1;
      else if (t.type === TradeType.SELL) sellCountAll += 1;

      totalVolume += Number(t.totalValue) || 0;
      totalFees += Number(t.fee) || 0;

      const baseSymbol = t.baseCoin?.symbol?.toUpperCase() ?? 'UNKNOWN';
      const quoteSymbol = t.quoteCoin?.symbol?.toUpperCase() ?? 'UNKNOWN';
      const instrument = `${baseSymbol}/${quoteSymbol}`;
      let tb = tradeByInstrumentMap.get(instrument);
      if (!tb) {
        tb = {
          instrument,
          tradeCount: 0,
          sellCount: 0,
          wins: 0,
          losses: 0,
          totalVolume: 0,
          totalPnL: 0,
          returnSum: 0,
          returnCount: 0
        };
        tradeByInstrumentMap.set(instrument, tb);
      }
      tb.tradeCount += 1;
      tb.totalVolume += Number(t.totalValue) || 0;

      if (t.type === TradeType.SELL) {
        tb.sellCount += 1;
        const pnl = t.realizedPnL;
        if (typeof pnl === 'number' && Number.isFinite(pnl)) {
          totalRealizedPnLSum += pnl;
          totalRealizedPnLCount += 1;
          tb.totalPnL += pnl;
          if (pnl > 0) {
            winCount += 1;
            grossProfit += pnl;
            winAmountSum += pnl;
            if (largestWin === null || pnl > largestWin) largestWin = pnl;
            tb.wins += 1;
          } else if (pnl < 0) {
            lossCount += 1;
            grossLoss += Math.abs(pnl);
            lossAmountSum += pnl;
            if (largestLoss === null || pnl < largestLoss) largestLoss = pnl;
            tb.losses += 1;
          }
        }
        const pnlPct = t.realizedPnLPercent;
        if (typeof pnlPct === 'number' && Number.isFinite(pnlPct)) {
          tb.returnSum += pnlPct;
          tb.returnCount += 1;
        }
        const holdRaw = t.metadata?.['holdTimeMs'];
        const holdTime = typeof holdRaw === 'number' ? holdRaw : Number(holdRaw);
        if (Number.isFinite(holdTime) && holdTime > 0) {
          holdTimeSamples.push(holdTime);
        }
      }
    }

    // ---- Aggregate fills (slippage) ----
    let slippageMin: number | null = null;
    let slippageMax: number | null = null;
    let slippageSum = 0;
    let slippageFillCount = 0;
    let slippageTotalImpact = 0;
    const slippageSamples: number[] = [];

    for (const f of fills) {
      if (typeof f.slippageBps !== 'number' || !Number.isFinite(f.slippageBps)) continue;
      slippageFillCount += 1;
      slippageSamples.push(f.slippageBps);
      slippageSum += f.slippageBps;
      if (slippageMin === null || f.slippageBps < slippageMin) slippageMin = f.slippageBps;
      if (slippageMax === null || f.slippageBps > slippageMax) slippageMax = f.slippageBps;
      const filled = Number(f.filledQuantity) || 0;
      const avgPx = Number(f.averagePrice) || 0;
      slippageTotalImpact += (f.slippageBps * filled * avgPx) / 10_000;
    }

    // Exact per-backtest median using in-memory sort (sells only).
    const holdTimeSorted = [...holdTimeSamples].sort((a, b) => a - b);
    const holdTimeMedian = this.medianFromSorted(holdTimeSorted);
    const holdTimeMinMs = holdTimeSorted.length > 0 ? holdTimeSorted[0] : null;
    const holdTimeMaxMs = holdTimeSorted.length > 0 ? holdTimeSorted[holdTimeSorted.length - 1] : null;
    const holdTimeAvgMs =
      holdTimeSorted.length > 0 ? holdTimeSorted.reduce((acc, v) => acc + v, 0) / holdTimeSorted.length : null;
    const holdTimeHistogram = buildHistogram(holdTimeSamples, HOLD_TIME_BUCKET_EDGES);

    // Exact per-backtest p95 for slippage via sorted samples.
    const slippageSorted = [...slippageSamples].sort((a, b) => a - b);
    const slippageP95 = this.percentileFromSorted(slippageSorted, 0.95);
    const slippageAvg = slippageFillCount > 0 ? slippageSum / slippageFillCount : null;
    const slippageHistogram = buildHistogram(slippageSamples, SLIPPAGE_BPS_BUCKET_EDGES);

    const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : null;

    const signalsByInstrumentArr = Array.from(byInstrumentMap.values()).sort((a, b) => b.count - a.count);
    const tradesByInstrumentArr = Array.from(tradeByInstrumentMap.values()).sort(
      (a, b) => b.totalVolume - a.totalVolume
    );

    const now = new Date();
    const summary: Partial<BacktestSummary> = {
      backtestId,
      totalSignals,
      entryCount,
      exitCount,
      adjustmentCount,
      riskControlCount,
      avgConfidence,
      confidenceSum,
      confidenceCount,
      totalTrades,
      buyCount,
      sellCount: sellCountAll,
      totalVolume,
      totalFees,
      winCount,
      lossCount,
      grossProfit,
      grossLoss,
      largestWin,
      largestLoss,
      avgWin: winCount > 0 ? winAmountSum / winCount : null,
      avgLoss: lossCount > 0 ? lossAmountSum / lossCount : null,
      totalRealizedPnL: totalRealizedPnLCount > 0 ? totalRealizedPnLSum : null,
      holdTimeMinMs: holdTimeMinMs !== null ? String(Math.round(holdTimeMinMs)) : null,
      holdTimeMaxMs: holdTimeMaxMs !== null ? String(Math.round(holdTimeMaxMs)) : null,
      holdTimeAvgMs: holdTimeAvgMs !== null ? String(Math.round(holdTimeAvgMs)) : null,
      holdTimeMedianMs: holdTimeMedian !== null ? String(Math.round(holdTimeMedian)) : null,
      holdTimeCount: holdTimeSamples.length,
      slippageAvgBps: slippageAvg,
      slippageMaxBps: slippageMax,
      slippageP95Bps: slippageP95,
      slippageTotalImpact,
      slippageFillCount,
      holdTimeHistogram,
      slippageHistogram,
      signalsByConfidenceBucket: byConfidenceBuckets,
      signalsByType: byTypeBuckets,
      signalsByDirection: byDirectionBuckets,
      signalsByInstrument: signalsByInstrumentArr,
      tradesByInstrument: tradesByInstrumentArr,
      computedAt: now
    };

    await this.summaryRepo.upsert(summary as QueryDeepPartialEntity<BacktestSummary>, {
      conflictPaths: ['backtestId'],
      skipUpdateIfNoValuesChanged: false
    });

    this.logger.debug(
      `Computed backtest summary for ${backtestId}: ${totalSignals} signals, ${totalTrades} trades, ${slippageFillCount} fills`
    );
  }

  private medianFromSorted(sorted: number[]): number | null {
    if (sorted.length === 0) return null;
    const mid = sorted.length / 2;
    if (sorted.length % 2 === 1) return sorted[Math.floor(mid)];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private percentileFromSorted(sorted: number[], p: number): number | null {
    if (sorted.length === 0) return null;
    if (sorted.length === 1) return sorted[0];
    const rank = p * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) return sorted[lo];
    const frac = rank - lo;
    return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
  }

  /**
   * For a given signal (instrument + timestamp), find the earliest SELL trade on the
   * same instrument executed at or after signal.timestamp. Returns null if none found.
   * Matches by direct id hit (UUID signal → trade baseCoinId) or by resolved symbol
   * (plain-symbol signal → trade baseCoinId's mapped symbol). Both candidate lists
   * are pre-sorted ascending, so we lower-bound binary-search into each and take the
   * earlier winner.
   */
  private findNextSellOutcome(
    sellsByBaseId: Map<string, ResolvedSellTrade[]>,
    sellsByResolvedSymbol: Map<string, ResolvedSellTrade[]>,
    signalInstrument: string | null | undefined,
    signalSymbol: string,
    signalTimestamp: Date
  ): ResolvedSellTrade | null {
    const signalKey = signalInstrument ? signalInstrument.toLowerCase() : null;
    const target = signalTimestamp.getTime();

    const byIdCandidate = signalKey ? this.lowerBoundByTimestamp(sellsByBaseId.get(signalKey), target) : null;
    const bySymbolCandidate = this.lowerBoundByTimestamp(sellsByResolvedSymbol.get(signalSymbol), target);

    if (!byIdCandidate) return bySymbolCandidate;
    if (!bySymbolCandidate) return byIdCandidate;
    return byIdCandidate.executedAt.getTime() <= bySymbolCandidate.executedAt.getTime()
      ? byIdCandidate
      : bySymbolCandidate;
  }

  private lowerBoundByTimestamp(sorted: ResolvedSellTrade[] | undefined, target: number): ResolvedSellTrade | null {
    if (!sorted || sorted.length === 0) return null;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid].executedAt.getTime() < target) lo = mid + 1;
      else hi = mid;
    }
    return lo < sorted.length ? sorted[lo] : null;
  }
}
