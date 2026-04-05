import { Test, TestingModule } from '@nestjs/testing';

import { OHLCController } from './ohlc.controller';
import { OHLCService, SyncStatus } from './ohlc.service';
import { ExchangeSymbolMapService } from './services/exchange-symbol-map.service';
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
  let symbolMapService: jest.Mocked<ExchangeSymbolMapService>;
  let backfillService: jest.Mocked<OHLCBackfillService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OHLCController],
      providers: [
        {
          provide: OHLCService,
          useValue: {
            getSyncStatus: jest.fn(),
            getGapSummary: jest.fn(),
            getCandlesByDateRange: jest.fn()
          }
        },
        {
          provide: ExchangeSymbolMapService,
          useValue: {
            getStaleCoins: jest.fn()
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
    symbolMapService = module.get(ExchangeSymbolMapService);
    backfillService = module.get(OHLCBackfillService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('getHealth', () => {
    it('returns healthy when sync is recent and no stale coins', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      ohlcService.getSyncStatus.mockResolvedValue(createSyncStatus({ lastSyncTime: new Date(now - 60 * 60 * 1000) }));
      symbolMapService.getStaleCoins.mockResolvedValue([] as any);

      const result = await controller.getHealth();

      expect(result.status).toBe('healthy');
      expect(result.coinsTracked).toBe(10);
      expect(result.totalCandles).toBe(100);
    });

    it('returns degraded when stale coin count exceeds 10', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      ohlcService.getSyncStatus.mockResolvedValue(
        createSyncStatus({ lastSyncTime: new Date(now - 60 * 60 * 1000), coinsWithData: 30 })
      );
      symbolMapService.getStaleCoins.mockResolvedValue(new Array(11).fill({}));

      const result = await controller.getHealth();

      expect(result.status).toBe('degraded');
      expect(result.staleCoins).toBe(11);
    });

    it('returns degraded when hoursSinceLastSync exceeds 2 but not 4', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      ohlcService.getSyncStatus.mockResolvedValue(
        createSyncStatus({ lastSyncTime: new Date(now - 3 * 60 * 60 * 1000) })
      );
      symbolMapService.getStaleCoins.mockResolvedValue([] as any);

      const result = await controller.getHealth();

      expect(result.status).toBe('degraded');
    });

    it('returns unhealthy when sync is older than 4 hours', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      ohlcService.getSyncStatus.mockResolvedValue(
        createSyncStatus({ lastSyncTime: new Date(now - 5 * 60 * 60 * 1000) })
      );
      symbolMapService.getStaleCoins.mockResolvedValue([] as any);

      const result = await controller.getHealth();

      expect(result.status).toBe('unhealthy');
    });

    it('returns unhealthy when stale coins exceed 50% of tracked coins', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      ohlcService.getSyncStatus.mockResolvedValue(
        createSyncStatus({ lastSyncTime: new Date(now - 60 * 60 * 1000), coinsWithData: 10 })
      );
      symbolMapService.getStaleCoins.mockResolvedValue(new Array(6).fill({}));

      const result = await controller.getHealth();

      expect(result.status).toBe('unhealthy');
    });

    it('returns unhealthy when lastSyncTime is null', async () => {
      ohlcService.getSyncStatus.mockResolvedValue(createSyncStatus({ lastSyncTime: undefined }));
      symbolMapService.getStaleCoins.mockResolvedValue([] as any);

      const result = await controller.getHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.lastSyncAt).toBeNull();
    });
  });

  describe('getSyncStatus', () => {
    it('returns mapped response with gap details truncated to 10', async () => {
      ohlcService.getSyncStatus.mockResolvedValue(createSyncStatus());
      symbolMapService.getStaleCoins.mockResolvedValue([
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
      expect(result.gaps.coinsWithGaps).toBe(12);
      expect(result.gaps.details).toHaveLength(10);
    });
  });

  describe('getBackfillProgress', () => {
    it('returns not_started when no progress exists', async () => {
      backfillService.getProgress.mockResolvedValue(null);

      const result = await controller.getBackfillProgress({
        coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
      });

      expect(result.status).toBe('not_started');
      expect(result.coinId).toBe('a3bb189e-8bf9-3888-9912-ace4e6543002');
    });

    it('returns progress directly when it exists', async () => {
      const progress = { coinId: 'btc', status: 'running', percent: 50 };
      backfillService.getProgress.mockResolvedValue(progress as any);

      const result = await controller.getBackfillProgress({
        coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
      });

      expect(result).toEqual(progress);
    });
  });

  describe('backfill actions', () => {
    it('startBackfill delegates to service and returns jobId', async () => {
      backfillService.startBackfill.mockResolvedValue('job-1');

      const result = await controller.startBackfill({
        coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
      });

      expect(backfillService.startBackfill).toHaveBeenCalledWith('a3bb189e-8bf9-3888-9912-ace4e6543002');
      expect(result).toEqual(expect.objectContaining({ success: true, jobId: 'job-1' }));
    });

    it('resumeBackfill delegates to service', async () => {
      backfillService.resumeBackfill.mockResolvedValue(undefined);

      const result = await controller.resumeBackfill({
        coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
      });

      expect(backfillService.resumeBackfill).toHaveBeenCalledWith('a3bb189e-8bf9-3888-9912-ace4e6543002');
      expect(result.success).toBe(true);
    });

    it('cancelBackfill delegates to service', async () => {
      backfillService.cancelBackfill.mockResolvedValue(undefined);

      const result = await controller.cancelBackfill({
        coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
      });

      expect(backfillService.cancelBackfill).toHaveBeenCalledWith('a3bb189e-8bf9-3888-9912-ace4e6543002');
      expect(result.success).toBe(true);
    });

    it('backfillHotCoins returns queued count in message', async () => {
      backfillService.backfillHotCoins.mockResolvedValue(25);

      const result = await controller.backfillHotCoins();

      expect(result.success).toBe(true);
      expect(result.message).toContain('25');
    });
  });

  describe('getCandles', () => {
    it('maps candle response with count', async () => {
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
        { start: '2024-01-01T00:00:00Z', end: '2024-01-01T01:00:00Z' }
      );

      expect(result.count).toBe(1);
      expect(result.candles[0]).toEqual({
        timestamp: '2024-01-01T00:00:00.000Z',
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10
      });
      expect(result.coinId).toBe('a3bb189e-8bf9-3888-9912-ace4e6543002');
    });

    it('returns empty candles array when no data exists', async () => {
      ohlcService.getCandlesByDateRange.mockResolvedValue([]);

      const result = await controller.getCandles(
        { coinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002' },
        { start: '2024-01-01T00:00:00Z', end: '2024-01-01T01:00:00Z' }
      );

      expect(result.count).toBe(0);
      expect(result.candles).toEqual([]);
    });
  });
});
