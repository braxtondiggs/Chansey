import { Test, TestingModule } from '@nestjs/testing';

import { DEFAULT_FEE_CONFIG, FeeConfig, FeeType } from './fee-calculator.interface';
import { FeeCalculatorService } from './fee-calculator.service';

describe('FeeCalculatorService', () => {
  let service: FeeCalculatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FeeCalculatorService]
    }).compile();

    service = module.get<FeeCalculatorService>(FeeCalculatorService);
  });

  describe('calculateFee', () => {
    describe('FLAT fee type', () => {
      it('should calculate fee with default flat rate', () => {
        const result = service.calculateFee({ tradeValue: 10000 });

        // Default 0.1% = 10
        expect(result.fee).toBe(10);
        expect(result.rate).toBe(0.001);
        expect(result.orderType).toBeUndefined();
      });

      it('should calculate fee with custom flat rate', () => {
        const config: FeeConfig = {
          type: FeeType.FLAT,
          flatRate: 0.002 // 0.2%
        };

        const result = service.calculateFee({ tradeValue: 10000 }, config);

        expect(result.fee).toBe(20);
        expect(result.rate).toBe(0.002);
      });

      it('should handle zero trade value', () => {
        const result = service.calculateFee({ tradeValue: 0 });

        expect(result.fee).toBe(0);
      });

      it('should handle very small trade values', () => {
        const result = service.calculateFee({ tradeValue: 1 });

        expect(result.fee).toBe(0.001);
      });

      it('should handle large trade values', () => {
        const result = service.calculateFee({ tradeValue: 1000000 });

        expect(result.fee).toBe(1000);
      });

      it('should throw error for negative trade value', () => {
        expect(() => service.calculateFee({ tradeValue: -1000 })).toThrow('Trade value cannot be negative');
      });

      it('should ignore isMaker flag for flat rate', () => {
        const result1 = service.calculateFee({ tradeValue: 10000, isMaker: true });
        const result2 = service.calculateFee({ tradeValue: 10000, isMaker: false });

        expect(result1.fee).toBe(result2.fee);
        expect(result1.orderType).toBeUndefined();
        expect(result2.orderType).toBeUndefined();
      });
    });

    describe('MAKER_TAKER fee type', () => {
      const makerTakerConfig: FeeConfig = {
        type: FeeType.MAKER_TAKER,
        makerRate: 0.0005, // 0.05%
        takerRate: 0.001 // 0.1%
      };

      it('should calculate maker fee', () => {
        const result = service.calculateFee({ tradeValue: 10000, isMaker: true }, makerTakerConfig);

        expect(result.fee).toBe(5);
        expect(result.rate).toBe(0.0005);
        expect(result.orderType).toBe('maker');
      });

      it('should calculate taker fee', () => {
        const result = service.calculateFee({ tradeValue: 10000, isMaker: false }, makerTakerConfig);

        expect(result.fee).toBe(10);
        expect(result.rate).toBe(0.001);
        expect(result.orderType).toBe('taker');
      });

      it('should default to taker when isMaker not specified', () => {
        const result = service.calculateFee({ tradeValue: 10000 }, makerTakerConfig);

        expect(result.rate).toBe(0.001);
        expect(result.orderType).toBe('taker');
      });

      it('should use default rates when not specified', () => {
        const config: FeeConfig = { type: FeeType.MAKER_TAKER };

        const makerResult = service.calculateFee({ tradeValue: 10000, isMaker: true }, config);
        const takerResult = service.calculateFee({ tradeValue: 10000, isMaker: false }, config);

        // Default maker: 0.05%, taker: 0.1%
        expect(makerResult.rate).toBe(0.0005);
        expect(takerResult.rate).toBe(0.001);
      });
    });
  });

  describe('getRate', () => {
    it('should return flat rate for FLAT type', () => {
      const config: FeeConfig = { type: FeeType.FLAT, flatRate: 0.002 };

      expect(service.getRate(config)).toBe(0.002);
      expect(service.getRate(config, true)).toBe(0.002);
      expect(service.getRate(config, false)).toBe(0.002);
    });

    it('should return default flat rate when flatRate is missing', () => {
      const config: FeeConfig = { type: FeeType.FLAT };

      expect(service.getRate(config)).toBe(0.001);
    });

    it('should return maker rate for MAKER_TAKER when isMaker is true', () => {
      const config: FeeConfig = {
        type: FeeType.MAKER_TAKER,
        makerRate: 0.0003,
        takerRate: 0.0008
      };

      expect(service.getRate(config, true)).toBe(0.0003);
    });

    it('should return taker rate for MAKER_TAKER when isMaker is false', () => {
      const config: FeeConfig = {
        type: FeeType.MAKER_TAKER,
        makerRate: 0.0003,
        takerRate: 0.0008
      };

      expect(service.getRate(config, false)).toBe(0.0008);
    });

    it('should return taker rate when isMaker is undefined', () => {
      const config: FeeConfig = {
        type: FeeType.MAKER_TAKER,
        makerRate: 0.0003,
        takerRate: 0.0008
      };

      expect(service.getRate(config)).toBe(0.0008);
    });

    it('should return default maker/taker rates when missing', () => {
      const config: FeeConfig = { type: FeeType.MAKER_TAKER };

      expect(service.getRate(config, true)).toBe(0.0005);
      expect(service.getRate(config, false)).toBe(0.001);
    });

    it('should return default rate for unknown type', () => {
      const config = { type: 'unknown' as FeeType };

      expect(service.getRate(config)).toBe(0.001);
    });
  });

  describe('buildConfig', () => {
    it('should build config with all parameters', () => {
      const config = service.buildConfig({
        type: FeeType.MAKER_TAKER,
        flatRate: 0.002,
        makerRate: 0.0004,
        takerRate: 0.0008
      });

      expect(config.type).toBe(FeeType.MAKER_TAKER);
      expect(config.flatRate).toBe(0.002);
      expect(config.makerRate).toBe(0.0004);
      expect(config.takerRate).toBe(0.0008);
    });

    it('should use defaults when not specified', () => {
      const config = service.buildConfig();

      expect(config.type).toBe(FeeType.FLAT);
      expect(config.flatRate).toBe(0.001);
      expect(config.makerRate).toBe(0.0005);
      expect(config.takerRate).toBe(0.001);
    });

    it('should handle partial parameters', () => {
      const config = service.buildConfig({
        type: FeeType.MAKER_TAKER,
        makerRate: 0.0002
      });

      expect(config.type).toBe(FeeType.MAKER_TAKER);
      expect(config.makerRate).toBe(0.0002);
      expect(config.takerRate).toBe(0.001); // default
    });
  });

  describe('maker/taker defaults', () => {
    it('uses default maker rate when missing', () => {
      const config: FeeConfig = { type: FeeType.MAKER_TAKER, takerRate: 0.002 };

      const result = service.calculateFee({ tradeValue: 10000, isMaker: true }, config);

      expect(result.rate).toBe(0.0005);
      expect(result.orderType).toBe('maker');
      expect(result.fee).toBe(5);
    });

    it('uses default taker rate when missing', () => {
      const config: FeeConfig = { type: FeeType.MAKER_TAKER, makerRate: 0.0002 };

      const result = service.calculateFee({ tradeValue: 10000, isMaker: false }, config);

      expect(result.rate).toBe(0.001);
      expect(result.orderType).toBe('taker');
      expect(result.fee).toBe(10);
    });
  });

  describe('fromFlatRate', () => {
    it('should create FLAT config from rate', () => {
      const config = service.fromFlatRate(0.0015);

      expect(config.type).toBe(FeeType.FLAT);
      expect(config.flatRate).toBe(0.0015);
    });

    it('should handle typical exchange rates', () => {
      // Binance default spot rate
      const config = service.fromFlatRate(0.001);

      expect(config.flatRate).toBe(0.001);
    });

    it('should handle zero fee rate', () => {
      const config = service.fromFlatRate(0);

      expect(config.flatRate).toBe(0);
    });

    it('should throw error for negative rate', () => {
      expect(() => service.fromFlatRate(-0.001)).toThrow('Fee rate must be a non-negative finite number');
    });

    it('should throw error for NaN rate', () => {
      expect(() => service.fromFlatRate(NaN)).toThrow('Fee rate must be a non-negative finite number');
    });

    it('should throw error for Infinity rate', () => {
      expect(() => service.fromFlatRate(Infinity)).toThrow('Fee rate must be a non-negative finite number');
    });
  });

  describe('DEFAULT_FEE_CONFIG', () => {
    it('should be FLAT type with 0.1% rate', () => {
      expect(DEFAULT_FEE_CONFIG.type).toBe(FeeType.FLAT);
      expect(DEFAULT_FEE_CONFIG.flatRate).toBe(0.001);
    });
  });

  describe('edge cases', () => {
    it('should handle precision for very small fees', () => {
      const config: FeeConfig = {
        type: FeeType.FLAT,
        flatRate: 0.0001 // 1 basis point
      };

      const result = service.calculateFee({ tradeValue: 100 }, config);

      expect(result.fee).toBeCloseTo(0.01, 10);
    });

    it('should handle precision for very large trades', () => {
      const result = service.calculateFee({ tradeValue: 1_000_000_000 });

      expect(result.fee).toBe(1_000_000);
    });

    it('should match backtest tradingFee parameter usage', () => {
      // The backtest uses tradingFee as a decimal rate directly
      // e.g., tradingFee: 0.001 means 0.1%
      const tradingFee = 0.001;
      const tradeValue = 50000;

      const config = service.fromFlatRate(tradingFee);
      const result = service.calculateFee({ tradeValue }, config);

      // Expected: 50000 * 0.001 = 50
      expect(result.fee).toBe(50);
    });
  });
});
