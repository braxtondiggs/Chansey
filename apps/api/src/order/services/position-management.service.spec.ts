import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { PositionManagementService } from './position-management.service';

import { IndicatorService } from '../../algorithm/indicators/indicator.service';
import { CoinService } from '../../coin/coin.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { User } from '../../users/users.entity';
import { PositionExit } from '../entities/position-exit.entity';
import {
  CalculatedExitPrices,
  DEFAULT_EXIT_CONFIG,
  DEFAULT_EXIT_PRICE_VALIDATION_LIMITS,
  ExitConfig,
  ExitPriceValidationErrorCode,
  PositionExitStatus,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../interfaces/exit-config.interface';
import { Order, OrderStatus } from '../order.entity';

describe('PositionManagementService', () => {
  let service: PositionManagementService;
  let positionExitRepo: Repository<PositionExit>;
  let orderRepo: Repository<Order>;
  let userRepo: Repository<User>;

  const mockPositionExitRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn()
  };

  const mockOrderRepo = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn()
  };

  const mockUserRepo = {
    findOneBy: jest.fn()
  };

  const mockExchangeKeyService = {
    findOne: jest.fn()
  };

  const mockExchangeManagerService = {
    getExchangeClient: jest.fn()
  };

  const mockCoinService = {
    getMultipleCoinsBySymbol: jest.fn()
  };

  const mockIndicatorService = {
    calculateATR: jest.fn()
  };

  const mockDataSource = {
    createQueryRunner: jest.fn()
  };

  const mockCircuitBreakerService = {
    checkCircuit: jest.fn(), // Does not throw by default (circuit closed)
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    isOpen: jest.fn().mockReturnValue(false),
    getState: jest.fn().mockReturnValue('closed'),
    reset: jest.fn()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionManagementService,
        { provide: getRepositoryToken(PositionExit), useValue: mockPositionExitRepo },
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: ExchangeKeyService, useValue: mockExchangeKeyService },
        { provide: ExchangeManagerService, useValue: mockExchangeManagerService },
        { provide: CoinService, useValue: mockCoinService },
        { provide: IndicatorService, useValue: mockIndicatorService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: CircuitBreakerService, useValue: mockCircuitBreakerService }
      ]
    }).compile();

    service = module.get<PositionManagementService>(PositionManagementService);
    positionExitRepo = module.get(getRepositoryToken(PositionExit));
    orderRepo = module.get(getRepositoryToken(Order));
    userRepo = module.get(getRepositoryToken(User));

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
          stopLossValue: 2 // 2%
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        // 50000 - (50000 * 0.02) = 49000
        expect(result.stopLossPrice).toBe(49000);
      });

      it('should calculate percentage stop loss for short position (above entry)', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: 2 // 2%
        };

        const result = service.calculateExitPrices(entryPrice, 'SELL', config);

        // 50000 + (50000 * 0.02) = 51000
        expect(result.stopLossPrice).toBe(51000);
      });

      it('should handle larger percentage values', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: 10 // 10%
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        // 50000 - (50000 * 0.10) = 45000
        expect(result.stopLossPrice).toBe(45000);
      });
    });

    describe('Stop Loss - ATR', () => {
      it('should calculate ATR-based stop loss for long position', () => {
        const atr = 1000; // $1000 ATR
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.ATR,
          stopLossValue: 2 // 2x ATR
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config, atr);

        // 50000 - (1000 * 2) = 48000
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

        // 50000 + (1000 * 2) = 52000
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

        // Fallback to 2%: 50000 - (50000 * 0.02) = 49000
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

        // Default 2%: 50000 - (50000 * 0.02) = 49000
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
          takeProfitValue: 5 // 5%
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        // 50000 + (50000 * 0.05) = 52500
        expect(result.takeProfitPrice).toBe(52500);
      });

      it('should calculate percentage take profit for short position (below entry)', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.PERCENTAGE,
          takeProfitValue: 5 // 5%
        };

        const result = service.calculateExitPrices(entryPrice, 'SELL', config);

        // 50000 - (50000 * 0.05) = 47500
        expect(result.takeProfitPrice).toBe(47500);
      });
    });

    describe('Take Profit - Risk:Reward', () => {
      it('should calculate R:R take profit based on stop loss distance for long', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: 2, // 2% SL
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.RISK_REWARD,
          takeProfitValue: 2 // 2:1 R:R
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        // SL: 50000 - 1000 = 49000, risk = 1000
        // TP: 50000 + (1000 * 2) = 52000
        expect(result.stopLossPrice).toBe(49000);
        expect(result.takeProfitPrice).toBe(52000);
      });

      it('should calculate R:R take profit for short position', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: 2, // 2% SL
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.RISK_REWARD,
          takeProfitValue: 3 // 3:1 R:R
        };

        const result = service.calculateExitPrices(entryPrice, 'SELL', config);

        // SL: 50000 + 1000 = 51000, risk = 1000
        // TP: 50000 - (1000 * 3) = 47000
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

        // Fallback: 50000 + (50000 * 0.04) = 52000
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

        // Default 4%: 50000 + (50000 * 0.04) = 52000
        expect(result.takeProfitPrice).toBe(52000);
      });
    });

    describe('Trailing Stop', () => {
      it('should calculate trailing stop with amount type for long', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.AMOUNT,
          trailingValue: 500, // $500 trailing
          trailingActivation: TrailingActivationType.IMMEDIATE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        // 50000 - 500 = 49500
        expect(result.trailingStopPrice).toBe(49500);
      });

      it('should calculate trailing stop with percentage type for long', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1, // 1% trailing
          trailingActivation: TrailingActivationType.IMMEDIATE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        // 50000 - (50000 * 0.01) = 49500
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

        // 50000 + (50000 * 0.01) = 50500
        expect(result.trailingStopPrice).toBe(50500);
      });

      it('should calculate ATR-based trailing stop', () => {
        const atr = 800;
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.ATR,
          trailingValue: 1.5, // 1.5x ATR
          trailingActivation: TrailingActivationType.IMMEDIATE
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config, atr);

        // 50000 - (800 * 1.5) = 48800
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

        // Fallback to 1%: 50000 - (50000 * 0.01) = 49500
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

        // Default 1%: 50000 - (50000 * 0.01) = 49500
        expect(result.trailingStopPrice).toBe(49500);
      });

      it('should calculate trailing activation price for percentage activation', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableTrailingStop: true,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 1,
          trailingActivation: TrailingActivationType.PERCENTAGE,
          trailingActivationValue: 2 // Activate after 2% gain
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        // Activation: 50000 + (50000 * 0.02) = 51000
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

        // Activation: 50000 - (50000 * 0.02) = 49000
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

        // Activation: 50000 + (50000 * 0.01) = 50500
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

    describe('Combined SL/TP', () => {
      it('should calculate both SL and TP together', () => {
        const config: ExitConfig = {
          ...DEFAULT_EXIT_CONFIG,
          enableStopLoss: true,
          stopLossType: StopLossType.PERCENTAGE,
          stopLossValue: 2,
          enableTakeProfit: true,
          takeProfitType: TakeProfitType.PERCENTAGE,
          takeProfitValue: 4
        };

        const result = service.calculateExitPrices(entryPrice, 'BUY', config);

        expect(result.entryPrice).toBe(50000);
        expect(result.stopLossPrice).toBe(49000); // 50000 - 2%
        expect(result.takeProfitPrice).toBe(52000); // 50000 + 4%
      });
    });
  });

  describe('validateExitPrices', () => {
    const entryPrice = 50000;

    describe('Valid prices', () => {
      it('should return valid for reasonable long position exit prices', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 47500, // 5% below - valid
          takeProfitPrice: 55000 // 10% above - valid
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should return valid for reasonable short position exit prices', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 52500, // 5% above - valid for short
          takeProfitPrice: 45000 // 10% below - valid for short
        };

        const result = service.validateExitPrices(prices, 'SELL');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should return valid when only stop loss is provided', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 47500
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('Stop loss on wrong side', () => {
      it('should reject stop loss above entry for long position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 52000 // Above entry - wrong for long
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
          stopLossPrice: 48000 // Below entry - wrong for short
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
          takeProfitPrice: 48000 // Below entry - wrong for long
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
          takeProfitPrice: 52000 // Above entry - wrong for short
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
          stopLossPrice: 20000 // 60% below entry - exceeds 50% max
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
          stopLossPrice: 80000 // 60% above entry - exceeds 50% max
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
          stopLossPrice: 25000 // Exactly 50% below
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(true);
      });
    });

    describe('Take profit exceeds max distance (500%)', () => {
      it('should reject take profit more than 500% above entry for long position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          takeProfitPrice: 350000 // 600% above entry - exceeds 500% max
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
          stopLossPrice: 49980 // 0.04% below - too close
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
          takeProfitPrice: 50020 // 0.04% above - too close
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
          trailingStopPrice: 52000 // Above entry - wrong for long
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
          trailingStopPrice: 49000 // 2% below - valid
        };

        const result = service.validateExitPrices(prices, 'BUY');

        expect(result.isValid).toBe(true);
      });

      it('should reject trailing stop below entry for short position', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          trailingStopPrice: 48000 // Below entry - wrong for short
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
          trailingStopPrice: 51000 // 2% above - valid
        };

        const result = service.validateExitPrices(prices, 'SELL');

        expect(result.isValid).toBe(true);
      });
    });

    describe('Multiple errors', () => {
      it('should return multiple errors when multiple prices are invalid', () => {
        const prices: CalculatedExitPrices = {
          entryPrice,
          stopLossPrice: 60000, // Wrong side for long
          takeProfitPrice: 40000 // Wrong side for long
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
          stopLossPrice: 40000 // 20% below
        };

        const customLimits = {
          ...DEFAULT_EXIT_PRICE_VALIDATION_LIMITS,
          maxStopLossPercentage: 10 // Only allow 10%
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

  describe('checkExchangeOcoSupport', () => {
    it('should return native OCO support for Binance', () => {
      const result = service.checkExchangeOcoSupport('binance_us');

      expect(result.native).toBe(true);
      expect(result.simulated).toBe(true);
    });

    it('should return simulated only for Coinbase', () => {
      const result = service.checkExchangeOcoSupport('coinbase');

      expect(result.native).toBe(false);
      expect(result.simulated).toBe(true);
    });

    it('should return simulated for unknown exchanges', () => {
      const result = service.checkExchangeOcoSupport('unknown_exchange');

      expect(result.native).toBe(false);
      expect(result.simulated).toBe(true);
    });
  });

  describe('handleOcoFill', () => {
    const mockUser = { id: 'user-123' } as User;
    const mockPositionExit = {
      id: 'pe-123',
      ocoLinked: true,
      stopLossOrderId: 'sl-order-123',
      takeProfitOrderId: 'tp-order-123',
      user: mockUser,
      entryPrice: 50000,
      quantity: 1,
      side: 'BUY' as const,
      status: PositionExitStatus.ACTIVE
    };

    beforeEach(() => {
      mockPositionExitRepo.findOne.mockResolvedValue(mockPositionExit);
      mockPositionExitRepo.save.mockResolvedValue(mockPositionExit);
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'sl-order-123',
        status: OrderStatus.FILLED,
        averagePrice: 49000
      });
      mockOrderRepo.findOneBy.mockResolvedValue({
        id: 'sl-order-123',
        status: OrderStatus.FILLED,
        averagePrice: 49000
      });
      mockOrderRepo.save.mockResolvedValue({});
    });

    it('should not process if position exit not found', async () => {
      mockPositionExitRepo.findOne.mockResolvedValue(null);

      await service.handleOcoFill('unknown-order-id');

      expect(mockPositionExitRepo.save).not.toHaveBeenCalled();
    });

    it('should not process if OCO not linked', async () => {
      mockPositionExitRepo.findOne.mockResolvedValue({
        ...mockPositionExit,
        ocoLinked: false
      });

      await service.handleOcoFill('sl-order-123');

      expect(mockPositionExitRepo.save).not.toHaveBeenCalled();
    });

    it('should update status to SL triggered when stop loss fills', async () => {
      const cancelOrderSpy = jest.spyOn(service as any, 'cancelOrderById').mockResolvedValue(undefined);

      await service.handleOcoFill('sl-order-123');

      expect(cancelOrderSpy).toHaveBeenCalledWith('tp-order-123', mockUser);
      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PositionExitStatus.STOP_LOSS_TRIGGERED
        })
      );
    });

    it('should update status to TP triggered when take profit fills', async () => {
      const cancelOrderSpy = jest.spyOn(service as any, 'cancelOrderById').mockResolvedValue(undefined);

      await service.handleOcoFill('tp-order-123');

      expect(cancelOrderSpy).toHaveBeenCalledWith('sl-order-123', mockUser);
      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PositionExitStatus.TAKE_PROFIT_TRIGGERED
        })
      );
    });

    it('should set exit price and realized PnL from filled order average price', async () => {
      const cancelOrderSpy = jest.spyOn(service as any, 'cancelOrderById').mockResolvedValue(undefined);

      await service.handleOcoFill('sl-order-123');

      expect(cancelOrderSpy).toHaveBeenCalledWith('tp-order-123', mockUser);
      expect(mockOrderRepo.findOneBy).toHaveBeenCalledWith({ id: 'sl-order-123' });
      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          exitPrice: 49000,
          realizedPnL: -1000
        })
      );
    });
  });

  describe('getActiveTrailingStops', () => {
    it('should query for active positions with trailing stops enabled', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };

      mockPositionExitRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.getActiveTrailingStops();

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('pe.status = :status', {
        status: PositionExitStatus.ACTIVE
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith("pe.exitConfig->>'enableTrailingStop' = :enabled", {
        enabled: 'true'
      });
    });
  });

  describe('updateTrailingStopPrice', () => {
    it('should update trailing stop price and high water mark', async () => {
      const positionExitId = 'pe-123';
      const newStopPrice = 51000;
      const highWaterMark = 52000;

      await service.updateTrailingStopPrice(positionExitId, newStopPrice, highWaterMark);

      expect(mockPositionExitRepo.update).toHaveBeenCalledWith(positionExitId, {
        currentTrailingStopPrice: newStopPrice,
        trailingHighWaterMark: highWaterMark,
        trailingActivated: true
      });
    });
  });

  describe('validateExitOrderQuantity', () => {
    const mockMarketLimits = {
      minAmount: 0.001,
      maxAmount: 1000,
      amountStep: 8,
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
      const limits = { ...mockMarketLimits, minAmount: 0.011, amountStep: 2, amountPrecision: 2 };
      const result = service.validateExitOrderQuantity(0.011, 50000, limits);

      expect(result.isValid).toBe(false);
      expect(result.adjustedQuantity).toBe(0.01);
      expect(result.minQuantity).toBe(0.011);
    });

    it('should reject after step alignment drops below minimum notional', () => {
      const limits = { ...mockMarketLimits, amountStep: 2, amountPrecision: 2 };
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
      const limits = { ...mockMarketLimits, amountStep: 3, amountPrecision: 3 };
      const result = service.validateExitOrderQuantity(0.123456789, 50000, limits);

      expect(result.isValid).toBe(true);
      expect(result.adjustedQuantity).toBe(0.123);
    });

    it('should calculate correct notional value', () => {
      const result = service.validateExitOrderQuantity(2, 100, mockMarketLimits);

      expect(result.actualNotional).toBe(200);
    });
  });
});
