import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import { AuditEventType, CompositeRegimeType, MarketRegimeType } from '@chansey/api-interfaces';

import { CompositeRegimeService } from './composite-regime.service';
import { MarketRegimeService } from './market-regime.service';

import { AuditService } from '../audit/audit.service';
import { CoinService } from '../coin/coin.service';
import { NOTIFICATION_EVENTS } from '../notification/interfaces/notification-events.interface';
import { OHLCService } from '../ohlc/ohlc.service';

describe('CompositeRegimeService', () => {
  let service: CompositeRegimeService;
  let mockMarketRegimeService: jest.Mocked<Pick<MarketRegimeService, 'getCurrentRegime'>>;
  let mockOhlcService: jest.Mocked<Pick<OHLCService, 'findAllByDay'>>;
  let mockCoinService: jest.Mocked<Pick<CoinService, 'getCoinBySlug'>>;
  let mockAuditService: jest.Mocked<Pick<AuditService, 'createAuditLog'>>;
  let mockCacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let mockEventEmitter: { emit: jest.Mock };

  const BTC_COIN_ID = 'btc-uuid';

  beforeEach(async () => {
    mockMarketRegimeService = {
      getCurrentRegime: jest.fn()
    };

    mockOhlcService = {
      findAllByDay: jest.fn()
    };

    mockCoinService = {
      getCoinBySlug: jest.fn().mockResolvedValue({ id: BTC_COIN_ID, slug: 'bitcoin' })
    };

    mockAuditService = {
      createAuditLog: jest.fn().mockResolvedValue(undefined)
    };

    mockCacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined)
    };

    mockEventEmitter = {
      emit: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompositeRegimeService,
        { provide: MarketRegimeService, useValue: mockMarketRegimeService },
        { provide: OHLCService, useValue: mockOhlcService },
        { provide: CoinService, useValue: mockCoinService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: EventEmitter2, useValue: mockEventEmitter }
      ]
    }).compile();

    service = module.get<CompositeRegimeService>(CompositeRegimeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // classify() — pure function, covers all 4 branches
  // ---------------------------------------------------------------------------
  describe('classify', () => {
    it('should delegate to classifyCompositeRegime', () => {
      // Spot-check one case to verify delegation — exhaustive classify coverage belongs in api-interfaces
      expect(service.classify(MarketRegimeType.EXTREME, false)).toBe(CompositeRegimeType.EXTREME);
      expect(service.classify(MarketRegimeType.LOW_VOLATILITY, true)).toBe(CompositeRegimeType.BULL);
    });
  });

  // ---------------------------------------------------------------------------
  // Synchronous getters — fallback defaults
  // ---------------------------------------------------------------------------
  describe('synchronous getters', () => {
    it('should return fallback defaults before any refresh', () => {
      const freshService = new CompositeRegimeService(
        mockMarketRegimeService as any,
        mockOhlcService as any,
        mockCoinService as any,
        mockAuditService as any,
        mockCacheManager as any,
        mockEventEmitter as any
      );
      expect(freshService.getCompositeRegime()).toBe(CompositeRegimeType.NEUTRAL);
      expect(freshService.getVolatilityRegime()).toBe(MarketRegimeType.NORMAL);
      expect(freshService.getTrendAboveSma()).toBe(true);
    });

    it('should return cached values after a successful refresh', async () => {
      const summaries = generatePriceSummaries(250, 50000, 0.001);
      // Set the first element (newest in descending order) to a high price
      summaries[0].close = 70000;

      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.LOW_VOLATILITY
      } as any);

      await service.refresh();

      expect(service.getCompositeRegime()).toBe(CompositeRegimeType.BULL);
      expect(service.getVolatilityRegime()).toBe(MarketRegimeType.LOW_VOLATILITY);
      expect(service.getTrendAboveSma()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // refresh()
  // ---------------------------------------------------------------------------
  describe('refresh', () => {
    it('should keep previous regime when fewer than 200 data points', async () => {
      const summaries = generatePriceSummaries(100, 50000, 0.001);
      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });

      const result = await service.refresh();

      expect(result).toBe(CompositeRegimeType.NEUTRAL);
      expect(mockMarketRegimeService.getCurrentRegime).not.toHaveBeenCalled();
    });

    it('should default to NORMAL volatility when getCurrentRegime returns null', async () => {
      const summaries = generatePriceSummaries(250, 40000, 0.0005);
      // Set the first element (newest in descending order) to a high price
      summaries[0].close = 60000;

      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue(null);

      const result = await service.refresh();

      // NORMAL + above SMA = BULL
      expect(result).toBe(CompositeRegimeType.BULL);
    });

    it('should filter out NaN closes and still compute when enough valid points remain', async () => {
      const summaries = generatePriceSummaries(250, 50000, 0.001);
      // Inject NaN values at the beginning (newest in descending order)
      for (let i = 0; i < 10; i++) {
        summaries[i].close = NaN;
      }

      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.NORMAL
      } as any);

      const result = await service.refresh();

      // 240 valid points (250 - 10 NaN) → proceeds normally
      expect(result).not.toBe(CompositeRegimeType.NEUTRAL);
      expect(service.getVolatilityRegime()).toBe(MarketRegimeType.NORMAL);
    });

    it('should keep previous regime when too many NaN closes drop below SMA_PERIOD', async () => {
      const summaries = generatePriceSummaries(210, 50000, 0.001);
      // Remove enough valid points to drop below 200
      for (let i = 0; i < 15; i++) {
        summaries[i].close = NaN;
      }

      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });

      const result = await service.refresh();

      expect(result).toBe(CompositeRegimeType.NEUTRAL);
      expect(mockMarketRegimeService.getCurrentRegime).not.toHaveBeenCalled();
    });

    it('should keep previous regime when OHLC map has no data for BTC coin', async () => {
      mockOhlcService.findAllByDay.mockResolvedValue({});

      const result = await service.refresh();

      expect(result).toBe(CompositeRegimeType.NEUTRAL);
      expect(mockMarketRegimeService.getCurrentRegime).not.toHaveBeenCalled();
    });

    it('should keep previous regime when BTC coin not found', async () => {
      mockCoinService.getCoinBySlug.mockResolvedValue(null);

      const result = await service.refresh();

      expect(result).toBe(CompositeRegimeType.NEUTRAL);
    });

    it('should propagate errors from dependencies', async () => {
      mockOhlcService.findAllByDay.mockRejectedValue(new Error('Database unavailable'));

      await expect(service.refresh()).rejects.toThrow('Database unavailable');
    });

    it('should increment failure counter when refresh throws', async () => {
      mockOhlcService.findAllByDay.mockRejectedValue(new Error('DB timeout'));

      for (let i = 0; i < 3; i++) {
        await service.refresh().catch(() => {
          // Intentionally suppressing error for test
        });
      }

      expect((service as any).consecutiveFailures).toBe(3);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.REGIME_STALE,
        expect.objectContaining({ consecutiveFailures: 3 })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // onModuleInit()
  // ---------------------------------------------------------------------------
  describe('onModuleInit', () => {
    it('should not throw when refresh fails during init', async () => {
      const freshService = new CompositeRegimeService(
        mockMarketRegimeService as any,
        mockOhlcService as any,
        mockCoinService as any,
        mockAuditService as any,
        mockCacheManager as any,
        mockEventEmitter as any
      );

      mockOhlcService.findAllByDay.mockRejectedValue(new Error('Startup failure'));

      await expect(freshService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should not throw when Redis override restore fails', async () => {
      const freshService = new CompositeRegimeService(
        mockMarketRegimeService as any,
        mockOhlcService as any,
        mockCoinService as any,
        mockAuditService as any,
        mockCacheManager as any,
        mockEventEmitter as any
      );

      mockCacheManager.get.mockRejectedValue(new Error('Redis unavailable'));
      mockOhlcService.findAllByDay.mockRejectedValue(new Error('Also fails'));

      await expect(freshService.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // enableOverride() / disableOverride()
  // ---------------------------------------------------------------------------
  describe('enableOverride', () => {
    it('should set override state, persist to Redis, and audit log', async () => {
      await service.enableOverride('user-123', true, 'Emergency override');

      expect(service.isOverrideActive()).toBe(true);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'regime:override',
        expect.objectContaining({ active: true, forceAllow: true, userId: 'user-123' }),
        86_400_000
      );
      expect(mockAuditService.createAuditLog).toHaveBeenCalledWith({
        eventType: AuditEventType.MANUAL_INTERVENTION,
        entityType: 'CompositeRegime',
        entityId: 'override',
        userId: 'user-123',
        afterState: { forceAllow: true, reason: 'Emergency override' },
        metadata: { action: 'enable_regime_override' }
      });
    });

    it('should store forceAllow=false correctly', async () => {
      await service.enableOverride('user-789', false, 'Test');

      const status = service.getStatus();
      expect(status.override.active).toBe(true);
      expect(status.override.forceAllow).toBe(false);
    });
  });

  describe('disableOverride', () => {
    it('should clear override state and delete from Redis', async () => {
      await service.enableOverride('user-123', true, 'Enable');
      expect(service.isOverrideActive()).toBe(true);

      await service.disableOverride('user-123', 'Disable');

      expect(service.isOverrideActive()).toBe(false);
      expect(mockCacheManager.del).toHaveBeenCalledWith('regime:override');
    });

    it('should audit log with previous state captured', async () => {
      await service.enableOverride('user-123', true, 'Orig reason');
      jest.clearAllMocks();

      await service.disableOverride('user-123', 'Crisis passed');

      expect(mockAuditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.MANUAL_INTERVENTION,
          beforeState: { forceAllow: true, reason: 'Orig reason' },
          afterState: { active: false, reason: 'Crisis passed' },
          metadata: { action: 'disable_regime_override' }
        })
      );
    });

    it('should handle disable when no override was active', async () => {
      await service.disableOverride('user-123', 'No-op disable');

      expect(mockAuditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          beforeState: undefined,
          afterState: { active: false, reason: 'No-op disable' }
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Redis override persistence — restore on init
  // ---------------------------------------------------------------------------
  describe('Redis override restore on init', () => {
    it('should restore override from Redis on init', async () => {
      const saved = {
        active: true,
        forceAllow: true,
        userId: 'admin-1',
        reason: 'Persisted',
        enabledAt: new Date()
      };
      mockCacheManager.get.mockResolvedValue(saved);

      const summaries = generatePriceSummaries(250, 50000, 0.001);
      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({ regime: MarketRegimeType.NORMAL } as any);

      const freshService = new CompositeRegimeService(
        mockMarketRegimeService as any,
        mockOhlcService as any,
        mockCoinService as any,
        mockAuditService as any,
        mockCacheManager as any,
        mockEventEmitter as any
      );

      await freshService.onModuleInit();

      expect(freshService.isOverrideActive()).toBe(true);
      expect(mockCacheManager.get).toHaveBeenCalledWith('regime:override');
    });
  });

  // ---------------------------------------------------------------------------
  // Staleness detection
  // ---------------------------------------------------------------------------
  describe('staleness detection', () => {
    it('should return NEUTRAL when cached data is older than 4 hours', async () => {
      // First, do a successful refresh to populate cache with BEAR regime
      const summaries = generatePriceSummaries(250, 50000, 0.001);
      summaries[0].close = 10000; // below SMA → BEAR
      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.HIGH_VOLATILITY
      } as any);

      await service.refresh();
      expect(service.getCompositeRegime()).toBe(CompositeRegimeType.BEAR);

      // Manually age the cache beyond 4 hours
      const cached = (service as any).cached;
      cached.updatedAt = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago

      expect(service.getCompositeRegime()).toBe(CompositeRegimeType.NEUTRAL);
    });

    it('should return cached regime when data is between 2h and 4h old', async () => {
      const summaries = generatePriceSummaries(250, 50000, 0.001);
      summaries[0].close = 10000;
      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.HIGH_VOLATILITY
      } as any);

      await service.refresh();
      expect(service.getCompositeRegime()).toBe(CompositeRegimeType.BEAR);

      // Age the cache to 3 hours (between STALE_WARNING_MS and STALE_FALLBACK_MS)
      const cached = (service as any).cached;
      cached.updatedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);

      // Should still return the cached BEAR regime, not NEUTRAL
      expect(service.getCompositeRegime()).toBe(CompositeRegimeType.BEAR);
    });

    it('should return cached regime when data is less than 2 hours old', async () => {
      const summaries = generatePriceSummaries(250, 50000, 0.001);
      summaries[0].close = 10000;
      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.HIGH_VOLATILITY
      } as any);

      await service.refresh();
      expect(service.getCompositeRegime()).toBe(CompositeRegimeType.BEAR);

      // Age the cache to 1 hour (still fresh)
      const cached = (service as any).cached;
      cached.updatedAt = new Date(Date.now() - 1 * 60 * 60 * 1000);

      expect(service.getCompositeRegime()).toBe(CompositeRegimeType.BEAR);
    });
  });

  // ---------------------------------------------------------------------------
  // Failure tracking
  // ---------------------------------------------------------------------------
  describe('failure tracking', () => {
    it('should emit REGIME_STALE after 3 consecutive failures', async () => {
      mockCoinService.getCoinBySlug.mockResolvedValue(null);

      await service.refresh();
      await service.refresh();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();

      await service.refresh();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.REGIME_STALE,
        expect.objectContaining({
          consecutiveFailures: 3,
          cachedRegime: 'NONE'
        })
      );
    });

    it('should only emit REGIME_STALE once despite further failures', async () => {
      mockCoinService.getCoinBySlug.mockResolvedValue(null);

      for (let i = 0; i < 5; i++) {
        await service.refresh();
      }

      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    });

    it('should reset counters on successful refresh', async () => {
      // 2 failures
      mockCoinService.getCoinBySlug.mockResolvedValue(null);
      await service.refresh();
      await service.refresh();

      // Then a success
      mockCoinService.getCoinBySlug.mockResolvedValue({ id: BTC_COIN_ID, slug: 'bitcoin' } as any);
      const summaries = generatePriceSummaries(250, 50000, 0.001);
      summaries[0].close = 70000;
      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.NORMAL
      } as any);

      await service.refresh();
      expect((service as any).consecutiveFailures).toBe(0);
      expect((service as any).staleNotificationEmitted).toBe(false);

      // 3 more failures should emit again
      mockCoinService.getCoinBySlug.mockResolvedValue(null);
      await service.refresh();
      await service.refresh();
      await service.refresh();
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getStatus()
  // ---------------------------------------------------------------------------
  describe('getStatus', () => {
    it('should return correct shape when no cache and no override', () => {
      const freshService = new CompositeRegimeService(
        mockMarketRegimeService as any,
        mockOhlcService as any,
        mockCoinService as any,
        mockAuditService as any,
        mockCacheManager as any,
        mockEventEmitter as any
      );

      const status = freshService.getStatus();

      expect(status).toEqual({
        compositeRegime: CompositeRegimeType.NEUTRAL,
        volatilityRegime: null,
        trendAboveSma: null,
        btcPrice: null,
        sma200Value: null,
        updatedAt: null,
        isStale: false,
        consecutiveFailures: 0,
        lastSuccessfulRefresh: null,
        override: { active: false }
      });
    });

    it('should include cached data after refresh', async () => {
      const summaries = generatePriceSummaries(250, 50000, 0.001);
      // Set the first element (newest in descending order) to a high price
      summaries[0].close = 70000;

      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.LOW_VOLATILITY
      } as any);

      await service.refresh();
      const status = service.getStatus();

      expect(status.compositeRegime).toBe(CompositeRegimeType.BULL);
      expect(status.volatilityRegime).toBe(MarketRegimeType.LOW_VOLATILITY);
      expect(status.trendAboveSma).toBe(true);
      expect(status.btcPrice).toBeCloseTo(70000, 0);
      expect(status.sma200Value).toBeGreaterThan(0);
      expect(status.updatedAt).toBeInstanceOf(Date);
      expect(status.isStale).toBe(false);
      expect(status.consecutiveFailures).toBe(0);
      expect(status.lastSuccessfulRefresh).toEqual(status.updatedAt);
      expect(status.override).toEqual({ active: false });
    });

    it('should report stale status when cache is older than 2 hours', async () => {
      const summaries = generatePriceSummaries(250, 50000, 0.001);
      summaries[0].close = 70000;
      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.LOW_VOLATILITY
      } as any);

      await service.refresh();

      // Age the cache beyond 2 hours
      const cached = (service as any).cached;
      cached.updatedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);

      const status = service.getStatus();
      expect(status.isStale).toBe(true);
      expect(status.lastSuccessfulRefresh).toEqual(cached.updatedAt);
    });

    it('should include override details when override is active', async () => {
      await service.enableOverride('admin-1', true, 'Emergency');

      const status = service.getStatus();

      expect(status.override.active).toBe(true);
      expect(status.override.forceAllow).toBe(true);
      expect(status.override.userId).toBe('admin-1');
      expect(status.override.reason).toBe('Emergency');
      expect(status.override.enabledAt).toBeInstanceOf(Date);
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate deterministic PriceSummary data for testing.
 * Returns data in descending order (newest first) to match findAllByDay() behavior.
 */
function generatePriceSummaries(
  count: number,
  basePrice: number,
  drift: number
): { coin: string; date: Date; avg: number; high: number; low: number; close: number; open: number; volume: number }[] {
  const data: {
    coin: string;
    date: Date;
    avg: number;
    high: number;
    low: number;
    close: number;
    open: number;
    volume: number;
  }[] = [];
  const startTime = Date.now() - count * 86400000;

  for (let i = 0; i < count; i++) {
    const oscillation = Math.sin(i * 0.1) * basePrice * 0.01;
    const price = basePrice + oscillation + i * drift * basePrice;
    data.push({
      coin: 'btc-uuid',
      date: new Date(startTime + i * 86400000),
      avg: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      open: price,
      volume: 1000
    });
  }

  // Return descending (newest first) to match findAllByDay() behavior
  return data.reverse();
}
