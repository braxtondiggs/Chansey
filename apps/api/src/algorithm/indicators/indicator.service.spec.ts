import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, type TestingModule } from '@nestjs/testing';

import type { Cache } from 'cache-manager';

import type { BollingerBandsResult, IndicatorResult, MACDResult } from './indicator.interface';
import { IndicatorService } from './indicator.service';

describe('IndicatorService', () => {
  let service: IndicatorService;
  let cacheManager: jest.Mocked<Cache>;

  beforeEach(async () => {
    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      reset: jest.fn()
    } as unknown as jest.Mocked<Cache>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [IndicatorService, { provide: CACHE_MANAGER, useValue: cacheManager }]
    }).compile();

    service = module.get<IndicatorService>(IndicatorService);
  });

  describe('cache NaN restoration', () => {
    const mockPrices = Array.from({ length: 30 }, (_, i) => ({
      avg: 100 + i,
      high: 105 + i,
      low: 95 + i,
      date: new Date(2024, 0, i + 1)
    }));

    it('should restore null values to NaN in cached IndicatorResult', async () => {
      // Simulate what Redis returns after JSON round-trip: NaN becomes null
      const cachedResult: IndicatorResult = {
        values: [null, null, null, 45.2, 52.1, 48.7] as unknown as number[],
        validCount: 3,
        period: 14,
        fromCache: false
      };
      cacheManager.get.mockResolvedValue(cachedResult);

      const result = await service.calculateRSI({
        coinId: 'btc',
        prices: mockPrices as any,
        period: 14
      });

      // First 3 values should be NaN (restored from null), not null
      expect(result.values[0]).toBeNaN();
      expect(result.values[1]).toBeNaN();
      expect(result.values[2]).toBeNaN();
      // Valid values should be preserved
      expect(result.values[3]).toBe(45.2);
      expect(result.values[4]).toBe(52.1);
      expect(result.values[5]).toBe(48.7);
      expect(result.fromCache).toBe(true);
    });

    it('should restore null values in cached MACDResult', async () => {
      const cachedResult: MACDResult = {
        macd: [null, null, 0.5, 0.8] as unknown as number[],
        signal: [null, null, 0.3, 0.6] as unknown as number[],
        histogram: [null, null, 0.2, 0.2] as unknown as number[],
        validCount: 2,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        fromCache: false
      };
      cacheManager.get.mockResolvedValue(cachedResult);

      const result = await service.calculateMACD({
        coinId: 'btc',
        prices: mockPrices as any,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9
      });

      expect(result.macd[0]).toBeNaN();
      expect(result.macd[1]).toBeNaN();
      expect(result.macd[2]).toBe(0.5);
      expect(result.signal[0]).toBeNaN();
      expect(result.histogram[0]).toBeNaN();
      expect(result.fromCache).toBe(true);
    });

    it('should restore null values in cached BollingerBandsResult', async () => {
      const cachedResult: BollingerBandsResult = {
        upper: [null, 110, 112] as unknown as number[],
        middle: [null, 100, 102] as unknown as number[],
        lower: [null, 90, 92] as unknown as number[],
        pb: [null, 0.5, 0.6] as unknown as number[],
        bandwidth: [null, 0.2, 0.19] as unknown as number[],
        validCount: 2,
        period: 20,
        stdDev: 2,
        fromCache: false
      };
      cacheManager.get.mockResolvedValue(cachedResult);

      const result = await service.calculateBollingerBands({
        coinId: 'btc',
        prices: mockPrices as any,
        period: 20,
        stdDev: 2
      });

      expect(result.upper[0]).toBeNaN();
      expect(result.middle[0]).toBeNaN();
      expect(result.lower[0]).toBeNaN();
      expect(result.pb[0]).toBeNaN();
      expect(result.bandwidth[0]).toBeNaN();
      expect(result.upper[1]).toBe(110);
      expect(result.fromCache).toBe(true);
    });

    it('should handle cache miss gracefully (returns null)', async () => {
      cacheManager.get.mockResolvedValue(undefined);

      // This will compute fresh values — just verify no crash
      const result = await service.calculateRSI({
        coinId: 'btc',
        prices: mockPrices as any,
        period: 14
      });

      expect(result.fromCache).toBe(false);
      expect(result.values).toBeDefined();
    });
  });
});
