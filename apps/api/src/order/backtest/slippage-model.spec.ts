import {
  DEFAULT_SLIPPAGE_CONFIG,
  SlippageModelConfig,
  SlippageModelType,
  applySlippage,
  buildSlippageConfig,
  calculateSimulatedSlippage
} from './slippage-model';

describe('SlippageModel', () => {
  describe('calculateSimulatedSlippage', () => {
    describe('NONE model', () => {
      it('should return 0 for NONE model', () => {
        const config: SlippageModelConfig = { type: SlippageModelType.NONE };
        expect(calculateSimulatedSlippage(config, 100, 50000)).toBe(0);
      });
    });

    describe('FIXED model', () => {
      it('should return fixed slippage from config', () => {
        const config: SlippageModelConfig = {
          type: SlippageModelType.FIXED,
          fixedBps: 10
        };
        expect(calculateSimulatedSlippage(config, 100, 50000)).toBe(10);
      });

      it('should default to 5 bps when fixedBps not specified', () => {
        const config: SlippageModelConfig = { type: SlippageModelType.FIXED };
        expect(calculateSimulatedSlippage(config, 100, 50000)).toBe(5);
      });

      it('should ignore quantity and price for fixed model', () => {
        const config: SlippageModelConfig = {
          type: SlippageModelType.FIXED,
          fixedBps: 15
        };
        expect(calculateSimulatedSlippage(config, 1, 1)).toBe(15);
        expect(calculateSimulatedSlippage(config, 1000000, 100000)).toBe(15);
      });
    });

    describe('VOLUME_BASED model', () => {
      it('should increase slippage with larger order size relative to volume', () => {
        const config: SlippageModelConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 100
        };

        // Small order (1% of daily volume)
        const smallOrder = calculateSimulatedSlippage(config, 100, 50000, 500000000);
        // Medium order (10% of daily volume)
        const mediumOrder = calculateSimulatedSlippage(config, 1000, 50000, 500000000);
        // Large order (50% of daily volume)
        const largeOrder = calculateSimulatedSlippage(config, 5000, 50000, 500000000);

        expect(smallOrder).toBeLessThan(mediumOrder);
        expect(mediumOrder).toBeLessThan(largeOrder);
      });

      it('should calculate slippage from order value and volume', () => {
        const config: SlippageModelConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 100
        };

        // orderValue = 10 * 100 = 1000; volumeRatio = 0.01
        const result = calculateSimulatedSlippage(config, 10, 100, 100000);
        expect(result).toBe(6);
      });

      it('should use default values when not specified', () => {
        const config: SlippageModelConfig = { type: SlippageModelType.VOLUME_BASED };
        const result = calculateSimulatedSlippage(config, 100, 50000, 500000000);
        // Should be base 5 + volume impact
        expect(result).toBeGreaterThanOrEqual(5);
      });

      it('should cap slippage at 500 bps', () => {
        const config: SlippageModelConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 1000
        };
        // Very large order relative to volume
        const result = calculateSimulatedSlippage(config, 1000000, 50000, 1000000);
        expect(result).toBeLessThanOrEqual(500);
      });

      it('should handle missing volume with small default ratio', () => {
        const config: SlippageModelConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 100
        };
        const result = calculateSimulatedSlippage(config, 100, 50000);
        // Should use default 0.001 volume ratio
        expect(result).toBeGreaterThanOrEqual(5);
      });

      it('should handle zero volume gracefully', () => {
        const config: SlippageModelConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 100
        };
        const result = calculateSimulatedSlippage(config, 100, 50000, 0);
        expect(result).toBeGreaterThanOrEqual(5);
      });

      it('should fall back to default ratio when volume is negative', () => {
        const config: SlippageModelConfig = {
          type: SlippageModelType.VOLUME_BASED,
          baseSlippageBps: 5,
          volumeImpactFactor: 100
        };
        const result = calculateSimulatedSlippage(config, 10, 100, -1000);
        expect(result).toBeCloseTo(5.1, 5);
      });
    });

    describe('HISTORICAL model', () => {
      it('should return fixedBps when available', () => {
        const config: SlippageModelConfig = {
          type: SlippageModelType.HISTORICAL,
          fixedBps: 8
        };
        expect(calculateSimulatedSlippage(config, 100, 50000)).toBe(8);
      });

      it('should default to 10 bps when fixedBps not specified', () => {
        const config: SlippageModelConfig = { type: SlippageModelType.HISTORICAL };
        expect(calculateSimulatedSlippage(config, 100, 50000)).toBe(10);
      });
    });

    describe('unknown model type', () => {
      it('should return default 5 bps for unknown model', () => {
        const config = { type: 'unknown' as SlippageModelType };
        expect(calculateSimulatedSlippage(config, 100, 50000)).toBe(5);
      });
    });
  });

  describe('applySlippage', () => {
    const basePrice = 50000;

    describe('BUY orders', () => {
      it('should increase price for buy orders', () => {
        const result = applySlippage(basePrice, 10, true);
        // 10 bps = 0.1% increase = 50000 * 0.001 = 50
        expect(result).toBeCloseTo(50050, 2);
      });

      it('should handle zero slippage', () => {
        const result = applySlippage(basePrice, 0, true);
        expect(result).toBe(basePrice);
      });

      it('should handle large slippage correctly', () => {
        const result = applySlippage(basePrice, 100, true);
        // 100 bps = 1% increase = 50000 * 0.01 = 500
        expect(result).toBeCloseTo(50500, 2);
      });
    });

    describe('SELL orders', () => {
      it('should decrease price for sell orders', () => {
        const result = applySlippage(basePrice, 10, false);
        // 10 bps = 0.1% decrease = 50000 * 0.001 = 50
        expect(result).toBeCloseTo(49950, 2);
      });

      it('should handle zero slippage', () => {
        const result = applySlippage(basePrice, 0, false);
        expect(result).toBe(basePrice);
      });

      it('should handle large slippage correctly', () => {
        const result = applySlippage(basePrice, 100, false);
        // 100 bps = 1% decrease = 50000 * 0.01 = 500
        expect(result).toBeCloseTo(49500, 2);
      });
    });

    it('should be symmetric for buy and sell', () => {
      const slippageBps = 50;
      const buyPrice = applySlippage(basePrice, slippageBps, true);
      const sellPrice = applySlippage(basePrice, slippageBps, false);

      // Buy adds, sell subtracts the same amount (within floating point tolerance)
      expect(buyPrice - basePrice).toBeCloseTo(basePrice - sellPrice, 2);
    });

    it('should handle fractional bps with precision', () => {
      const result = applySlippage(basePrice, 12.5, true);
      expect(result).toBeCloseTo(50062.5, 5);
    });
  });

  describe('buildSlippageConfig', () => {
    it('should build config with all parameters', () => {
      const config = buildSlippageConfig(SlippageModelType.VOLUME_BASED, 10, 7, 150);

      expect(config.type).toBe(SlippageModelType.VOLUME_BASED);
      expect(config.fixedBps).toBe(10);
      expect(config.baseSlippageBps).toBe(7);
      expect(config.volumeImpactFactor).toBe(150);
    });

    it('should use defaults when parameters not provided', () => {
      const config = buildSlippageConfig();

      expect(config.type).toBe(SlippageModelType.FIXED);
      expect(config.fixedBps).toBe(5);
      expect(config.baseSlippageBps).toBe(5);
      expect(config.volumeImpactFactor).toBe(100);
    });

    it('should handle partial parameters', () => {
      const config = buildSlippageConfig(SlippageModelType.FIXED, 20);

      expect(config.type).toBe(SlippageModelType.FIXED);
      expect(config.fixedBps).toBe(20);
      expect(config.baseSlippageBps).toBe(5);
      expect(config.volumeImpactFactor).toBe(100);
    });

    it('should default model when only other values are provided', () => {
      const config = buildSlippageConfig(undefined, 12, undefined, 200);

      expect(config.type).toBe(SlippageModelType.FIXED);
      expect(config.fixedBps).toBe(12);
      expect(config.baseSlippageBps).toBe(5);
      expect(config.volumeImpactFactor).toBe(200);
    });
  });

  describe('DEFAULT_SLIPPAGE_CONFIG', () => {
    it('should have FIXED model with 5 bps', () => {
      expect(DEFAULT_SLIPPAGE_CONFIG.type).toBe(SlippageModelType.FIXED);
      expect(DEFAULT_SLIPPAGE_CONFIG.fixedBps).toBe(5);
    });
  });
});
