import { type Job } from 'bullmq';

import { OHLCGapDetectionTask } from './ohlc-gap-detection.task';

import { type DistributedLockService } from '../../shared/distributed-lock.service';
import { type ExchangeSymbolMap } from '../exchange-symbol-map.entity';
import { type OHLCService } from '../ohlc.service';
import { type ExchangeSymbolMapService } from '../services/exchange-symbol-map.service';
import { type BackfillProgress, type OHLCBackfillService } from '../services/ohlc-backfill.service';

describe('OHLCGapDetectionTask', () => {
  let task: OHLCGapDetectionTask;
  let queue: { getRepeatableJobs: jest.Mock; add: jest.Mock };
  let backfillQueue: { add: jest.Mock };
  let ohlcService: jest.Mocked<Pick<OHLCService, 'getCandleCountsByCoinInRange'>>;
  let symbolMapService: jest.Mocked<Pick<ExchangeSymbolMapService, 'getActiveSymbolMaps'>>;
  let backfillService: jest.Mocked<Pick<OHLCBackfillService, 'getProgress'>>;
  let configService: { get: jest.Mock };
  let lockService: jest.Mocked<Pick<DistributedLockService, 'acquire' | 'release'>>;

  const ACQUIRED_LOCK = { acquired: true, lockId: 'lock-1', token: 'token-1' };
  const FAILED_LOCK = { acquired: false, lockId: null, token: null };

  const buildMapping = (coinId: string, lastSyncAt: Date | null = null): ExchangeSymbolMap =>
    ({
      id: `mapping-${coinId}`,
      coinId,
      exchangeId: 'exchange-1',
      symbol: `${coinId.toUpperCase()}/USD`,
      isActive: true,
      priority: 0,
      failureCount: 0,
      lastSyncAt,
      createdAt: new Date(),
      updatedAt: new Date()
    }) as unknown as ExchangeSymbolMap;

  const buildJob = (): Job =>
    ({
      id: 'job-1',
      name: 'ohlc-gap-detection',
      updateProgress: jest.fn().mockResolvedValue(undefined)
    }) as unknown as Job;

  const buildProgress = (overrides: Partial<BackfillProgress>): BackfillProgress => ({
    coinId: 'c1',
    coinSymbol: 'C1/USD',
    startDate: new Date(),
    endDate: new Date(),
    currentDate: new Date(),
    candlesBackfilled: 0,
    percentComplete: 0,
    status: 'pending',
    startedAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });

  beforeEach(() => {
    queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue(undefined)
    };

    backfillQueue = {
      add: jest.fn().mockResolvedValue(undefined)
    };

    ohlcService = {
      getCandleCountsByCoinInRange: jest.fn()
    } as unknown as jest.Mocked<Pick<OHLCService, 'getCandleCountsByCoinInRange'>>;

    symbolMapService = {
      getActiveSymbolMaps: jest.fn()
    } as unknown as jest.Mocked<Pick<ExchangeSymbolMapService, 'getActiveSymbolMaps'>>;

    backfillService = {
      getProgress: jest.fn()
    } as unknown as jest.Mocked<Pick<OHLCBackfillService, 'getProgress'>>;

    configService = { get: jest.fn() };

    lockService = {
      acquire: jest.fn().mockResolvedValue(ACQUIRED_LOCK),
      release: jest.fn().mockResolvedValue(true)
    } as unknown as jest.Mocked<Pick<DistributedLockService, 'acquire' | 'release'>>;

    task = new OHLCGapDetectionTask(
      queue as any,
      backfillQueue as any,
      ohlcService as any,
      symbolMapService as any,
      backfillService as any,
      configService as any,
      lockService as any,
      { recordFailure: jest.fn() } as any
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('queues backfill for coins below the 95% threshold', async () => {
    const mappings = [buildMapping('c1'), buildMapping('c2')];
    symbolMapService.getActiveSymbolMaps.mockResolvedValue(mappings);
    // c1 deficient (5000 < 8322), c2 healthy (9000)
    ohlcService.getCandleCountsByCoinInRange.mockResolvedValue(
      new Map([
        ['c1', 5000],
        ['c2', 9000]
      ])
    );
    backfillService.getProgress.mockResolvedValue(null);

    const result = await task.handleGapDetection(buildJob());

    expect(result.deficient).toBe(1);
    expect(result.queued).toBe(1);
    expect(backfillQueue.add).toHaveBeenCalledWith('backfill', { coinId: 'c1' }, expect.any(Object));
    expect(backfillQueue.add).not.toHaveBeenCalledWith('backfill', { coinId: 'c2' }, expect.any(Object));
  });

  it('treats coins absent from the count map as deficient (zero candles)', async () => {
    const mappings = [buildMapping('c1'), buildMapping('c2')];
    symbolMapService.getActiveSymbolMaps.mockResolvedValue(mappings);
    // c1 healthy, c2 absent → zero candles
    ohlcService.getCandleCountsByCoinInRange.mockResolvedValue(new Map([['c1', 9000]]));
    backfillService.getProgress.mockResolvedValue(null);

    const result = await task.handleGapDetection(buildJob());

    expect(result.deficient).toBe(1);
    expect(result.queued).toBe(1);
    expect(backfillQueue.add).toHaveBeenCalledWith('backfill', { coinId: 'c2' }, expect.any(Object));
  });

  it('skips coins with pending or in_progress backfill', async () => {
    const mappings = [buildMapping('c1'), buildMapping('c2')];
    symbolMapService.getActiveSymbolMaps.mockResolvedValue(mappings);
    ohlcService.getCandleCountsByCoinInRange.mockResolvedValue(new Map());
    backfillService.getProgress.mockImplementation(async (coinId: string) =>
      coinId === 'c1'
        ? buildProgress({ coinId: 'c1', status: 'pending' })
        : buildProgress({ coinId: 'c2', status: 'in_progress' })
    );

    const result = await task.handleGapDetection(buildJob());

    expect(result.skippedInFlight).toBe(2);
    expect(result.queued).toBe(0);
    expect(backfillQueue.add).not.toHaveBeenCalled();
  });

  it('skips coins with failed backfill within the last 24h', async () => {
    const mappings = [buildMapping('c1')];
    symbolMapService.getActiveSymbolMaps.mockResolvedValue(mappings);
    ohlcService.getCandleCountsByCoinInRange.mockResolvedValue(new Map());
    backfillService.getProgress.mockResolvedValue(
      buildProgress({ coinId: 'c1', status: 'failed', updatedAt: new Date(Date.now() - 60 * 60 * 1000) })
    );

    const result = await task.handleGapDetection(buildJob());

    expect(result.recentFailures).toBe(1);
    expect(result.queued).toBe(0);
    expect(backfillQueue.add).not.toHaveBeenCalled();
  });

  it('re-triggers failed backfills older than 24h', async () => {
    const mappings = [buildMapping('c1')];
    symbolMapService.getActiveSymbolMaps.mockResolvedValue(mappings);
    ohlcService.getCandleCountsByCoinInRange.mockResolvedValue(new Map());
    backfillService.getProgress.mockResolvedValue(
      buildProgress({
        coinId: 'c1',
        status: 'failed',
        updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000)
      })
    );

    const result = await task.handleGapDetection(buildJob());

    expect(result.recentFailures).toBe(0);
    expect(result.queued).toBe(1);
    expect(backfillQueue.add).toHaveBeenCalledWith('backfill', { coinId: 'c1' }, expect.any(Object));
  });

  it('caps queued backfills at 30 even when more coins are deficient', async () => {
    const mappings = Array.from({ length: 50 }, (_, i) => buildMapping(`c${i}`));
    symbolMapService.getActiveSymbolMaps.mockResolvedValue(mappings);
    ohlcService.getCandleCountsByCoinInRange.mockResolvedValue(new Map());
    backfillService.getProgress.mockResolvedValue(null);

    const result = await task.handleGapDetection(buildJob());

    expect(result.deficient).toBe(50);
    expect(result.queued).toBe(30);
    expect(backfillQueue.add).toHaveBeenCalledTimes(30);
  });

  it('skips work when distributed lock cannot be acquired', async () => {
    lockService.acquire.mockResolvedValue(FAILED_LOCK);

    const result = await task.handleGapDetection(buildJob());

    expect(result).toMatchObject({ skipped: true, reason: 'lock_not_acquired' });
    expect(symbolMapService.getActiveSymbolMaps).not.toHaveBeenCalled();
    expect(backfillQueue.add).not.toHaveBeenCalled();
    expect(lockService.release).not.toHaveBeenCalled();
  });

  it('processes deficient coins oldest-lastSyncAt-first', async () => {
    const old = new Date('2024-01-01T00:00:00Z');
    const recent = new Date('2025-01-01T00:00:00Z');
    const mappings = [buildMapping('recent', recent), buildMapping('never', null), buildMapping('old', old)];
    symbolMapService.getActiveSymbolMaps.mockResolvedValue(mappings);
    ohlcService.getCandleCountsByCoinInRange.mockResolvedValue(new Map());
    backfillService.getProgress.mockResolvedValue(null);

    await task.handleGapDetection(buildJob());

    const callOrder = backfillQueue.add.mock.calls.map((c) => (c[1] as { coinId: string }).coinId);
    // Never (treated as 0) and old (2024) before recent (2025)
    expect(callOrder.indexOf('recent')).toBe(2);
  });
});
