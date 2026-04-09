import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { ManualOrderValidatorService } from './manual-order-validator.service';
import { ManualOrderService } from './manual-order.service';
import { OcoOrderService } from './oco-order.service';
import { PositionManagementService } from './position-management.service';
import { TradingFeesService } from './trading-fees.service';

import { CoinService } from '../../coin/coin.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { User } from '../../users/users.entity';
import { PlaceManualOrderDto } from '../dto/place-manual-order.dto';
import { Order, OrderSide, OrderStatus, OrderType } from '../order.entity';

describe('ManualOrderService', () => {
  let service: ManualOrderService;
  let orderRepository: jest.Mocked<Repository<Order>>;
  let exchangeKeyService: jest.Mocked<ExchangeKeyService>;
  let exchangeManagerService: jest.Mocked<ExchangeManagerService>;
  let positionManagementService: jest.Mocked<PositionManagementService>;
  let queryRunner: any;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  const mockUser: User = { id: 'user-123', email: 't@e.com' } as User;

  const mockExchangeKey: any = {
    id: 'ek-1',
    exchange: { id: 'ex-1', slug: 'binance', name: 'Binance' }
  };

  const baseMarket = { maker: 0.001, taker: 0.002, limits: { amount: { min: 0.001, max: 1000 } } };

  const makeExchangeStub = (overrides: any = {}) => ({
    loadMarkets: jest.fn().mockResolvedValue(undefined),
    markets: { 'BTC/USDT': baseMarket },
    fetchTicker: jest.fn().mockResolvedValue({ last: 50000 }),
    fetchBalance: jest.fn().mockResolvedValue({ USDT: { free: 100000 }, BTC: { free: 10 } }),
    fetchOrderBook: jest.fn().mockResolvedValue({ asks: [[50000, 1]], bids: [[49990, 1]] }),
    createOrder: jest.fn().mockResolvedValue({
      id: 'ex-order-1',
      clientOrderId: 'co-1',
      symbol: 'BTC/USDT',
      price: 50000,
      filled: 0,
      cost: 0,
      status: 'open',
      timestamp: Date.now(),
      info: {}
    }),
    cancelOrder: jest.fn().mockResolvedValue({}),
    precisionMode: 2,
    ...overrides
  });

  beforeEach(async () => {
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        create: jest.fn((_e, data) => ({ id: 'order-new', ...data })),
        save: jest.fn((order) => Promise.resolve(order))
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManualOrderService,
        TradingFeesService,
        {
          provide: getRepositoryToken(Order),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn((o: any) => Promise.resolve(o)),
            create: jest.fn((data: any) => ({ id: 'order-new', ...data }))
          }
        },
        {
          provide: DataSource,
          useValue: { createQueryRunner: jest.fn().mockReturnValue(queryRunner) }
        },
        {
          provide: ExchangeKeyService,
          useValue: { findOne: jest.fn() }
        },
        {
          provide: ExchangeManagerService,
          useValue: { getExchangeClient: jest.fn() }
        },
        {
          provide: CoinService,
          useValue: { getMultipleCoinsBySymbol: jest.fn().mockResolvedValue([]) }
        },
        {
          provide: PositionManagementService,
          useValue: { attachExitOrders: jest.fn() }
        },
        {
          provide: ManualOrderValidatorService,
          useValue: {
            validate: jest.fn().mockResolvedValue(undefined),
            assertOrderTypeSupported: jest.fn()
          }
        },
        {
          provide: OcoOrderService,
          useValue: { createOcoOrder: jest.fn() }
        }
      ]
    }).compile();

    service = module.get<ManualOrderService>(ManualOrderService);
    orderRepository = module.get(getRepositoryToken(Order));
    exchangeKeyService = module.get(ExchangeKeyService);
    exchangeManagerService = module.get(ExchangeManagerService);
    positionManagementService = module.get(PositionManagementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerErrorSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });

  describe('previewManualOrder', () => {
    const previewDto = {
      exchangeKeyId: 'ek-1',
      symbol: 'BTC/USDT',
      side: OrderSide.BUY,
      orderType: OrderType.MARKET,
      quantity: 0.01
    } as any;

    beforeEach(() => {
      exchangeKeyService.findOne.mockResolvedValue(mockExchangeKey);
    });

    it('preserves NotFoundException when exchange key is missing', async () => {
      exchangeKeyService.findOne.mockResolvedValue(null as any);
      await expect(service.previewManualOrder(previewDto, mockUser)).rejects.toThrow(NotFoundException);
    });

    it('emits min quantity warning when quantity below market min', async () => {
      exchangeManagerService.getExchangeClient.mockResolvedValue(makeExchangeStub() as any);
      const result = await service.previewManualOrder({ ...previewDto, quantity: 0.0001 }, mockUser);
      expect(result.warnings.some((w) => w.includes('Minimum quantity'))).toBe(true);
    });

    it('includes estimatedSlippage and warns when slippage > 1%', async () => {
      const stub = makeExchangeStub();
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);
      const tradingFees = (service as any).tradingFeesService as TradingFeesService;
      jest.spyOn(tradingFees, 'calculateSlippage').mockReturnValue(2.5);

      const result = await service.previewManualOrder(previewDto, mockUser);
      expect(result.estimatedSlippage).toBeCloseTo(2.5);
      expect(result.warnings.some((w) => w.includes('High estimated slippage'))).toBe(true);
    });

    it('does not throw when slippage calculation fails', async () => {
      const stub = makeExchangeStub({ fetchOrderBook: jest.fn().mockRejectedValue(new Error('ob down')) });
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);
      const result = await service.previewManualOrder(previewDto, mockUser);
      expect(result.estimatedSlippage).toBeUndefined();
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to calculate slippage'));
    });

    it('returns preview with estimated cost and fees (market buy)', async () => {
      exchangeManagerService.getExchangeClient.mockResolvedValue(makeExchangeStub() as any);

      const result = await service.previewManualOrder(previewDto, mockUser);

      expect(result.symbol).toBe('BTC/USDT');
      expect(result.estimatedCost).toBeCloseTo(500);
      expect(result.hasSufficientBalance).toBe(true);
    });

    it('emits insufficient balance warning', async () => {
      const stub = makeExchangeStub({ fetchBalance: jest.fn().mockResolvedValue({ USDT: { free: 1 } }) });
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);

      const result = await service.previewManualOrder(previewDto, mockUser);
      expect(result.warnings.some((w) => w.includes('Insufficient'))).toBe(true);
    });

    it('emits price deviation warning when price is >5% from market', async () => {
      exchangeManagerService.getExchangeClient.mockResolvedValue(makeExchangeStub() as any);
      const result = await service.previewManualOrder(
        { ...previewDto, orderType: OrderType.LIMIT, price: 60000 },
        mockUser
      );
      expect(result.warnings.some((w) => w.includes('above'))).toBe(true);
    });
  });

  describe('placeManualOrder', () => {
    const placeDto: PlaceManualOrderDto = {
      exchangeKeyId: 'ek-1',
      symbol: 'BTC/USDT',
      side: OrderSide.BUY,
      orderType: OrderType.MARKET,
      quantity: 0.01
    } as any;

    beforeEach(() => {
      exchangeKeyService.findOne.mockResolvedValue(mockExchangeKey);
    });

    it('throws NotFoundException when exchange key missing', async () => {
      exchangeKeyService.findOne.mockResolvedValue(null as any);
      await expect(service.placeManualOrder(placeDto, mockUser)).rejects.toThrow(NotFoundException);
    });

    it('places market order successfully and commits transaction', async () => {
      const stub = makeExchangeStub();
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);

      const result = await service.placeManualOrder(placeDto, mockUser);

      expect(stub.createOrder).toHaveBeenCalledWith('BTC/USDT', 'market', 'buy', 0.01, undefined, {});
      expect(result.isManual).toBe(true);
      expect(result.orderId).toBe('ex-order-1');
      expect(result.status).toBe(OrderStatus.NEW);
    });

    it('invokes manualOrderValidator before placing order', async () => {
      const stub = makeExchangeStub();
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);
      const validator = (service as any).manualOrderValidator as ManualOrderValidatorService;

      await service.placeManualOrder(placeDto, mockUser);
      expect(validator.validate).toHaveBeenCalledWith(placeDto, stub, 'binance');
    });

    it('forwards stopPrice and timeInForce to createOrder params', async () => {
      const stub = makeExchangeStub();
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);

      await service.placeManualOrder(
        { ...placeDto, orderType: OrderType.STOP_LIMIT, price: 49000, stopPrice: 49500, timeInForce: 'GTC' } as any,
        mockUser
      );

      expect(stub.createOrder).toHaveBeenCalledWith(
        'BTC/USDT',
        expect.any(String),
        'buy',
        0.01,
        49000,
        expect.objectContaining({ stopPrice: 49500, timeInForce: 'GTC' })
      );
    });

    it('delegates OCO orders to OcoOrderService and skips transaction', async () => {
      const stub = makeExchangeStub();
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);
      const ocoService = (service as any).ocoOrderService as OcoOrderService;
      (ocoService.createOcoOrder as jest.Mock).mockResolvedValue({ id: 'oco-1' } as Order);

      const result = await service.placeManualOrder({ ...placeDto, orderType: OrderType.OCO } as any, mockUser);

      expect(ocoService.createOcoOrder).toHaveBeenCalled();
      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
      expect(stub.createOrder).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'oco-1' });
    });

    it('logs CRITICAL when DB save fails after exchange order', async () => {
      const stub = makeExchangeStub();
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);
      (orderRepository.save as jest.Mock).mockRejectedValueOnce(new Error('db down'));

      await expect(service.placeManualOrder(placeDto, mockUser)).rejects.toThrow();
      const criticalCalls = loggerErrorSpy.mock.calls.filter((c) => String(c[0]).includes('CRITICAL'));
      expect(criticalCalls.length).toBeGreaterThan(0);
    });

    it('does not fail order if exit config attachment fails', async () => {
      const stub = makeExchangeStub();
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);
      positionManagementService.attachExitOrders.mockRejectedValue(new Error('exit fail'));

      const result = await service.placeManualOrder(
        { ...placeDto, exitConfig: { enableStopLoss: true } } as any,
        mockUser
      );

      expect(result).toBeDefined();
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to attach exit orders'));
    });
  });

  describe('cancelManualOrder', () => {
    const mockOrder = {
      id: 'order-1',
      orderId: 'ex-order-1',
      symbol: 'BTC/USDT',
      status: OrderStatus.NEW,
      exchangeKeyId: 'ek-1',
      user: mockUser
    } as Order;

    it('throws NotFoundException when order missing', async () => {
      orderRepository.findOne.mockResolvedValue(null);
      await expect(service.cancelManualOrder('missing', mockUser)).rejects.toThrow(NotFoundException);
    });

    it.each([OrderStatus.FILLED, OrderStatus.CANCELED, OrderStatus.REJECTED, OrderStatus.EXPIRED])(
      'rejects canceling order with status %s',
      async (status) => {
        orderRepository.findOne.mockResolvedValue({ ...mockOrder, status } as Order);
        await expect(service.cancelManualOrder('order-1', mockUser)).rejects.toThrow(BadRequestException);
      }
    );

    it('rejects when order has no exchangeKeyId', async () => {
      orderRepository.findOne.mockResolvedValue({ ...mockOrder, exchangeKeyId: null } as any);
      await expect(service.cancelManualOrder('order-1', mockUser)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on "filled before cancellation"', async () => {
      orderRepository.findOne.mockResolvedValue(mockOrder);
      exchangeKeyService.findOne.mockResolvedValue(mockExchangeKey);
      const stub = makeExchangeStub({
        cancelOrder: jest.fn().mockRejectedValue(new Error('Order was filled'))
      });
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);

      await expect(service.cancelManualOrder('order-1', mockUser)).rejects.toThrow('filled before cancellation');
    });

    it('cancels and updates order successfully', async () => {
      orderRepository.findOne.mockResolvedValue({ ...mockOrder } as Order);
      exchangeKeyService.findOne.mockResolvedValue(mockExchangeKey);
      const stub = makeExchangeStub();
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);
      orderRepository.save.mockImplementation(async (o: any) => o);

      const result = await service.cancelManualOrder('order-1', mockUser);

      expect(stub.cancelOrder).toHaveBeenCalledWith('ex-order-1', 'BTC/USDT');
      expect(result.status).toBe(OrderStatus.CANCELED);
    });

    it('cancels an OCO partner exactly once even when both sides have cross-links', async () => {
      // Both orders reference each other — without skipLinked this would infinite-loop
      const parent = { ...mockOrder, id: 'order-1', orderId: 'ex-order-1', ocoLinkedOrderId: 'order-2' };
      const linked = { ...mockOrder, id: 'order-2', orderId: 'ex-order-2', ocoLinkedOrderId: 'order-1' };

      orderRepository.findOne
        .mockResolvedValueOnce({ ...parent } as Order)
        .mockResolvedValueOnce({ ...linked } as Order);

      exchangeKeyService.findOne.mockResolvedValue(mockExchangeKey);
      const stub = makeExchangeStub();
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);
      orderRepository.save.mockImplementation(async (o: any) => o);

      await service.cancelManualOrder('order-1', mockUser);

      // Exactly 2 findOne calls total — no recursion back into order-1
      expect(orderRepository.findOne).toHaveBeenCalledTimes(2);
      expect(stub.cancelOrder).toHaveBeenCalledTimes(2);
      expect(stub.cancelOrder).toHaveBeenCalledWith('ex-order-1', 'BTC/USDT');
      expect(stub.cancelOrder).toHaveBeenCalledWith('ex-order-2', 'BTC/USDT');
    });

    it('recursively cancels OCO linked order', async () => {
      const linkedOrder = { ...mockOrder, id: 'order-2', orderId: 'ex-order-2', ocoLinkedOrderId: undefined };
      const parentOrder = { ...mockOrder, ocoLinkedOrderId: 'order-2' };

      orderRepository.findOne
        .mockResolvedValueOnce({ ...parentOrder } as Order)
        .mockResolvedValueOnce({ ...linkedOrder } as Order);

      exchangeKeyService.findOne.mockResolvedValue(mockExchangeKey);
      const stub = makeExchangeStub();
      exchangeManagerService.getExchangeClient.mockResolvedValue(stub as any);
      const saved: Order[] = [];
      orderRepository.save.mockImplementation(async (o: any) => {
        saved.push(o);
        return o;
      });

      await service.cancelManualOrder('order-1', mockUser);

      expect(orderRepository.findOne).toHaveBeenCalledTimes(2);
      expect(stub.cancelOrder).toHaveBeenCalledWith('ex-order-1', 'BTC/USDT');
      expect(stub.cancelOrder).toHaveBeenCalledWith('ex-order-2', 'BTC/USDT');
      expect(saved).toHaveLength(2);
      expect(saved.every((o) => o.status === OrderStatus.CANCELED)).toBe(true);
    });
  });
});
