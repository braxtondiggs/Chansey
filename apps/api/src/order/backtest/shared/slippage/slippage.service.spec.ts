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

      it('should ignore quantity and price for fixed model', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.FIXED,
          fixedBps: 15
        };
        expect(service.calculateSlippageBps(1, 1, config)).toBe(15);
        expect(service.calculateSlippageBps(1000000, 100000, config)).toBe(15);
      });
    });

    describe('VOLUME_BASED model', () => {
      it('should increase slippage with larger order size relative to volume', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 100
        };

        // Small order (1% of daily volume)
        const smallOrder = service.calculateSlippageBps(100, 50000, config, 500000000);
        // Medium order (10% of daily volume)
        const mediumOrder = service.calculateSlippageBps(1000, 50000, config, 500000000);
        // Large order (50% of daily volume)
        const largeOrder = service.calculateSlippageBps(5000, 50000, config, 500000000);

        expect(smallOrder).toBeLessThan(mediumOrder);
        expect(mediumOrder).toBeLessThan(largeOrder);
      });

      it('should calculate slippage from order value and volume', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 100
        };

        // orderValue = 10 * 100 = 1000; volumeRatio = 0.01
        const result = service.calculateSlippageBps(10, 100, config, 100000);
        expect(result).toBe(6);
      });

      it('should use default values when not specified', () => {
        const config: SlippageConfig = { type: SlippageModelType.VOLUME_BASED };
        const result = service.calculateSlippageBps(100, 50000, config, 500000000);
        // Should be base 5 + volume impact
        expect(result).toBeGreaterThanOrEqual(5);
      });

      it('should cap slippage at maxSlippageBps', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 1000,
          maxSlippageBps: 500
        };
        // Very large order relative to volume
        const result = service.calculateSlippageBps(1000000, 50000, config, 1000000);
        expect(result).toBeLessThanOrEqual(500);
      });

      it('should handle missing volume with small default ratio', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 100
        };
        const result = service.calculateSlippageBps(100, 50000, config);
        // Should use default 0.001 volume ratio
        expect(result).toBeGreaterThanOrEqual(5);
      });

      it('should handle zero volume gracefully', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 100
        };
        const result = service.calculateSlippageBps(100, 50000, config, 0);
        expect(result).toBeGreaterThanOrEqual(5);
      });

      it('should fall back to default ratio when volume is negative', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 100
        };
        const result = service.calculateSlippageBps(10, 100, config, -1000);
        expect(result).toBeCloseTo(5.1, 5);
      });

      it('should cap slippage using default max when maxSlippageBps not provided', () => {
        const config: SlippageConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 1000
        };
        // Very large order; should be capped at default 500 bps
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

    describe('BUY orders', () => {
      it('should increase price for buy orders', () => {
        const result = service.applySlippage(basePrice, 10, true);
        // 10 bps = 0.1% increase = 50000 * 0.001 = 50
        expect(result).toBeCloseTo(50050, 2);
      });

      it('should handle zero slippage', () => {
        const result = service.applySlippage(basePrice, 0, true);
        expect(result).toBe(basePrice);
      });

      it('should handle large slippage correctly', () => {
        const result = service.applySlippage(basePrice, 100, true);
        // 100 bps = 1% increase = 50000 * 0.01 = 500
        expect(result).toBeCloseTo(50500, 2);
      });
    });

    describe('SELL orders', () => {
      it('should decrease price for sell orders', () => {
        const result = service.applySlippage(basePrice, 10, false);
        // 10 bps = 0.1% decrease = 50000 * 0.001 = 50
        expect(result).toBeCloseTo(49950, 2);
      });

      it('should handle zero slippage', () => {
        const result = service.applySlippage(basePrice, 0, false);
        expect(result).toBe(basePrice);
      });

      it('should handle large slippage correctly', () => {
        const result = service.applySlippage(basePrice, 100, false);
        // 100 bps = 1% decrease = 50000 * 0.01 = 500
        expect(result).toBeCloseTo(49500, 2);
      });
    });

    it('should be symmetric for buy and sell', () => {
      const slippageBps = 50;
      const buyPrice = service.applySlippage(basePrice, slippageBps, true);
      const sellPrice = service.applySlippage(basePrice, slippageBps, false);

      // Buy adds, sell subtracts the same amount (within floating point tolerance)
      expect(buyPrice - basePrice).toBeCloseTo(basePrice - sellPrice, 2);
    });

    it('should handle fractional bps with precision', () => {
      const result = service.applySlippage(basePrice, 12.5, true);
      expect(result).toBeCloseTo(50062.5, 5);
    });

    it('should increase price impact with higher bps', () => {
      const low = service.applySlippage(basePrice, 5, true);
      const high = service.applySlippage(basePrice, 50, true);
      expect(high - basePrice).toBeGreaterThan(low - basePrice);
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

      expect(result).toHaveProperty('slippageBps');
      expect(result).toHaveProperty('executionPrice');
      expect(result).toHaveProperty('priceImpact');
      expect(result).toHaveProperty('originalPrice');
      expect(result.originalPrice).toBe(50000);
      expect(result.executionPrice).toBeGreaterThan(50000);
    });

    it('should return complete SlippageResult for sell order', () => {
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

      // 10 bps = 0.1% = 0.001
      expect(result.priceImpact).toBeCloseTo(0.001, 5);
    });

    it('should use custom config when provided', () => {
      const customConfig: SlippageConfig = {
        type: SlippageModelType.FIXED,
        fixedBps: 20
      };

      const result = service.calculateSlippage(
        {
          price: 10000,
          quantity: 1,
          isBuy: true
        },
        customConfig
      );

      // 20 bps = 0.2% = 0.002 price impact
      expect(result.slippageBps).toBe(20);
      expect(result.priceImpact).toBeCloseTo(0.002, 5);
    });

    it('should use default config when not provided', () => {
      const result = service.calculateSlippage({
        price: 50000,
        quantity: 1,
        isBuy: true
      });

      // Default is FIXED with 5 bps
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
      it('should throw error for zero price', () => {
        expect(() =>
          service.calculateSlippage({
            price: 0,
            quantity: 1,
            isBuy: true
          })
        ).toThrow('Price must be a positive finite number');
      });

      it('should throw error for negative price', () => {
        expect(() =>
          service.calculateSlippage({
            price: -100,
            quantity: 1,
            isBuy: true
          })
        ).toThrow('Price must be a positive finite number');
      });

      it('should throw error for NaN price', () => {
        expect(() =>
          service.calculateSlippage({
            price: NaN,
            quantity: 1,
            isBuy: true
          })
        ).toThrow('Price must be a positive finite number');
      });

      it('should throw error for Infinity price', () => {
        expect(() =>
          service.calculateSlippage({
            price: Infinity,
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
        volumeImpactFactor: 150,
        maxSlippageBps: 300
      });

      expect(config.type).toBe(SlippageModelType.VOLUME_BASED);
      expect(config.fixedBps).toBe(10);
      expect(config.baseSlippageBps).toBe(7);
      expect(config.volumeImpactFactor).toBe(150);
      expect(config.maxSlippageBps).toBe(300);
    });

    it('should use defaults when parameters not provided', () => {
      const config = service.buildConfig();

      expect(config.type).toBe(SlippageModelType.FIXED);
      expect(config.fixedBps).toBe(5);
      expect(config.baseSlippageBps).toBe(5);
      expect(config.volumeImpactFactor).toBe(100);
      expect(config.maxSlippageBps).toBe(500);
    });

    it('should handle partial parameters', () => {
      const config = service.buildConfig({
        type: SlippageModelType.FIXED,
        fixedBps: 20
      });

      expect(config.type).toBe(SlippageModelType.FIXED);
      expect(config.fixedBps).toBe(20);
      expect(config.baseSlippageBps).toBe(5);
      expect(config.volumeImpactFactor).toBe(100);
      expect(config.maxSlippageBps).toBe(500);
    });

    it('should default model when only other values are provided', () => {
      const config = service.buildConfig({
        fixedBps: 12,
        volumeImpactFactor: 200
      });

      expect(config.type).toBe(SlippageModelType.FIXED);
      expect(config.fixedBps).toBe(12);
      expect(config.baseSlippageBps).toBe(5);
      expect(config.volumeImpactFactor).toBe(200);
    });
  });

  describe('DEFAULT_SLIPPAGE_CONFIG', () => {
    it('should have FIXED model with 5 bps and 500 max', () => {
      expect(DEFAULT_SLIPPAGE_CONFIG.type).toBe(SlippageModelType.FIXED);
      expect(DEFAULT_SLIPPAGE_CONFIG.fixedBps).toBe(5);
      expect(DEFAULT_SLIPPAGE_CONFIG.maxSlippageBps).toBe(500);
    });
  });
});
