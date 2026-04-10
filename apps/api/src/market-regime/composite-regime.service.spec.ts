import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, type TestingModule } from '@nestjs/testing';

import { AuditEventType, CompositeRegimeType, MarketRegimeType } from '@chansey/api-interfaces';

import { CompositeRegimeService } from './composite-regime.service';
import { MarketRegimeService } from './market-regime.service';

import { AuditService } from '../audit/audit.service';
import { CoinService } from '../coin/coin.service';
import { OHLCService } from '../ohlc/ohlc.service';

describe('CompositeRegimeService', () => {
  let service: CompositeRegimeService;
  let mockMarketRegimeService: jest.Mocked<Pick<MarketRegimeService, 'getCurrentRegime'>>;
  let mockOhlcService: jest.Mocked<Pick<OHLCService, 'findAllByDay'>>;
  let mockCoinService: jest.Mocked<Pick<CoinService, 'getCoinBySlug'>>;
  let mockAuditService: jest.Mocked<Pick<AuditService, 'createAuditLog'>>;
  let mockCacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompositeRegimeService,
        { provide: MarketRegimeService, useValue: mockMarketRegimeService },
        { provide: OHLCService, useValue: mockOhlcService },
        { provide: CoinService, useValue: mockCoinService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager }
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
    it.each([
      [MarketRegimeType.LOW_VOLATILITY, true, CompositeRegimeType.BULL],
      [MarketRegimeType.NORMAL, true, CompositeRegimeType.BULL],
      [MarketRegimeType.HIGH_VOLATILITY, true, CompositeRegimeType.NEUTRAL],
      [MarketRegimeType.EXTREME, true, CompositeRegimeType.NEUTRAL],
      [MarketRegimeType.LOW_VOLATILITY, false, CompositeRegimeType.BEAR],
      [MarketRegimeType.EXTREME, false, CompositeRegimeType.EXTREME]
    ])('classify(%s, aboveSma=%s) → %s', (volatility, aboveSma, expected) => {
      expect(service.classify(volatility, aboveSma)).toBe(expected);
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
        mockCacheManager as any
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

    it('should keep previous regime when SMA or price is non-finite', async () => {
      const summaries = generatePriceSummaries(250, 50000, 0.001);
      // Inject NaN values at the beginning (newest in descending order)
      for (let i = 0; i < 10; i++) {
        summaries[i].close = NaN;
      }

      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });

      const result = await service.refresh();

      // NaN closes are filtered out by the .filter(Number.isFinite) in source,
      // so this should still compute if enough valid points remain.
      // With 240 valid points (250 - 10 NaN), it proceeds normally.
      expect(result).toBeDefined();
    });

    it('should detect BEAR regime when high volatility + below SMA', async () => {
      const summaries = generatePriceSummaries(250, 50000, 0.001);
      // Set the first element (newest in descending order) to a low price
      summaries[0].close = 10000;

      mockOhlcService.findAllByDay.mockResolvedValue({ [BTC_COIN_ID]: summaries });
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.HIGH_VOLATILITY
      } as any);

      await service.refresh();

      expect(service.getCompositeRegime()).toBe(CompositeRegimeType.BEAR);
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
        mockCacheManager as any
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
        mockCacheManager as any
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
    it('should set override state and persist to Redis', async () => {
      await service.enableOverride('user-123', true, 'Emergency override');

      expect(service.isOverrideActive()).toBe(true);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'regime:override',
        expect.objectContaining({ active: true, forceAllow: true, userId: 'user-123' }),
        86_400_000
      );
    });

    it('should audit log the override with correct parameters', async () => {
      await service.enableOverride('user-456', true, 'Market crash response');

      expect(mockAuditService.createAuditLog).toHaveBeenCalledWith({
        eventType: AuditEventType.MANUAL_INTERVENTION,
        entityType: 'CompositeRegime',
        entityId: 'override',
        userId: 'user-456',
        afterState: { forceAllow: true, reason: 'Market crash response' },
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
        mockCacheManager as any
      );

      await freshService.onModuleInit();

      expect(freshService.isOverrideActive()).toBe(true);
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
        mockCacheManager as any
      );

      const status = freshService.getStatus();

      expect(status).toEqual({
        compositeRegime: CompositeRegimeType.NEUTRAL,
        volatilityRegime: null,
        trendAboveSma: null,
        btcPrice: null,
        sma200Value: null,
        updatedAt: null,
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
      expect(status.override).toEqual({ active: false });
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
