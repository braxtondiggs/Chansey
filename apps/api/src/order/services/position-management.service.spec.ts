import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource, type Repository } from 'typeorm';

import { ExitOrderPlacementService } from './exit-order-placement.service';
import { ExitPriceService } from './exit-price.service';
import { PositionManagementService } from './position-management.service';

import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { type User } from '../../users/users.entity';
import { PositionExit } from '../entities/position-exit.entity';
import { PositionExitStatus, StopLossType, TrailingActivationType } from '../interfaces/exit-config.interface';
import { Order, OrderStatus } from '../order.entity';

describe('PositionManagementService', () => {
  let service: PositionManagementService;
  let _positionExitRepo: Repository<PositionExit>;
  let _orderRepo: Repository<Order>;

  const mockPositionExitRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    create: jest.fn()
  };

  const mockOrderRepo = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn()
  };

  const mockExchangeKeyService = {
    findOne: jest.fn()
  };

  const mockExitPriceService = {
    calculateExitPrices: jest.fn(),
    validateExitPrices: jest.fn(),
    validateExitOrderQuantity: jest.fn(),
    validateExitConfigInputs: jest.fn(),
    calculateCurrentAtr: jest.fn()
  };

  const mockExitOrderPlacementService = {
    executeWithResilience: jest.fn(),
    getExchangeClient: jest.fn(),
    getMarketLimits: jest.fn(),
    checkExchangeOcoSupport: jest.fn(),
    placeStopLossOrder: jest.fn(),
    placeTakeProfitOrder: jest.fn(),
    linkOcoOrdersNative: jest.fn(),
    cancelOrderById: jest.fn()
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'pe-new', ...data }))
    }
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner)
  };

  const mockUser = { id: 'user-123' } as User;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionManagementService,
        { provide: getRepositoryToken(PositionExit), useValue: mockPositionExitRepo },
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: ExchangeKeyService, useValue: mockExchangeKeyService },
        { provide: ExitPriceService, useValue: mockExitPriceService },
        { provide: ExitOrderPlacementService, useValue: mockExitOrderPlacementService },
        { provide: DataSource, useValue: mockDataSource }
      ]
    }).compile();

    service = module.get<PositionManagementService>(PositionManagementService);
    _positionExitRepo = module.get(getRepositoryToken(PositionExit));
    _orderRepo = module.get(getRepositoryToken(Order));

    jest.clearAllMocks();
    mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
  });

  describe('attachExitOrders', () => {
    const baseEntryOrder = {
      id: 'order-1',
      symbol: 'BTC/USD',
      side: 'BUY',
      averagePrice: 50000,
      price: 50000,
      quantity: 1,
      executedQuantity: 1,
      user: mockUser,
      exchangeKeyId: null,
      algorithmActivationId: 'activation-1',
      strategyConfigId: 'strategy-1',
      baseCoin: { id: 'btc-id' }
    } as unknown as Order;

    const validExitConfig = {
      enableStopLoss: true,
      stopLossType: StopLossType.PERCENTAGE,
      stopLossValue: 2
    };

    beforeEach(() => {
      mockExitPriceService.validateExitConfigInputs.mockReturnValue(undefined);
      mockExitPriceService.calculateExitPrices.mockReturnValue({
        entryPrice: 50000,
        stopLossPrice: 49000
      });
      mockExitPriceService.validateExitPrices.mockReturnValue({ isValid: true, errors: [] });
      mockExitPriceService.validateExitOrderQuantity.mockReturnValue({
        isValid: true,
        originalQuantity: 1,
        adjustedQuantity: 1,
        minQuantity: 0,
        minNotional: 0,
        actualNotional: 49000
      });
      mockExitOrderPlacementService.placeStopLossOrder.mockResolvedValue({ id: 'sl-order-1' } as Order);
    });

    it('should throw when no exit type is enabled', async () => {
      const config = { enableStopLoss: false, enableTakeProfit: false, enableTrailingStop: false };

      await expect(service.attachExitOrders(baseEntryOrder, config)).rejects.toThrow(
        'At least one exit type must be enabled'
      );
    });

    it('should throw when entry price is zero or negative', async () => {
      const order = { ...baseEntryOrder, averagePrice: 0, price: 0 } as unknown as Order;

      await expect(service.attachExitOrders(order, validExitConfig)).rejects.toThrow(
        'Entry order must have a valid price'
      );
    });

    it('should throw when user is not loaded on entry order', async () => {
      const order = { ...baseEntryOrder, user: null } as unknown as Order;

      await expect(service.attachExitOrders(order, validExitConfig)).rejects.toThrow('User not found for entry order');
    });

    it('should throw when exit price validation fails', async () => {
      mockExitPriceService.validateExitPrices.mockReturnValue({
        isValid: false,
        errors: [{ message: 'SL on wrong side' }]
      });

      await expect(service.attachExitOrders(baseEntryOrder, validExitConfig)).rejects.toThrow(
        'Invalid exit prices: SL on wrong side'
      );
    });

    it('should create position exit and return result on success', async () => {
      const result = await service.attachExitOrders(baseEntryOrder, validExitConfig);

      expect(result.stopLossOrderId).toBe('sl-order-1');
      expect(result.calculatedPrices).toEqual({ entryPrice: 50000, stopLossPrice: 49000 });
      expect(result.ocoLinked).toBe(false);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should rollback transaction and release query runner on error', async () => {
      mockExitOrderPlacementService.placeStopLossOrder.mockRejectedValue(new Error('exchange down'));

      const result = await service.attachExitOrders(baseEntryOrder, validExitConfig);

      // SL placement error is caught — returns with warning, not thrown
      expect(result.warnings).toContainEqual(expect.stringContaining('Stop loss placement failed'));
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should fall back to percentage stops when ATR calculation returns NaN', async () => {
      const atrConfig = {
        enableStopLoss: true,
        stopLossType: StopLossType.ATR,
        stopLossValue: 2
      };
      mockExitPriceService.calculateCurrentAtr.mockResolvedValue(NaN);

      const result = await service.attachExitOrders(baseEntryOrder, atrConfig, [
        { open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 } as never
      ]);

      expect(result.warnings).toContainEqual(expect.stringContaining('ATR calculation failed'));
    });

    it('should set trailingActivated when activation is IMMEDIATE', async () => {
      const trailingConfig = {
        enableStopLoss: false,
        enableTakeProfit: false,
        enableTrailingStop: true,
        trailingActivation: TrailingActivationType.IMMEDIATE
      };
      mockExitPriceService.calculateExitPrices.mockReturnValue({
        entryPrice: 50000,
        trailingStopPrice: 49500
      });

      await service.attachExitOrders(baseEntryOrder, trailingConfig);

      const createCall = mockQueryRunner.manager.create.mock.calls[0][1];
      expect(createCall.trailingActivated).toBe(true);
    });
  });

  describe('handleOcoFill', () => {
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
      mockOrderRepo.findOneBy.mockResolvedValue({
        id: 'sl-order-123',
        status: OrderStatus.FILLED,
        averagePrice: 49000
      });
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

    it('should cancel TP and set SL status when stop loss fills', async () => {
      await service.handleOcoFill('sl-order-123');

      expect(mockExitOrderPlacementService.cancelOrderById).toHaveBeenCalledWith('tp-order-123', mockUser);
      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PositionExitStatus.STOP_LOSS_TRIGGERED
        })
      );
    });

    it('should cancel SL and set TP status when take profit fills', async () => {
      await service.handleOcoFill('tp-order-123');

      expect(mockExitOrderPlacementService.cancelOrderById).toHaveBeenCalledWith('sl-order-123', mockUser);
      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PositionExitStatus.TAKE_PROFIT_TRIGGERED
        })
      );
    });

    it('should compute negative PnL for BUY when SL fills below entry', async () => {
      await service.handleOcoFill('sl-order-123');

      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          exitPrice: 49000,
          realizedPnL: -1000 // (49000 - 50000) * 1
        })
      );
    });

    it('should compute positive PnL for SELL side when exit is below entry', async () => {
      mockPositionExitRepo.findOne.mockResolvedValue({
        ...mockPositionExit,
        side: 'SELL' as const,
        entryPrice: 50000
      });
      mockOrderRepo.findOneBy.mockResolvedValue({
        id: 'sl-order-123',
        averagePrice: 49000
      });

      await service.handleOcoFill('sl-order-123');

      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          realizedPnL: 1000 // (50000 - 49000) * 1
        })
      );
    });

    it('should fall back to order.price when averagePrice is null', async () => {
      mockOrderRepo.findOneBy.mockResolvedValue({
        id: 'sl-order-123',
        averagePrice: null,
        price: 48500
      });

      await service.handleOcoFill('sl-order-123');

      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          exitPrice: 48500,
          realizedPnL: -1500 // (48500 - 50000) * 1
        })
      );
    });

    it('should still save status when filled order is not found in DB', async () => {
      const freshExit = { ...mockPositionExit, exitPrice: undefined, realizedPnL: undefined };
      mockPositionExitRepo.findOne.mockResolvedValue(freshExit);
      mockOrderRepo.findOneBy.mockResolvedValue(null);

      await service.handleOcoFill('sl-order-123');

      const savedArg = mockPositionExitRepo.save.mock.calls[0][0];
      expect(savedArg.status).toBe(PositionExitStatus.STOP_LOSS_TRIGGERED);
      expect(savedArg.exitPrice).toBeUndefined();
      expect(savedArg.realizedPnL).toBeUndefined();
    });

    it('should not cancel other order when other order ID is null', async () => {
      mockPositionExitRepo.findOne.mockResolvedValue({
        ...mockPositionExit,
        takeProfitOrderId: null
      });

      await service.handleOcoFill('sl-order-123');

      expect(mockExitOrderPlacementService.cancelOrderById).not.toHaveBeenCalled();
    });
  });

  describe('cancelExitOrders', () => {
    it('should cancel SL, TP, and trailing orders then set CANCELLED status', async () => {
      const mockPositionExit = {
        id: 'pe-123',
        userId: 'user-123',
        stopLossOrderId: 'sl-123',
        takeProfitOrderId: 'tp-123',
        trailingStopOrderId: 'ts-123',
        status: PositionExitStatus.ACTIVE
      };
      mockPositionExitRepo.findOne.mockResolvedValue(mockPositionExit);
      mockPositionExitRepo.save.mockResolvedValue(mockPositionExit);

      await service.cancelExitOrders('pe-123', mockUser);

      expect(mockExitOrderPlacementService.cancelOrderById).toHaveBeenCalledWith('sl-123', mockUser);
      expect(mockExitOrderPlacementService.cancelOrderById).toHaveBeenCalledWith('tp-123', mockUser);
      expect(mockExitOrderPlacementService.cancelOrderById).toHaveBeenCalledWith('ts-123', mockUser);
      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PositionExitStatus.CANCELLED })
      );
    });

    it('should skip cancellation for null order IDs', async () => {
      mockPositionExitRepo.findOne.mockResolvedValue({
        id: 'pe-123',
        userId: 'user-123',
        stopLossOrderId: null,
        takeProfitOrderId: null,
        trailingStopOrderId: null,
        status: PositionExitStatus.ACTIVE
      });
      mockPositionExitRepo.save.mockResolvedValue({});

      await service.cancelExitOrders('pe-123', mockUser);

      expect(mockExitOrderPlacementService.cancelOrderById).not.toHaveBeenCalled();
      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PositionExitStatus.CANCELLED })
      );
    });

    it('should throw if position exit not found', async () => {
      mockPositionExitRepo.findOne.mockResolvedValue(null);

      await expect(service.cancelExitOrders('pe-unknown', mockUser)).rejects.toThrow('Position exit not found');
    });
  });
});
