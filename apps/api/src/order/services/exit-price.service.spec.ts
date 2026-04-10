import { Test, type TestingModule } from '@nestjs/testing';

import { ExitPriceService } from './exit-price.service';

import { IndicatorService } from '../../algorithm/indicators/indicator.service';
import {
  type CalculatedExitPrices,
  DEFAULT_EXIT_CONFIG,
  DEFAULT_EXIT_PRICE_VALIDATION_LIMITS,
  type ExchangeMarketLimits,
  type ExitConfig,
  ExitPriceValidationErrorCode,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../interfaces/exit-config.interface';

describe('ExitPriceService', () => {
  let service: ExitPriceService;

  const mockIndicatorService = {
    calculateATR: jest.fn()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExitPriceService, { provide: IndicatorService, useValue: mockIndicatorService }]
    }).compile();

    service = module.get<ExitPriceService>(ExitPriceService);

    jest.clearAllMocks();
  });

  describe('calculateExitPrices', () => {
    const entryPrice = 50000;

    describe('Stop Loss - Fixed', () => {
      it('should return the fixed stop loss price for long position', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.FIXED,
          stopLossValue: 48000
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.stopLossPrice).toBe(48000);
      });

      it('should return the fixed stop loss price for short position', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.FIXED,
          stopLossValue: 52000
        };

        const result = service.calculateExitPrices(entryPrice, 'SELL', config);

        expect(result.stopLossPrice).toBe(52000);
      });
    });

    describe('Stop Loss - Percentage', () => {
      it('should calculate percentage stop loss for long position (below entry)', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: 2
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.stopLossPrice).toBe(49000);
      });

      it('should calculate percentage stop loss for short position (above entry)', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: 2
        };

        const result = service.calculateExitPrices(entryPrice, 'SELL', config);

        expect(result.stopLossPrice).toBe(51000);
      });
    });

    describe('Stop Loss - ATR', () => {
      it('should calculate ATR-based stop loss for long position', () => {
        const atr = 1000;
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.ATR,
          stopLossValue: 2
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config, atr);

        expect(result.stopLossPrice).toBe(48000);
      });

      it('should calculate ATR-based stop loss for short position', () => {
        const atr = 1000;
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.ATR,
          stopLossValue: 2
        };

        const result = service.calculateExitPrices(entryPrice, 'SELL', config, atr);

        expect(result.stopLossPrice).toBe(52000);
      });

      it('should fallback to 2% when ATR is not provided', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.ATR,
          stopLossValue: 2
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config, undefined);

        expect(result.stopLossPrice).toBe(49000);
      });
    });

    describe('Stop Loss - Unknown', () => {
      it('should fallback to 2% when stop loss type is unknown', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: 'unknown' as StopLossType,
          stopLossValue: 2
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.stopLossPrice).toBe(49000);
      });
    });

    describe('Take Profit - Fixed', () => {
      it('should return the fixed take profit price', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.FIXED,
          takeProfitValue: 55000
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.takeProfitPrice).toBe(55000);
      });
    });

    describe('Take Profit - Percentage', () => {
      it('should calculate percentage take profit for long position (above entry)', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.PERCENTAGE,
          takeProfitValue: 5
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.takeProfitPrice).toBe(52500);
      });

      it('should calculate percentage take profit for short position (below entry)', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.PERCENTAGE,
          takeProfitValue: 5
        };

        const result = service.calculateExitPrices(entryPrice, 'SELL', config);

        expect(result.takeProfitPrice).toBe(47500);
      });
    });

    describe('Take Profit - Risk:Reward', () => {
      it('should calculate R:R take profit based on stop loss distance for long', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: 2,
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.RISK_REWARD,
          takeProfitValue: 2
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.stopLossPrice).toBe(49000);
        expect(result.takeProfitPrice).toBe(52000);
      });

      it('should calculate R:R take profit for short position', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: 2,
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.RISK_REWARD,
          takeProfitValue: 3
        };

        const result = service.calculateExitPrices(entryPrice, 'SELL', config);

        expect(result.stopLossPrice).toBe(51000);
        expect(result.takeProfitPrice).toBe(47000);
      });

      it('should fallback to 4% when no stop loss for R:R calculation', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: false,
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.RISK_REWARD,
          takeProfitValue: 2
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.takeProfitPrice).toBe(52000);
      });
    });

    describe('Take Profit - Unknown', () => {
      it('should fallback to 4% when take profit type is unknown', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTakeProfit: true,
          takeProfitType: 'unknown' as TakeProfitType,
          takeProfitValue: 5
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.takeProfitPrice).toBe(52000);
      });
    });

    describe('Trailing Stop', () => {
      it('should calculate trailing stop with amount type for long', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.AMOUNT,
          trailingValue: 500,
          trailingActivation: TrailingActivationType.IMMEDIATE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.trailingStopPrice).toBe(49500);
      });

      it('should calculate trailing stop with percentage type for long', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1,
          trailingActivation: TrailingActivationType.IMMEDIATE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.trailingStopPrice).toBe(49500);
      });

      it('should calculate trailing stop for short position', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1,
          trailingActivation: TrailingActivationType.IMMEDIATE
        };

        const result = service.calculateExitPrices(entryPrice, 'SELL', config);

        expect(result.trailingStopPrice).toBe(50500);
      });

      it('should calculate ATR-based trailing stop', () => {
        const atr = 800;
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.ATR,
          trailingValue: 1.5,
          trailingActivation: TrailingActivationType.IMMEDIATE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config, atr);

        expect(result.trailingStopPrice).toBe(48800);
      });

      it('should fallback to 1% trailing stop when ATR is not provided', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.ATR,
          trailingValue: 2,
          trailingActivation: TrailingActivationType.IMMEDIATE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config, undefined);

        expect(result.trailingStopPrice).toBe(49500);
      });

      it('should fallback to 1% trailing stop when trailing type is unknown', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: 'unknown' as TrailingType,
          trailingValue: 2,
          trailingActivation: TrailingActivationType.IMMEDIATE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.trailingStopPrice).toBe(49500);
      });

      it('should calculate trailing activation price for percentage activation', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1,
          trailingActivation: TrailingActivationType.PERCENTAGE,
          trailingActivationValue: 2
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.trailingActivationPrice).toBe(51000);
      });

      it('should calculate trailing activation price for percentage activation on short position', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1,
          trailingActivation: TrailingActivationType.PERCENTAGE,
          trailingActivationValue: 2
        };

        const result = service.calculateExitPrices(entryPrice, 'SELL', config);

        expect(result.trailingActivationPrice).toBe(49000);
      });

      it('should return fixed activation price', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1,
          trailingActivation: TrailingActivationType.PRICE,
          trailingActivationValue: 52000
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.trailingActivationPrice).toBe(52000);
      });

      it('should default activation price to entry when fixed price is not provided', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1,
          trailingActivation: TrailingActivationType.PRICE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.trailingActivationPrice).toBe(50000);
      });

      it('should default activation percentage to 1% when not provided', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1,
          trailingActivation: TrailingActivationType.PERCENTAGE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.trailingActivationPrice).toBe(50500);
      });

      it('should not set activation price when activation is immediate', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1,
          trailingActivation: TrailingActivationType.IMMEDIATE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.trailingActivationPrice).toBeUndefined();
      });
    });
  });

  describe('validateExitPrices', () => {
    const entryPrice = 50000;

    describe('Valid prices', () => {
      it('should return valid for reasonable long position exit prices', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 47500,
          takeProfitPrice: 55000
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should return valid for reasonable short position exit prices', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 52500,
          takeProfitPrice: 45000
        };

        const result = service.validateExitPrices(prices, 'SELL');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('Stop loss on wrong side', () => {
      it('should reject stop loss above entry for long position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 52000
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(1);
        const error = result.errors.find(
          (entry) => entry.exitType === 'stopLoss' && entry.code === ExitPriceValidationErrorCode.WRONG_SIDE
        );
        expect(error).toBeDefined();
        expect(error?.message).toContain('must be below entry price');
      });

      it('should reject stop loss below entry for short position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 48000
        };

        const result = service.validateExitPrices(prices, 'SELL');

        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(1);
        const error = result.errors.find(
          (entry) => entry.exitType === 'stopLoss' && entry.code === ExitPriceValidationErrorCode.WRONG_SIDE
        );
        expect(error).toBeDefined();
        expect(error?.message).toContain('must be above entry price');
      });
    });

    describe('Take profit on wrong side', () => {
      it('should reject take profit below entry for long position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          takeProfitPrice: 48000
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(1);
        const error = result.errors.find(
          (entry) => entry.exitType === 'takeProfit' && entry.code === ExitPriceValidationErrorCode.WRONG_SIDE
        );
        expect(error).toBeDefined();
      });

      it('should reject take profit above entry for short position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          takeProfitPrice: 52000
        };

        const result = service.validateExitPrices(prices, 'SELL');

        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(1);
        const error = result.errors.find(
          (entry) => entry.exitType === 'takeProfit' && entry.code === ExitPriceValidationErrorCode.WRONG_SIDE
        );
        expect(error).toBeDefined();
      });
    });

    describe('Stop loss exceeds max distance (50%)', () => {
      it('should reject stop loss more than 50% below entry for long position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 20000
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(false);
        const error = result.errors.find(
          (entry) => entry.exitType === 'stopLoss' && entry.code === ExitPriceValidationErrorCode.EXCEEDS_MAX_DISTANCE
        );
        expect(error).toBeDefined();
        expect(error?.distancePercentage).toBe(60);
      });

      it('should reject stop loss more than 50% above entry for short position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 80000
        };

        const result = service.validateExitPrices(prices, 'SELL');

        expect(result.isValid).toBe(false);
        const error = result.errors.find(
          (entry) => entry.exitType === 'stopLoss' && entry.code === ExitPriceValidationErrorCode.EXCEEDS_MAX_DISTANCE
        );
        expect(error).toBeDefined();
      });

      it('should accept stop loss at exactly 50%', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 25000
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(true);
      });
    });

    describe('Take profit exceeds max distance (500%)', () => {
      it('should reject take profit more than 500% above entry for long position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          takeProfitPrice: 350000
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(false);
        const error = result.errors.find(
          (entry) => entry.exitType === 'takeProfit' && entry.code === ExitPriceValidationErrorCode.EXCEEDS_MAX_DISTANCE
        );
        expect(error).toBeDefined();
        expect(error?.distancePercentage).toBe(600);
      });
    });

    describe('Prices too close to entry (below minimum 0.1%)', () => {
      it('should reject stop loss less than 0.1% from entry', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 49980
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(false);
        const error = result.errors.find(
          (entry) => entry.exitType === 'stopLoss' && entry.code === ExitPriceValidationErrorCode.BELOW_MIN_DISTANCE
        );
        expect(error).toBeDefined();
      });

      it('should reject take profit less than 0.1% from entry', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          takeProfitPrice: 50020
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(false);
        const error = result.errors.find(
          (entry) => entry.exitType === 'takeProfit' && entry.code === ExitPriceValidationErrorCode.BELOW_MIN_DISTANCE
        );
        expect(error).toBeDefined();
      });
    });

    describe('Invalid prices (zero or negative)', () => {
      it('should reject zero stop loss price', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 0
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(false);
        const error = result.errors.find(
          (entry) => entry.exitType === 'stopLoss' && entry.code === ExitPriceValidationErrorCode.INVALID_PRICE
        );
        expect(error).toBeDefined();
      });

      it('should reject negative take profit price', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          takeProfitPrice: -100
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(false);
        const error = result.errors.find(
          (entry) => entry.exitType === 'takeProfit' && entry.code === ExitPriceValidationErrorCode.INVALID_PRICE
        );
        expect(error).toBeDefined();
      });
    });

    describe('Trailing stop validation', () => {
      it('should validate trailing stop is on correct side for long', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          trailingStopPrice: 52000
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(false);
        const error = result.errors.find(
          (entry) => entry.exitType === 'trailingStop' && entry.code === ExitPriceValidationErrorCode.WRONG_SIDE
        );
        expect(error).toBeDefined();
      });

      it('should accept valid trailing stop for long position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          trailingStopPrice: 49000
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(true);
      });

      it('should reject trailing stop below entry for short position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          trailingStopPrice: 48000
        };

        const result = service.validateExitPrices(prices, 'SELL');

        expect(result.isValid).toBe(false);
        const error = result.errors.find(
          (entry) => entry.exitType === 'trailingStop' && entry.code === ExitPriceValidationErrorCode.WRONG_SIDE
        );
        expect(error).toBeDefined();
      });

      it('should accept valid trailing stop for short position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          trailingStopPrice: 51000
        };

        const result = service.validateExitPrices(prices, 'SELL');

        expect(result.isValid).toBe(true);
      });
    });

    describe('Multiple errors', () => {
      it('should return multiple errors when multiple prices are invalid', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 60000,
          takeProfitPrice: 40000
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(2);
        expect(result.errors.some((e) => e.exitType === 'stopLoss')).toBe(true);
        expect(result.errors.some((e) => e.exitType === 'takeProfit')).toBe(true);
      });
    });

    describe('Custom validation limits', () => {
      it('should respect custom max stop loss percentage', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 40000
        };

        const customLimits = {
          ...DEFAULT_EXIT_PRICE_VALIDATION_LIMITS,
          maxStopLossPercentage: 10
        };

        const result = service.validateExitPrices(prices, 'BUY', customLimits);

        expect(result.isValid).toBe(false);
        const error = result.errors.find(
          (entry) => entry.exitType === 'stopLoss' && entry.code === ExitPriceValidationErrorCode.EXCEEDS_MAX_DISTANCE
        );
        expect(error).toBeDefined();
      });
    });
  });

  describe('validateExitOrderQuantity', () => {
    const mockMarketLimits = {
      minAmount: 0.001,
      maxAmount: 1000,
      amountStep: 1e-8,
      minCost: 10,
      pricePrecision: 2,
      amountPrecision: 8
    };

    it('should accept valid quantity above minimums', () => {
      const result = service.validateExitOrderQuantity(0.5, 50000, mockMarketLimits);

      expect(result.isValid).toBe(true);
      expect(result.adjustedQuantity).toBe(0.5);
      expect(result.actualNotional).toBe(25000);
    });

    it('should reject quantity below minimum amount', () => {
      const result = service.validateExitOrderQuantity(0.0001, 50000, mockMarketLimits);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('below minimum');
      expect(result.minQuantity).toBe(0.001);
    });

    it('should accept quantity at minimum amount and notional thresholds', () => {
      const result = service.validateExitOrderQuantity(0.001, 10000, mockMarketLimits);

      expect(result.isValid).toBe(true);
      expect(result.adjustedQuantity).toBe(0.001);
      expect(result.actualNotional).toBe(10);
    });

    it('should reject quantity below minimum notional value', () => {
      const result = service.validateExitOrderQuantity(0.001, 50, mockMarketLimits);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('below minimum');
      expect(result.minNotional).toBe(10);
    });

    it('should reject after step alignment drops below minimum amount', () => {
      const limits = { ...mockMarketLimits, minAmount: 0.011, amountStep: 0.01, amountPrecision: 2 };
      const result = service.validateExitOrderQuantity(0.011, 50000, limits);

      expect(result.isValid).toBe(false);
      expect(result.adjustedQuantity).toBe(0.01);
      expect(result.minQuantity).toBe(0.011);
    });

    it('should reject after step alignment drops below minimum notional', () => {
      const limits = { ...mockMarketLimits, amountStep: 0.01, amountPrecision: 2 };
      const result = service.validateExitOrderQuantity(0.102, 99, limits);

      expect(result.isValid).toBe(false);
      expect(result.actualNotional).toBeCloseTo(9.9, 5);
      expect(result.minNotional).toBe(10);
    });

    it('should accept quantity when no limits provided', () => {
      const result = service.validateExitOrderQuantity(0.0001, 50000, null);

      expect(result.isValid).toBe(true);
      expect(result.adjustedQuantity).toBe(0.0001);
    });

    it('should align quantity to step size precision', () => {
      const limits = { ...mockMarketLimits, amountStep: 0.001, amountPrecision: 3 };
      const result = service.validateExitOrderQuantity(0.123456789, 50000, limits);

      expect(result.isValid).toBe(true);
      expect(result.adjustedQuantity).toBe(0.123);
    });
    it('should handle fractional crypto quantities without float precision loss', () => {
      const limits: ExchangeMarketLimits = {
        minAmount: 0.00001,
        maxAmount: 1000,
        amountStep: 1e-8,
        minCost: 0,
        pricePrecision: 8,
        amountPrecision: 8
      };
      // 0.1 + 0.2 !== 0.3 in native floats — Decimal.js must prevent this
      const result = service.validateExitOrderQuantity(0.30000000000000004, 1, limits);
      expect(result.isValid).toBe(true);
      expect(result.adjustedQuantity).toBe(0.3);
    });

    it('should floor to TICK_SIZE step on Binance-like markets (precision regression)', () => {
      const limits: ExchangeMarketLimits = {
        minAmount: 0.0001,
        maxAmount: 1000,
        amountStep: 0.001,
        minCost: 0,
        pricePrecision: 2,
        amountPrecision: 3
      };
      const result = service.validateExitOrderQuantity(1.23456, 50000, limits);
      expect(result.isValid).toBe(true);
      expect(result.adjustedQuantity).toBe(1.234);
    });

    it('should calculate notional correctly for micro-cap token prices', () => {
      const limits: ExchangeMarketLimits = {
        minAmount: 1000,
        maxAmount: 100000000,
        amountStep: 0,
        minCost: 0,
        pricePrecision: 8,
        amountPrecision: 0
      };
      const result = service.validateExitOrderQuantity(50000, 0.00000042, limits);
      expect(result.isValid).toBe(true);
      expect(result.actualNotional).toBe(0.021);
    });
  });

  describe('validateExitConfigInputs', () => {
    const makeConfig = (overrides: Partial<ExitConfig>): ExitConfig => ({
      ...DEFAULT_EXIT_CONFIG,
      ...overrides
    });

    const expectInvalid = (overrides: Partial<ExitConfig>, message: RegExp) => {
      expect(() => service.validateExitConfigInputs(makeConfig(overrides))).toThrow(message);
    };

    it('should pass with valid percentage stop loss', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5
      });
      expect(() => service.validateExitConfigInputs(config)).not.toThrow();
    });

    it.each([
      [
        'NaN stop loss value',
        {
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: NaN
        },
        /stopLossValue must be a finite number/
      ],
      [
        'negative stop loss value',
        {
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: -5
        },
        /stopLossValue must be non-negative/
      ],
      [
        'percentage stop loss exceeding 100%',
        {
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: 150
        },
        /stopLossValue exceeds maximum allowed value of 100/
      ],
      [
        'FIXED stop loss exceeding 10 million',
        {
          enableStopLoss: true,
          stopLossType: StopLossType.FIXED,
          stopLossValue: 15_000_000
        },
        /stopLossValue exceeds maximum allowed value of 10000000/
      ],
      [
        'ATR multiplier exceeding 10',
        {
          enableStopLoss: true,
          stopLossType: StopLossType.ATR,
          stopLossValue: 15
        },
        /stopLossValue exceeds maximum allowed value of 10/
      ],
      [
        'percentage take profit exceeding 1000%',
        {
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.PERCENTAGE,
          takeProfitValue: 1500
        },
        /takeProfitValue exceeds maximum allowed value of 1000/
      ],
      [
        'FIXED take profit exceeding 100 million',
        {
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.FIXED,
          takeProfitValue: 150_000_000
        },
        /takeProfitValue exceeds maximum allowed value of 100000000/
      ],
      [
        'percentage trailing value exceeding 100%',
        {
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 150
        },
        /trailingValue exceeds maximum allowed value of 100/
      ],
      [
        'invalid ATR period',
        {
          enableStopLoss: true,
          stopLossType: StopLossType.ATR,
          stopLossValue: 2,
          atrPeriod: 300
        },
        /atrPeriod exceeds maximum allowed value of 200/
      ],
      [
        'invalid trailing activation value for PRICE type',
        {
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1.5,
          trailingActivation: TrailingActivationType.PRICE,
          trailingActivationValue: Infinity
        },
        /trailingActivationValue must be a finite number/
      ]
    ])('should reject %s', (_label, overrides, message) => {
      expectInvalid(overrides, message);
    });

    it('should report multiple invalid fields together', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: NaN,
        enableTrailingStop: true,
        trailingType: TrailingType.PERCENTAGE,
        trailingValue: 150
      });

      expect(() => service.validateExitConfigInputs(config)).toThrow(/stopLossValue must be a finite number/);
      expect(() => service.validateExitConfigInputs(config)).toThrow(
        /trailingValue exceeds maximum allowed value of 100/
      );
    });

    it('should pass with all valid values', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 2,
        enableTakeProfit: true,
        takeProfitType: TakeProfitType.RISK_REWARD,
        takeProfitValue: 3,
        enableTrailingStop: true,
        trailingType: TrailingType.PERCENTAGE,
        trailingValue: 1.5,
        trailingActivation: TrailingActivationType.PERCENTAGE,
        trailingActivationValue: 5
      });

      expect(() => service.validateExitConfigInputs(config)).not.toThrow();
    });

    it('should skip validation for disabled features', () => {
      const config = makeConfig({
        enableStopLoss: false,
        stopLossValue: NaN,
        enableTakeProfit: false,
        takeProfitValue: Infinity,
        enableTrailingStop: false
      });

      expect(() => service.validateExitConfigInputs(config)).not.toThrow();
    });
  });

  describe('calculateCurrentAtr', () => {
    const coinId = 'btc-test';
    const period = 14;

    const makePriceData = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        coin: coinId,
        avg: 105 + i,
        high: 110 + i,
        low: 90 + i,
        open: 100 + i,
        close: 105 + i,
        volume: 1000,
        date: new Date(Date.now() - (count - i) * 3600000)
      }));

    it('should return the most recent ATR value', async () => {
      const priceData = makePriceData(20);
      mockIndicatorService.calculateATR.mockResolvedValue({
        values: [NaN, NaN, 5.2, 4.8, 5.0]
      });

      const result = await service.calculateCurrentAtr(coinId, priceData, period);

      expect(result).toBe(5.0);
      expect(mockIndicatorService.calculateATR).toHaveBeenCalledWith({
        coinId,
        prices: priceData,
        period
      });
    });

    it('should return undefined when price data is insufficient', async () => {
      const priceData = makePriceData(10);

      const result = await service.calculateCurrentAtr(coinId, priceData, period);

      expect(result).toBeUndefined();
      expect(mockIndicatorService.calculateATR).not.toHaveBeenCalled();
    });

    it('should return undefined when all ATR values are NaN', async () => {
      const priceData = makePriceData(20);
      mockIndicatorService.calculateATR.mockResolvedValue({
        values: [NaN, NaN, NaN]
      });

      const result = await service.calculateCurrentAtr(coinId, priceData, period);

      expect(result).toBeUndefined();
    });

    it('should return undefined when ATR calculation throws', async () => {
      const priceData = makePriceData(20);
      mockIndicatorService.calculateATR.mockRejectedValue(new Error('calculation failed'));

      const result = await service.calculateCurrentAtr(coinId, priceData, period);

      expect(result).toBeUndefined();
    });
  });
});
