import { Test, TestingModule } from '@nestjs/testing';

import { DEFAULT_SLIPPAGE_CONFIG, SlippageConfig, SlippageModelType } from './slippage.interface';
import { SlippageService } from './slippage.service';

describe('SlippageService', () => {
  let service: SlippageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SlippageService]
    }).compile();

    service = module.get<SlippageService>(SlippageService);
  });

  describe('calculateSlippageBps', () => {
    describe('NONE model', () => {
      it('should return 0 for NONE model', () => {
        const config: SlippageConfig = { type: SlippageModelType.NONE };
        expect(service.calculateSlippageBps(100, 50000, config)).toBe(0);
      });
    });

    describe('FIXED model', () => {
      it('should return fixed slippage from config', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.FIXED,
          fixedBps: 10
        };
        expect(service.calculateSlippageBps(100, 50000, config)).toBe(10);
      });

      it('should default to 5 bps when fixedBps not specified', () => {
        const config: SlippageConfig = { type: SlippageModelType.FIXED };
        expect(service.calculateSlippageBps(100, 50000, config)).toBe(5);
      });
    });

    describe('VOLUME_BASED model', () => {
      it('should increase slippage with larger order size relative to volume', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5
        };

        const smallOrder = service.calculateSlippageBps(100, 50000, config, 500000000);
        const mediumOrder = service.calculateSlippageBps(1000, 50000, config, 500000000);
        const largeOrder = service.calculateSlippageBps(5000, 50000, config, 500000000);

        expect(smallOrder).toBeLessThan(mediumOrder);
        expect(mediumOrder).toBeLessThan(largeOrder);
      });

      it('should calculate slippage using square-root impact model', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volatilityFactor: 0.1
        };

        // orderValue = 10 * 100 = 1000; participationRate = 0.01
        // impact = 0.1 * sqrt(0.01) = 0.1 * 0.1 = 0.01 => 100 bps
        // total = 5 + 100 = 105
        const result = service.calculateSlippageBps(10, 100, config, 100000);
        expect(result).toBeCloseTo(105, 5);
      });

      it('should cap slippage at maxSlippageBps', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volatilityFactor: 0.5,
          maxSlippageBps: 500
        };
        const result = service.calculateSlippageBps(1000000, 50000, config, 1000000);
        expect(result).toBeLessThanOrEqual(500);
      });

      it.each([
        ['missing', undefined],
        ['zero', 0],
        ['negative', -1000]
      ])('should return baseSlippageBps when volume is %s', (_label, volume) => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5
        };
        const result = service.calculateSlippageBps(100, 50000, config, volume);
        expect(result).toBe(5);
      });

      it('should show convexity: doubling order increases impact by ~sqrt(2)x, not 2x', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 0,
          volatilityFactor: 0.1,
          maxSlippageBps: 10000
        };
        const dailyVolume = 1000000;
        const small = service.calculateSlippageBps(100, 100, config, dailyVolume);
        const double = service.calculateSlippageBps(200, 100, config, dailyVolume);
        expect(double / small).toBeCloseTo(Math.sqrt(2), 2);
      });

      it('should cap slippage using default max when maxSlippageBps not provided', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volatilityFactor: 0.5
        };
        const result = service.calculateSlippageBps(1000000, 50000, config, 1000000);
        expect(result).toBe(500);
      });
    });

    describe('HISTORICAL model', () => {
      it('should return fixedBps when available', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.HISTORICAL,
          fixedBps: 8
        };
        expect(service.calculateSlippageBps(100, 50000, config)).toBe(8);
      });

      it('should default to 10 bps when fixedBps not specified', () => {
        const config: SlippageConfig = { type: SlippageModelType.HISTORICAL };
        expect(service.calculateSlippageBps(100, 50000, config)).toBe(10);
      });
    });

    describe('unknown model type', () => {
      it('should return default 5 bps for unknown model', () => {
        const config = { type: 'unknown' as SlippageModelType };
        expect(service.calculateSlippageBps(100, 50000, config)).toBe(5);
      });
    });

    it('should apply maxSlippageBps even for FIXED model', () => {
      const config: SlippageConfig = {
        type: SlippageModelType.FIXED,
        fixedBps: 1000,
        maxSlippageBps: 200
      };
      expect(service.calculateSlippageBps(1, 1, config)).toBe(200);
    });
  });

  describe('applySlippage', () => {
    const basePrice = 50000;

    it('should increase price for buy orders', () => {
      const result = service.applySlippage(basePrice, 10, true);
      expect(result).toBeCloseTo(50050, 2);
    });

    it('should decrease price for sell orders', () => {
      const result = service.applySlippage(basePrice, 10, false);
      expect(result).toBeCloseTo(49950, 2);
    });

    it('should return original price for zero slippage', () => {
      expect(service.applySlippage(basePrice, 0, true)).toBe(basePrice);
      expect(service.applySlippage(basePrice, 0, false)).toBe(basePrice);
    });

    it('should be symmetric for buy and sell', () => {
      const slippageBps = 50;
      const buyPrice = service.applySlippage(basePrice, slippageBps, true);
      const sellPrice = service.applySlippage(basePrice, slippageBps, false);
      expect(buyPrice - basePrice).toBeCloseTo(basePrice - sellPrice, 2);
    });

    it('should handle fractional bps with precision', () => {
      const result = service.applySlippage(basePrice, 12.5, true);
      expect(result).toBeCloseTo(50062.5, 5);
    });
  });

  describe('calculateSlippage', () => {
    it('should return complete SlippageResult for buy order', () => {
      const result = service.calculateSlippage({
        price: 50000,
        quantity: 1,
        isBuy: true,
        dailyVolume: 1000000
      });

      expect(result.originalPrice).toBe(50000);
      expect(result.executionPrice).toBeGreaterThan(50000);
      expect(result.slippageBps).toBeGreaterThan(0);
      expect(result.priceImpact).toBeGreaterThan(0);
    });

    it('should return lower execution price for sell order', () => {
      const result = service.calculateSlippage({
        price: 50000,
        quantity: 1,
        isBuy: false,
        dailyVolume: 1000000
      });

      expect(result.executionPrice).toBeLessThan(50000);
      expect(result.priceImpact).toBeGreaterThan(0);
    });

    it('should calculate correct price impact', () => {
      const result = service.calculateSlippage(
        {
          price: 50000,
          quantity: 1,
          isBuy: true
        },
        { type: SlippageModelType.FIXED, fixedBps: 10 }
      );

      expect(result.priceImpact).toBeCloseTo(0.001, 5);
    });

    it('should use custom config when provided', () => {
      const result = service.calculateSlippage(
        {
          price: 10000,
          quantity: 1,
          isBuy: true
        },
        { type: SlippageModelType.FIXED, fixedBps: 20 }
      );

      expect(result.slippageBps).toBe(20);
      expect(result.priceImpact).toBeCloseTo(0.002, 5);
    });

    it('should use default config when not provided', () => {
      const result = service.calculateSlippage({
        price: 50000,
        quantity: 1,
        isBuy: true
      });

      expect(result.slippageBps).toBe(5);
    });

    it('should return zero price impact when slippage is zero', () => {
      const result = service.calculateSlippage(
        {
          price: 50000,
          quantity: 1,
          isBuy: true
        },
        { type: SlippageModelType.NONE }
      );

      expect(result.slippageBps).toBe(0);
      expect(result.executionPrice).toBe(50000);
      expect(result.priceImpact).toBe(0);
    });

    describe('input validation', () => {
      it.each([
        ['zero', 0],
        ['negative', -100],
        ['NaN', NaN],
        ['Infinity', Infinity]
      ])('should throw error for %s price', (_label, price) => {
        expect(() =>
          service.calculateSlippage({
            price,
            quantity: 1,
            isBuy: true
          })
        ).toThrow('Price must be a positive finite number');
      });
    });
  });

  describe('buildConfig', () => {
    it('should build config with all parameters', () => {
      const config = service.buildConfig({
        type: SlippageModelType.VOLUME_BASED,
        fixedBps: 10,
        baseSlippageBps: 7,
        maxSlippageBps: 300,
        participationRateLimit: 0.05,
        rejectParticipationRate: 0.5,
        volatilityFactor: 0.2
      });

      expect(config.type).toBe(SlippageModelType.VOLUME_BASED);
      expect(config.fixedBps).toBe(10);
      expect(config.baseSlippageBps).toBe(7);
      expect(config.maxSlippageBps).toBe(300);
      expect(config.participationRateLimit).toBe(0.05);
      expect(config.rejectParticipationRate).toBe(0.5);
      expect(config.volatilityFactor).toBe(0.2);
    });

    it('should use defaults when parameters not provided', () => {
      const config = service.buildConfig();

      expect(config.type).toBe(SlippageModelType.FIXED);
      expect(config.fixedBps).toBe(5);
      expect(config.baseSlippageBps).toBe(5);
      expect(config.maxSlippageBps).toBe(500);
      expect(config.volatilityFactor).toBe(0.1);
      expect(config.participationRateLimit).toBeUndefined();
      expect(config.rejectParticipationRate).toBeUndefined();
    });
  });

  describe('assessFillability', () => {
    const volumeConfig: SlippageConfig = {
      type: SlippageModelType.VOLUME_BASED,
      participationRateLimit: 0.05,
      rejectParticipationRate: 0.5
    };

    it('should return FILLED when order is within participation limit', () => {
      const result = service.assessFillability(1000, 100, 100000, volumeConfig);
      expect(result.fillStatus).toBe('FILLED');
      expect(result.fillable).toBe(true);
      expect(result.fillableQuantity).toBe(10);
      expect(result.participationRate).toBeCloseTo(0.01);
    });

    it('should return PARTIAL when order exceeds participation limit', () => {
      const result = service.assessFillability(10000, 100, 100000, volumeConfig);
      expect(result.fillStatus).toBe('PARTIAL');
      expect(result.fillable).toBe(true);
      expect(result.fillableQuantity).toBe(50);
      expect(result.participationRate).toBeCloseTo(0.1);
      expect(result.reason).toContain('5.0%');
    });

    it('should return CANCELLED when order exceeds reject threshold', () => {
      const result = service.assessFillability(60000, 100, 100000, volumeConfig);
      expect(result.fillStatus).toBe('CANCELLED');
      expect(result.fillable).toBe(false);
      expect(result.fillableQuantity).toBe(0);
      expect(result.participationRate).toBeCloseTo(0.6);
      expect(result.reason).toContain('rejection threshold');
    });

    it.each([
      ['undefined', undefined],
      ['zero', 0]
    ])('should return FILLED when volume is %s (graceful degradation)', (_label, volume) => {
      const result = service.assessFillability(10000, 100, volume, volumeConfig);
      expect(result.fillStatus).toBe('FILLED');
      expect(result.fillable).toBe(true);
      expect(result.participationRate).toBe(0);
    });

    it.each([
      ['NONE', SlippageModelType.NONE],
      ['FIXED', SlippageModelType.FIXED]
    ])('should always return FILLED for %s model', (_label, type) => {
      const config: SlippageConfig = { type, participationRateLimit: 0.01 };
      const result = service.assessFillability(100000, 100, 1000, config);
      expect(result.fillStatus).toBe('FILLED');
      expect(result.fillable).toBe(true);
    });

    it('should return FILLED when no participation limits are set', () => {
      const config: SlippageConfig = { type: SlippageModelType.VOLUME_BASED };
      const result = service.assessFillability(50000, 100, 100000, config);
      expect(result.fillStatus).toBe('FILLED');
      expect(result.fillable).toBe(true);
      expect(result.participationRate).toBeCloseTo(0.5);
    });

    it('should return fillableQuantity 0 when price is 0', () => {
      const config: SlippageConfig = { type: SlippageModelType.VOLUME_BASED };
      const result = service.assessFillability(10000, 0, 100000, config);
      expect(result.fillStatus).toBe('FILLED');
      expect(result.fillableQuantity).toBe(0);
    });
  });

  describe('DEFAULT_SLIPPAGE_CONFIG', () => {
    it('should have FIXED model with 5 bps, 500 max, and volatilityFactor 0.1', () => {
      expect(DEFAULT_SLIPPAGE_CONFIG.type).toBe(SlippageModelType.FIXED);
      expect(DEFAULT_SLIPPAGE_CONFIG.fixedBps).toBe(5);
      expect(DEFAULT_SLIPPAGE_CONFIG.maxSlippageBps).toBe(500);
      expect(DEFAULT_SLIPPAGE_CONFIG.volatilityFactor).toBe(0.1);
    });
  });
});
