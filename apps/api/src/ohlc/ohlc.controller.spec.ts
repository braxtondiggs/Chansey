import { Test, TestingModule } from '@nestjs/testing';

import { OHLCController } from './ohlc.controller';
import { OHLCService, SyncStatus } from './ohlc.service';
import { OHLCBackfillService } from './services/ohlc-backfill.service';

const createSyncStatus = (overrides: Partial<SyncStatus> = {}): SyncStatus => ({
  totalCandles: 100,
  coinsWithData: 10,
  oldestCandle: new Date('2024-01-01T00:00:00Z'),
  newestCandle: new Date('2024-01-02T00:00:00Z'),
  lastSyncTime: new Date('2024-01-02T01:00:00Z'),
  ...overrides
});

describe('OHLCController', () => {
  let controller: OHLCController;
  let ohlcService: jest.Mocked<OHLCService>;
  let backfillService: jest.Mocked<OHLCBackfillService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OHLCController],
      providers: [
        {
          provide: OHLCService,
          useValue: {
            getSyncStatus: jest.fn(),
            getStaleCoins: jest.fn(),
            getGapSummary: jest.fn(),
            getCandlesByDateRange: jest.fn()
          }
        },
        {
          provide: OHLCBackfillService,
          useValue: {
            getProgress: jest.fn(),
            startBackfill: jest.fn(),
            resumeBackfill: jest.fn(),
            cancelBackfill: jest.fn(),
            backfillHotCoins: jest.fn(),
            getAllProgress: jest.fn()
          }
        }
      ]
    }).compile();

    controller = module.get(OHLCController);
    ohlcService = module.get(OHLCService);
    backfillService = module.get(OHLCBackfillService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('getHealth returns healthy when sync is recent', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    ohlcService.getSyncStatus.mockResolvedValue(createSyncStatus({ lastSyncTime: new Date(now - 60 * 60 * 1000) }));
    ohlcService.getStaleCoins.mockResolvedValue([] as any);

    const result = await controller.getHealth();

    expect(result.status).toBe('healthy');
    expect(result.coinsTracked).toBe(10);
  });

  it('getHealth returns degraded when stale threshold exceeded', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    ohlcService.getSyncStatus.mockResolvedValue(
      createSyncStatus({
        lastSyncTime: new Date(now - 3 * 60 * 60 * 1000),
        coinsWithData: 30
      })
    );
    ohlcService.getStaleCoins.mockResolvedValue(new Array(11).fill({}));

    const result = await controller.getHealth();

    expect(result.status).toBe('degraded');
  });

  it('getHealth returns unhealthy when sync is too old', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    ohlcService.getSyncStatus.mockResolvedValue(createSyncStatus({ lastSyncTime: new Date(now - 5 * 60 * 60 * 1000) }));
    ohlcService.getStaleCoins.mockResolvedValue(new Array(6).fill({}));

    const result = await controller.getHealth();

    expect(result.status).toBe('unhealthy');
  });

  it('getSyncStatus returns mapped response', async () => {
    ohlcService.getSyncStatus.mockResolvedValue(createSyncStatus());
    ohlcService.getStaleCoins.mockResolvedValue([
      { coinId: 'btc', symbol: 'BTC/USD', lastSyncAt: new Date('2024-01-02T00:00:00Z'), failureCount: 1 }
    ] as any);
    ohlcService.getGapSummary.mockResolvedValue(
      Array.from({ length: 12 }).map((_, i) => ({
        coinId: `coin-${i}`,
        gapCount: 1,
        oldestGap: new Date('2024-01-01T00:00:00Z')
      }))
    );

    const result = await controller.getSyncStatus();

    expect(result.sync.totalCandles).toBe(100);
    expect(result.staleCoins[0].coinId).toBe('btc');
    expect(result.gaps.details).toHaveLength(10);
  });

  it('getBackfillProgress returns not_started when missing', async () => {
    backfillService.getProgress.mockResolvedValue(null);

    const result = await controller.getBackfillProgress({
      coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
    });

    expect(result.status).toBe('not_started');
  });

  it('startBackfill returns job payload', async () => {
    backfillService.startBackfill.mockResolvedValue('job-1');

    const result = await controller.startBackfill({
      coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
    });

    expect(result.jobId).toBe('job-1');
    expect(result.success).toBe(true);
  });

  it('resumeBackfill invokes service', async () => {
    backfillService.resumeBackfill.mockResolvedValue(undefined);

    const result = await controller.resumeBackfill({
      coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
    });

    expect(backfillService.resumeBackfill).toHaveBeenCalledWith('a3bb189e-8bf9-3888-9912-ace4e6543002');
    expect(result.success).toBe(true);
  });

  it('cancelBackfill invokes service', async () => {
    backfillService.cancelBackfill.mockResolvedValue(undefined);

    const result = await controller.cancelBackfill({
      coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
    });

    expect(backfillService.cancelBackfill).toHaveBeenCalledWith('a3bb189e-8bf9-3888-9912-ace4e6543002');
    expect(result.success).toBe(true);
  });

  it('backfillHotCoins starts backfill', async () => {
    backfillService.backfillHotCoins.mockResolvedValue(25);

    const result = await controller.backfillHotCoins();

    expect(backfillService.backfillHotCoins).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.message).toContain('25');
  });

  it('getAllBackfillProgress returns active jobs count', async () => {
    backfillService.getAllProgress.mockResolvedValue([{ coinId: 'btc' }] as any);

    const result = await controller.getAllBackfillProgress();

    expect(result.activeJobs).toBe(1);
  });

  it('getCandles maps candle response', async () => {
    ohlcService.getCandlesByDateRange.mockResolvedValue([
      {
        timestamp: new Date('2024-01-01T00:00:00Z'),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10
      }
    ] as any);

    const result = await controller.getCandles(
      { coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002' },
      {
        start: '2024-01-01T00:00:00Z',
        end: '2024-01-01T01:00:00Z'
      }
    );

    expect(result.count).toBe(1);
    expect(result.candles[0].open).toBe(1);
  });
});
