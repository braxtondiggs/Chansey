import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { PositionManagementService } from './position-management.service';

import { IndicatorService } from '../../algorithm/indicators/indicator.service';
import { CoinService } from '../../coin/coin.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { User } from '../../users/users.entity';
import { PositionExit } from '../entities/position-exit.entity';
import {
  DEFAULT_EXIT_CONFIG,
  ExitConfig,
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
        { provide: DataSource, useValue: mockDataSource }
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
});
