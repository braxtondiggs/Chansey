import { Test, type TestingModule } from '@nestjs/testing';

import { CoinDiversityService } from './coin-diversity.service';
import { type Coin } from './coin.entity';

import { CorrelationCalculator } from '../common/metrics/correlation.calculator';
import { MetricsService } from '../metrics/metrics.service';
import { type OHLCSummary } from '../ohlc/ohlc-candle.entity';
import { OHLCService } from '../ohlc/ohlc.service';

const makeCoin = (id: string, overrides: Partial<Coin> = {}): Coin =>
  ({
    id,
    slug: id,
    name: id,
    symbol: id.toUpperCase(),
    ...overrides
  }) as Coin;

/**
 * Build a sequence of hourly OHLC summaries whose close prices are driven by
 * a deterministic generator — lets the test choose whether two coins "move
 * together" (same or similar series) or not.
 */
const makeCandles = (coinId: string, closes: number[], startMs = Date.UTC(2024, 0, 1)): OHLCSummary[] =>
  closes.map(
    (close, i) =>
      ({
        coinId,
        timestamp: new Date(startMs + i * 3600_000),
        open: close,
        high: close,
        low: close,
        close,
        volume: 0
      }) as OHLCSummary
  );

describe('CoinDiversityService', () => {
  let service: CoinDiversityService;
  let ohlc: { getCandlesByDateRangeGrouped: jest.Mock };
  let correlation: { calculatePearsonCorrelation: jest.Mock };
  let metrics: { recordDiversityPruningFallback: jest.Mock };

  beforeEach(async () => {
    ohlc = { getCandlesByDateRangeGrouped: jest.fn().mockResolvedValue({}) };
    correlation = { calculatePearsonCorrelation: jest.fn().mockReturnValue(0) };
    metrics = { recordDiversityPruningFallback: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoinDiversityService,
        { provide: OHLCService, useValue: ohlc },
        { provide: CorrelationCalculator, useValue: correlation },
        { provide: MetricsService, useValue: metrics }
      ]
    }).compile();

    service = module.get(CoinDiversityService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns empty array unchanged', async () => {
    expect(await service.pruneByDiversity([], 10)).toEqual([]);
    expect(ohlc.getCandlesByDateRangeGrouped).not.toHaveBeenCalled();
  });

  it('returns the shortlist unchanged when it is not longer than take', async () => {
    const shortlist = [makeCoin('a'), makeCoin('b'), makeCoin('c')];
    const result = await service.pruneByDiversity(shortlist, 3);
    expect(result).toEqual(shortlist);
    expect(ohlc.getCandlesByDateRangeGrouped).not.toHaveBeenCalled();
  });

  it('falls back to rank order and logs when no OHLC data exists for any coin', async () => {
    const shortlist = Array.from({ length: 6 }, (_, i) => makeCoin(`c${i}`));
    ohlc.getCandlesByDateRangeGrouped.mockResolvedValue({});
    const warnSpy = jest.spyOn(service['logger'], 'warn');

    const result = await service.pruneByDiversity(shortlist, 3);

    expect(result.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('diversity_fallback_no_ohlc'));
    expect(metrics.recordDiversityPruningFallback).toHaveBeenCalledWith('no_ohlc');
  });

  it('preserves top-N by rank when every correlation is below threshold', async () => {
    const shortlist = Array.from({ length: 5 }, (_, i) => makeCoin(`c${i}`));
    ohlc.getCandlesByDateRangeGrouped.mockResolvedValue(
      Object.fromEntries(
        shortlist.map((c) => [
          c.id,
          makeCandles(
            c.id,
            Array.from({ length: 50 }, (_, i) => 100 + i)
          )
        ])
      )
    );
    correlation.calculatePearsonCorrelation.mockReturnValue(0.1);

    const result = await service.pruneByDiversity(shortlist, 3);
    expect(result.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
  });

  it('locks rank #1 unconditionally, skips rank #2 when correlated, then backfills', async () => {
    const shortlist = Array.from({ length: 6 }, (_, i) => makeCoin(`c${i}`));
    ohlc.getCandlesByDateRangeGrouped.mockResolvedValue(
      Object.fromEntries(
        shortlist.map((c) => [
          c.id,
          makeCandles(
            c.id,
            Array.from({ length: 50 }, (_, i) => 100 + i)
          )
        ])
      )
    );
    // Every pair correlates above threshold → #2 skipped, rank 3+ vetoed, backfill kicks in.
    correlation.calculatePearsonCorrelation.mockReturnValue(0.99);
    const warnSpy = jest.spyOn(service['logger'], 'warn');

    const result = await service.pruneByDiversity(shortlist, 3);

    expect(result.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('diversity_backfilled'));
    expect(metrics.recordDiversityPruningFallback).toHaveBeenCalledWith('backfill_after_veto');
  });

  it('vetoes a highly correlated mid-rank candidate and picks the next uncorrelated one', async () => {
    const shortlist = Array.from({ length: 5 }, (_, i) => makeCoin(`c${i}`));
    ohlc.getCandlesByDateRangeGrouped.mockResolvedValue(
      Object.fromEntries(
        shortlist.map((c) => [
          c.id,
          makeCandles(
            c.id,
            Array.from({ length: 50 }, (_, i) => 100 + i)
          )
        ])
      )
    );

    // c2 correlates 0.99 with c0 (veto); everything else is 0.1.
    correlation.calculatePearsonCorrelation.mockImplementation((_returnsA: number[], _returnsB: number[]) => {
      const invocation = correlation.calculatePearsonCorrelation.mock.calls.length;
      // Calls (in order) during scan:
      //   1: #1 vs #0 (candidate c1 vs picked c0)                 — low
      //   2: #2 vs #0 (candidate c2 vs picked c0)                 — HIGH → c2 vetoed
      //   3: #3 vs #0 (candidate c3 vs picked c0)                 — low
      //   4: #3 vs #1 (candidate c3 vs picked c1)                 — low
      return invocation === 2 ? 0.99 : 0.1;
    });

    const result = await service.pruneByDiversity(shortlist, 3);
    expect(result.map((c) => c.id)).toEqual(['c0', 'c1', 'c3']);
  });

  it('passes through a candidate with no OHLC data without evaluating correlation', async () => {
    const shortlist = [makeCoin('c0'), makeCoin('c1'), makeCoin('missing'), makeCoin('c3')];
    const candles = Array.from({ length: 50 }, (_, i) => 100 + i);
    ohlc.getCandlesByDateRangeGrouped.mockResolvedValue({
      c0: makeCandles('c0', candles),
      c1: makeCandles('c1', candles),
      c3: makeCandles('c3', candles)
    });
    correlation.calculatePearsonCorrelation.mockReturnValue(0.1);

    const result = await service.pruneByDiversity(shortlist, 3);
    expect(result.map((c) => c.id)).toEqual(['c0', 'c1', 'missing']);
  });

  it('treats an aligned history shorter than MIN_ALIGNED_RETURNS+1 as null (no veto)', async () => {
    const shortlist = [makeCoin('c0'), makeCoin('c1'), makeCoin('c2')];
    // Only 20 candles each — intersection < 31, so correlation returns null and no veto.
    const shortSeries = Array.from({ length: 20 }, (_, i) => 100 + i);
    ohlc.getCandlesByDateRangeGrouped.mockResolvedValue({
      c0: makeCandles('c0', shortSeries),
      c1: makeCandles('c1', shortSeries),
      c2: makeCandles('c2', shortSeries)
    });

    const result = await service.pruneByDiversity(shortlist, 2);

    expect(result.map((c) => c.id)).toEqual(['c0', 'c1']);
    expect(correlation.calculatePearsonCorrelation).not.toHaveBeenCalled();
  });

  it('uses the pairwise timestamp intersection (no throw on misalignment)', async () => {
    // Shortlist (4) > take (3) so the correlation path actually runs; c3 is a buffer so
    // rank-3+ scan executes for c2 before picked fills.
    const shortlist = [makeCoin('c0'), makeCoin('c1'), makeCoin('c2'), makeCoin('c3')];
    // c0, c2, c3 aligned to hours 0-49; c1 offset +10h (hours 10-59) so c1 pairs share 40 ts.
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    ohlc.getCandlesByDateRangeGrouped.mockResolvedValue({
      c0: makeCandles('c0', closes, Date.UTC(2024, 0, 1)),
      c1: makeCandles('c1', closes, Date.UTC(2024, 0, 1) + 10 * 3600_000),
      c2: makeCandles('c2', closes, Date.UTC(2024, 0, 1)),
      c3: makeCandles('c3', closes, Date.UTC(2024, 0, 1))
    });
    correlation.calculatePearsonCorrelation.mockReturnValue(0.1);

    const result = await service.pruneByDiversity(shortlist, 3);

    expect(result.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
    // 3 calls: (c1 vs c0) rank-#2 lock, (c2 vs c0) + (c2 vs c1) rank-3+ scan. c3 unreached.
    expect(correlation.calculatePearsonCorrelation).toHaveBeenCalledTimes(3);
    // c0-c1 intersection 40 ts → 39 returns; c0-c2 full 50 → 49; c1-c2 intersection 40 → 39.
    const lengths = correlation.calculatePearsonCorrelation.mock.calls.map(([a]: number[][]) => a.length);
    expect(lengths).toEqual([39, 49, 39]);
  });

  it('converts aligned closes to simple returns before delegating to the calculator', async () => {
    // Shortlist (3) > take (2) with take > 1 is the minimal shape that triggers the rank-#2
    // lock path (picked.length < take). c2 is a buffer — never evaluated because picked fills.
    const shortlist = [makeCoin('c0'), makeCoin('c1'), makeCoin('c2')];
    // 31 closes → 30 aligned returns — exactly at the MIN_ALIGNED_RETURNS boundary.
    const closesA = Array.from({ length: 31 }, (_, i) => 100 + i);
    const closesB = Array.from({ length: 31 }, (_, i) => 200 + i * 2);
    const closesC = Array.from({ length: 31 }, (_, i) => 300 + i);
    ohlc.getCandlesByDateRangeGrouped.mockResolvedValue({
      c0: makeCandles('c0', closesA),
      c1: makeCandles('c1', closesB),
      c2: makeCandles('c2', closesC)
    });
    correlation.calculatePearsonCorrelation.mockReturnValue(0.5);

    await service.pruneByDiversity(shortlist, 2);

    // Rank-#2 lock path runs once against #1; picked fills at 2 so c2 never evaluated.
    expect(correlation.calculatePearsonCorrelation).toHaveBeenCalledTimes(1);
    const [returnsA, returnsB] = correlation.calculatePearsonCorrelation.mock.calls[0];
    expect(returnsA).toHaveLength(30);
    expect(returnsB).toHaveLength(30);
    // Spot-check simple-return formula r[i] = close[i]/close[i-1] - 1
    expect(returnsA[0]).toBeCloseTo(101 / 100 - 1, 10);
    expect(returnsA[29]).toBeCloseTo(130 / 129 - 1, 10);
    expect(returnsB[0]).toBeCloseTo(202 / 200 - 1, 10);
  });

  it('backfills in rank order when pruning picks fewer than take', async () => {
    const shortlist = Array.from({ length: 10 }, (_, i) => makeCoin(`c${i}`));
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    ohlc.getCandlesByDateRangeGrouped.mockResolvedValue(
      Object.fromEntries(shortlist.map((c) => [c.id, makeCandles(c.id, closes)]))
    );
    // Every call returns 0.99 → every candidate after the unconditional #1 is vetoed → backfill
    correlation.calculatePearsonCorrelation.mockReturnValue(0.99);

    const result = await service.pruneByDiversity(shortlist, 4);
    // #1 locked, #2 skipped, #3-9 vetoed; backfill picks c1, c2, c3 in rank order.
    expect(result.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3']);
  });
});
