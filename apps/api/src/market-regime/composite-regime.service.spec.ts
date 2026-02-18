import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';

import { AuditEventType, CompositeRegimeType, MarketRegimeType } from '@chansey/api-interfaces';

import { CompositeRegimeService } from './composite-regime.service';
import { MarketRegimeService } from './market-regime.service';

import { AuditService } from '../audit/audit.service';
import { CoinService } from '../coin/coin.service';

describe('CompositeRegimeService', () => {
  let service: CompositeRegimeService;
  let mockMarketRegimeService: jest.Mocked<Pick<MarketRegimeService, 'getCurrentRegime'>>;
  let mockCoinService: jest.Mocked<Pick<CoinService, 'getMarketChart'>>;
  let mockAuditService: jest.Mocked<Pick<AuditService, 'createAuditLog'>>;
  let mockCacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    mockMarketRegimeService = {
      getCurrentRegime: jest.fn()
    };

    mockCoinService = {
      getMarketChart: jest.fn()
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
        { provide: CoinService, useValue: mockCoinService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager }
      ]
    }).compile();

    // Suppress the onModuleInit call that happens automatically during compile
    // by mocking the dependencies to return valid but minimal data
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
  // getCompositeRegime()
  // ---------------------------------------------------------------------------
  describe('getCompositeRegime', () => {
    it('should return NEUTRAL when no cached value exists', () => {
      // The service starts with cached = null (ignoring onModuleInit side effects)
      // We need a fresh instance without onModuleInit having run successfully.
      // Since our mock coinService was not set up to return valid data before compile,
      // the cache may or may not be populated. Let's test with a fresh service directly.
      const freshService = new CompositeRegimeService(
        mockMarketRegimeService as any,
        mockCoinService as any,
        mockAuditService as any,
        mockCacheManager as any
      );
      expect(freshService.getCompositeRegime()).toBe(CompositeRegimeType.NEUTRAL);
    });

    it('should return cached regime after a successful refresh', async () => {
      const prices = generatePriceData(250, 50000, 0.001);
      // Set the last price well above SMA to get BULL
      prices[prices.length - 1].price = 70000;

      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.NORMAL
      } as any);

      await service.refresh();

      // NORMAL volatility + above SMA = BULL
      expect(service.getCompositeRegime()).toBe(CompositeRegimeType.BULL);
    });
  });

  // ---------------------------------------------------------------------------
  // refresh()
  // ---------------------------------------------------------------------------
  describe('refresh', () => {
    it('should call coinService.getMarketChart with bitcoin and 1y', async () => {
      const prices = generatePriceData(250, 50000, 0.001);
      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.NORMAL
      } as any);

      await service.refresh();

      expect(mockCoinService.getMarketChart).toHaveBeenCalledWith('bitcoin', '1y');
    });

    it('should call marketRegimeService.getCurrentRegime with BTC', async () => {
      const prices = generatePriceData(250, 50000, 0.001);
      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.NORMAL
      } as any);

      await service.refresh();

      expect(mockMarketRegimeService.getCurrentRegime).toHaveBeenCalledWith('BTC');
    });

    it('should keep previous regime when fewer than 200 data points', async () => {
      const prices = generatePriceData(100, 50000, 0.001);
      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);

      const result = await service.refresh();

      // No previous cache, so should fall back to NEUTRAL
      expect(result).toBe(CompositeRegimeType.NEUTRAL);
      // getCurrentRegime should NOT be called when data is insufficient
      expect(mockMarketRegimeService.getCurrentRegime).not.toHaveBeenCalled();
    });

    it('should default to NORMAL volatility when getCurrentRegime returns null', async () => {
      // Generate prices where the last price is clearly above the SMA
      const prices = generatePriceData(250, 40000, 0.0005);
      prices[prices.length - 1].price = 60000;

      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue(null);

      const result = await service.refresh();

      // NORMAL + above SMA = BULL
      expect(result).toBe(CompositeRegimeType.BULL);
    });

    it('should update cached value after successful refresh', async () => {
      const prices = generatePriceData(250, 50000, 0.001);
      // Force below SMA for BEAR
      prices[prices.length - 1].price = 10000;

      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.HIGH_VOLATILITY
      } as any);

      await service.refresh();

      // HIGH_VOLATILITY + below SMA = BEAR
      expect(service.getCompositeRegime()).toBe(CompositeRegimeType.BEAR);
    });

    it('should propagate errors from coinService', async () => {
      mockCoinService.getMarketChart.mockRejectedValue(new Error('CoinGecko API down'));

      await expect(service.refresh()).rejects.toThrow('CoinGecko API down');
    });

    it('should propagate errors from marketRegimeService', async () => {
      const prices = generatePriceData(250, 50000, 0.001);
      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);
      mockMarketRegimeService.getCurrentRegime.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.refresh()).rejects.toThrow('DB connection lost');
    });

    it('should detect EXTREME regime when extreme vol + below SMA', async () => {
      const prices = generatePriceData(250, 50000, 0.001);
      prices[prices.length - 1].price = 10000;

      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.EXTREME
      } as any);

      const result = await service.refresh();

      expect(result).toBe(CompositeRegimeType.EXTREME);
    });
  });

  // ---------------------------------------------------------------------------
  // onModuleInit()
  // ---------------------------------------------------------------------------
  describe('onModuleInit', () => {
    it('should not throw when refresh fails during init', async () => {
      const freshService = new CompositeRegimeService(
        mockMarketRegimeService as any,
        mockCoinService as any,
        mockAuditService as any,
        mockCacheManager as any
      );

      mockCoinService.getMarketChart.mockRejectedValue(new Error('Startup failure'));

      // onModuleInit catches errors and logs a warning
      await expect(freshService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should call refresh on init', async () => {
      const freshService = new CompositeRegimeService(
        mockMarketRegimeService as any,
        mockCoinService as any,
        mockAuditService as any,
        mockCacheManager as any
      );

      const prices = generatePriceData(250, 50000, 0.001);
      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({
        regime: MarketRegimeType.NORMAL
      } as any);

      await freshService.onModuleInit();

      expect(mockCoinService.getMarketChart).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // enableOverride() / disableOverride()
  // ---------------------------------------------------------------------------
  describe('enableOverride', () => {
    it('should set override active state', async () => {
      await service.enableOverride('user-123', true, 'Emergency override');

      expect(service.isOverrideActive()).toBe(true);
    });

    it('should call auditService with correct parameters', async () => {
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

    it('should store forceAllow flag correctly', async () => {
      await service.enableOverride('user-789', false, 'Test');

      const status = service.getStatus();
      expect(status.override.active).toBe(true);
      expect(status.override.forceAllow).toBe(false);
    });
  });

  describe('disableOverride', () => {
    it('should clear override state', async () => {
      await service.enableOverride('user-123', true, 'Enable');
      expect(service.isOverrideActive()).toBe(true);

      await service.disableOverride('user-123', 'Disable');
      expect(service.isOverrideActive()).toBe(false);
    });

    it('should call auditService with previous state', async () => {
      await service.enableOverride('user-123', true, 'Orig reason');
      jest.clearAllMocks();

      await service.disableOverride('user-123', 'Crisis passed');

      expect(mockAuditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.MANUAL_INTERVENTION,
          entityType: 'CompositeRegime',
          entityId: 'override',
          userId: 'user-123',
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
  // Redis persistence
  // ---------------------------------------------------------------------------
  describe('Redis override persistence', () => {
    it('should persist override to Redis on enable', async () => {
      await service.enableOverride('user-1', true, 'Emergency');

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'regime:override',
        expect.objectContaining({ active: true, forceAllow: true, userId: 'user-1' }),
        86_400_000
      );
    });

    it('should delete override from Redis on disable', async () => {
      await service.enableOverride('user-1', true, 'Enable');
      jest.clearAllMocks();

      await service.disableOverride('user-1', 'Done');

      expect(mockCacheManager.del).toHaveBeenCalledWith('regime:override');
    });

    it('should restore override from Redis on init', async () => {
      const saved = {
        active: true,
        forceAllow: true,
        userId: 'admin-1',
        reason: 'Persisted',
        enabledAt: new Date()
      };
      mockCacheManager.get.mockResolvedValue(saved);

      const prices = generatePriceData(250, 50000, 0.001);
      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);
      mockMarketRegimeService.getCurrentRegime.mockResolvedValue({ regime: MarketRegimeType.NORMAL } as any);

      const freshService = new CompositeRegimeService(
        mockMarketRegimeService as any,
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
      const prices = generatePriceData(250, 50000, 0.001);
      prices[prices.length - 1].price = 70000;

      mockCoinService.getMarketChart.mockResolvedValue({ prices } as any);
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
 * Generate deterministic price data for testing.
 * Creates a stable, slightly upward-trending price series.
 */
function generatePriceData(count: number, basePrice: number, drift: number): { timestamp: number; price: number }[] {
  const data: { timestamp: number; price: number }[] = [];
  let price = basePrice;
  const startTime = Date.now() - count * 86400000;

  for (let i = 0; i < count; i++) {
    // Small deterministic drift to keep prices near basePrice
    // Using a simple sine wave to avoid random number generation
    const oscillation = Math.sin(i * 0.1) * basePrice * 0.01;
    price = basePrice + oscillation + i * drift * basePrice;
    data.push({
      timestamp: startTime + i * 86400000,
      price
    });
  }

  return data;
}
