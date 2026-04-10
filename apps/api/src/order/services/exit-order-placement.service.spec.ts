import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ExitOrderPlacementService } from './exit-order-placement.service';

import { CoinService } from '../../coin/coin.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { CircuitBreakerService, CircuitOpenError } from '../../shared/circuit-breaker.service';
import { CCXT_DECIMAL_PLACES, CCXT_TICK_SIZE } from '../../shared/precision.util';
import { Order, OrderType } from '../order.entity';

describe('ExitOrderPlacementService', () => {
  let service: ExitOrderPlacementService;

  const mockOrderRepo = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn()
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

  const mockCircuitBreakerService = {
    checkCircuit: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    isOpen: jest.fn().mockReturnValue(false),
    getState: jest.fn().mockReturnValue('closed'),
    reset: jest.fn()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExitOrderPlacementService,
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: ExchangeKeyService, useValue: mockExchangeKeyService },
        { provide: ExchangeManagerService, useValue: mockExchangeManagerService },
        { provide: CoinService, useValue: mockCoinService },
        { provide: CircuitBreakerService, useValue: mockCircuitBreakerService }
      ]
    }).compile();

    service = module.get<ExitOrderPlacementService>(ExitOrderPlacementService);

    jest.resetAllMocks();
  });

  describe('checkExchangeOcoSupport', () => {
    it('should return simulated OCO support for Binance (native not yet implemented)', () => {
      const result = service.checkExchangeOcoSupport('binance_us');

      expect(result.native).toBe(false);
      expect(result.simulated).toBe(true);
    });

    it('should return simulated only for Coinbase', () => {
      const result = service.checkExchangeOcoSupport('coinbase');

      expect(result.native).toBe(false);
      expect(result.simulated).toBe(true);
    });

    it('should not report native OCO support for any exchange (not yet implemented)', () => {
      const exchanges = ['binance_us', 'binance', 'coinbase', 'gdax', 'kraken'];
      for (const slug of exchanges) {
        const result = service.checkExchangeOcoSupport(slug);
        expect(result.native).toBe(false);
        expect(result.simulated).toBe(true);
      }
    });

    it('should return simulated for unknown exchanges', () => {
      const result = service.checkExchangeOcoSupport('unknown_exchange');

      expect(result.native).toBe(false);
      expect(result.simulated).toBe(true);
    });
  });

  describe('getMarketLimits', () => {
    it('should extract market limits from exchange client (DECIMAL_PLACES mode)', () => {
      const mockExchangeClient = {
        precisionMode: CCXT_DECIMAL_PLACES,
        markets: {
          'BTC/USDT': {
            limits: {
              amount: { min: 0.001, max: 1000 },
              cost: { min: 10 }
            },
            precision: {
              amount: 8,
              price: 2
            }
          }
        }
      } as any;

      const result = service.getMarketLimits(mockExchangeClient, 'BTC/USDT');

      expect(result).toEqual({
        minAmount: 0.001,
        maxAmount: 1000,
        amountStep: 1e-8,
        minCost: 10,
        pricePrecision: 2,
        amountPrecision: 8
      });
    });

    it('should extract market limits in TICK_SIZE mode (Binance)', () => {
      const mockExchangeClient = {
        precisionMode: CCXT_TICK_SIZE,
        markets: {
          'BTC/USDT': {
            limits: {
              amount: { min: 0.001, max: 1000 },
              cost: { min: 10 }
            },
            precision: {
              amount: 0.001,
              price: 0.01
            }
          }
        }
      } as any;

      const result = service.getMarketLimits(mockExchangeClient, 'BTC/USDT');

      expect(result).toEqual({
        minAmount: 0.001,
        maxAmount: 1000,
        amountStep: 0.001,
        minCost: 10,
        pricePrecision: 2,
        amountPrecision: 3
      });
    });

    it('should return null when market not found', () => {
      const mockExchangeClient = {
        markets: {}
      } as any;

      const result = service.getMarketLimits(mockExchangeClient, 'BTC/USDT');

      expect(result).toBeNull();
    });

    it('should return null on error', () => {
      const mockExchangeClient = {
        get markets() {
          throw new Error('markets error');
        }
      } as any;

      const result = service.getMarketLimits(mockExchangeClient, 'BTC/USDT');

      expect(result).toBeNull();
    });

    it('should use default values when limits/precision fields are missing', () => {
      const mockExchangeClient = {
        precisionMode: CCXT_DECIMAL_PLACES,
        markets: {
          'BTC/USDT': { limits: {}, precision: {} }
        }
      } as any;

      const result = service.getMarketLimits(mockExchangeClient, 'BTC/USDT');

      expect(result).toEqual({
        minAmount: 0,
        maxAmount: Number.MAX_SAFE_INTEGER,
        amountStep: 0,
        minCost: 0,
        pricePrecision: 8,
        amountPrecision: 8
      });
    });
  });

  describe('executeWithResilience', () => {
    it('should execute operation and record success', async () => {
      const result = await service.executeWithResilience('binance', () => Promise.resolve('ok'), 'testOp');

      expect(result).toBe('ok');
      expect(mockCircuitBreakerService.checkCircuit).toHaveBeenCalledWith('exchange:binance');
      expect(mockCircuitBreakerService.recordSuccess).toHaveBeenCalledWith('exchange:binance');
    });

    it('should throw and not execute when circuit is open', async () => {
      const circuitError = new CircuitOpenError('exchange:binance', 30000);
      mockCircuitBreakerService.checkCircuit.mockImplementation(() => {
        throw circuitError;
      });

      await expect(service.executeWithResilience('binance', () => Promise.resolve('ok'), 'testOp')).rejects.toThrow(
        CircuitOpenError
      );
      expect(mockCircuitBreakerService.recordSuccess).not.toHaveBeenCalled();
      expect(mockCircuitBreakerService.recordFailure).not.toHaveBeenCalled();
    });

    it('should record failure and throw when operation fails after retries', async () => {
      const opError = new Error('exchange timeout');
      // withRetry will call the operation; it must always fail
      const operation = jest.fn().mockRejectedValue(opError);

      await expect(service.executeWithResilience('binance', operation, 'testOp')).rejects.toThrow('exchange timeout');
      expect(mockCircuitBreakerService.recordFailure).toHaveBeenCalledWith('exchange:binance');
    });
  });

  describe('cancelOrderById', () => {
    it('should cancel order and update status in DB', async () => {
      const mockOrder = {
        id: 'order-123',
        orderId: 'exchange-order-123',
        symbol: 'BTC/USDT',
        exchangeKeyId: null,
        exchange: null,
        status: 'NEW'
      };
      mockOrderRepo.findOne.mockResolvedValue(mockOrder);
      mockOrderRepo.save.mockResolvedValue(mockOrder);

      const mockUser = { id: 'user-123' } as any;
      await service.cancelOrderById('order-123', mockUser);

      expect(mockOrderRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'order-123' },
        relations: ['exchange']
      });
      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'CANCELED' }));
    });

    it('should attempt exchange cancellation when order has exchangeKey', async () => {
      const mockExchangeClient = { cancelOrder: jest.fn().mockResolvedValue({}) };
      const mockOrder = {
        id: 'order-123',
        orderId: 'exchange-order-123',
        symbol: 'BTC/USDT',
        exchangeKeyId: 'ek-1',
        exchange: { slug: 'binance' },
        status: 'NEW'
      };
      mockOrderRepo.findOne.mockResolvedValue(mockOrder);
      mockOrderRepo.save.mockResolvedValue(mockOrder);
      mockExchangeKeyService.findOne.mockResolvedValue({ id: 'ek-1' });
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);

      const mockUser = { id: 'user-123' } as any;
      await service.cancelOrderById('order-123', mockUser);

      expect(mockExchangeKeyService.findOne).toHaveBeenCalledWith('ek-1', 'user-123');
      expect(mockExchangeClient.cancelOrder).toHaveBeenCalledWith('exchange-order-123', 'BTC/USDT');
      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'CANCELED' }));
    });

    it('should still update DB status when exchange cancellation fails', async () => {
      const mockOrder = {
        id: 'order-123',
        orderId: 'exchange-order-123',
        symbol: 'BTC/USDT',
        exchangeKeyId: 'ek-1',
        exchange: { slug: 'binance' },
        status: 'NEW'
      };
      mockOrderRepo.findOne.mockResolvedValue(mockOrder);
      mockOrderRepo.save.mockResolvedValue(mockOrder);
      mockExchangeKeyService.findOne.mockResolvedValue({ id: 'ek-1' });
      mockExchangeManagerService.getExchangeClient.mockRejectedValue(new Error('exchange down'));

      const mockUser = { id: 'user-123' } as any;
      await service.cancelOrderById('order-123', mockUser);

      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'CANCELED' }));
    });

    it('should not throw when order not found', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null);
      const mockUser = { id: 'user-123' } as any;

      await expect(service.cancelOrderById('unknown', mockUser)).resolves.not.toThrow();
    });
  });

  describe('placeStopLossOrder', () => {
    const baseParams = {
      symbol: 'BTC/USDT',
      side: 'SELL' as const,
      quantity: 0.5,
      stopPrice: 50000,
      price: 0,
      exchangeKeyId: 'ek-1',
      userId: 'user-123',
      orderType: 'stop_loss' as const
    };
    const mockUser = { id: 'user-123' } as any;
    const mockExchangeKey = { id: 'ek-1', exchange: { slug: 'binance' } } as any;

    let mockQueryRunner: any;

    beforeEach(() => {
      mockQueryRunner = {
        manager: {
          create: jest.fn().mockImplementation((_entity, data) => data),
          save: jest.fn().mockImplementation((entity) => Promise.resolve(entity))
        }
      };
      mockCoinService.getMultipleCoinsBySymbol.mockResolvedValue([]);
    });

    it('should create order with exchange order ID on success', async () => {
      const mockExchangeClient = {
        createOrder: jest.fn().mockResolvedValue({ id: 'exch-sl-1', clientOrderId: 'client-sl-1', info: {} })
      } as any;

      const result = await service.placeStopLossOrder(
        baseParams,
        mockExchangeClient,
        mockUser,
        mockExchangeKey,
        mockQueryRunner,
        'binance'
      );

      expect(mockExchangeClient.createOrder).toHaveBeenCalledWith('BTC/USDT', 'stop_loss', 'sell', 0.5, undefined, {
        stopPrice: 50000
      });
      expect(result.orderId).toBe('exch-sl-1');
      expect(result.type).toBe(OrderType.STOP_LOSS);
      expect(result.stopLossPrice).toBe(50000);
    });

    it('should create pending order when exchange call fails', async () => {
      const mockExchangeClient = {
        createOrder: jest.fn().mockRejectedValue(new Error('exchange error'))
      } as any;

      const result = await service.placeStopLossOrder(
        baseParams,
        mockExchangeClient,
        mockUser,
        mockExchangeKey,
        mockQueryRunner,
        'binance'
      );

      expect(result.orderId).toMatch(/^sl_pending_/);
      expect(result.type).toBe(OrderType.STOP_LOSS);
      expect(mockQueryRunner.manager.save).toHaveBeenCalled();
    });

    it('should create pending order when no exchange client provided', async () => {
      const result = await service.placeStopLossOrder(baseParams, null, mockUser, null, mockQueryRunner, undefined);

      expect(result.orderId).toMatch(/^sl_pending_/);
      expect(result.type).toBe(OrderType.STOP_LOSS);
    });

    it('should coerce empty exchangeKeyId to null on persisted order', async () => {
      const result = await service.placeStopLossOrder(
        { ...baseParams, exchangeKeyId: '' },
        null,
        mockUser,
        null,
        mockQueryRunner,
        undefined
      );

      expect((result as any).exchangeKeyId).toBeUndefined();
    });
  });

  describe('placeTakeProfitOrder', () => {
    const baseParams = {
      symbol: 'BTC/USDT',
      side: 'SELL' as const,
      quantity: 0.5,
      price: 70000,
      stopPrice: 0,
      exchangeKeyId: 'ek-1',
      userId: 'user-123',
      orderType: 'take_profit' as const
    };
    const mockUser = { id: 'user-123' } as any;
    const mockExchangeKey = { id: 'ek-1', exchange: { slug: 'binance' } } as any;

    let mockQueryRunner: any;

    beforeEach(() => {
      mockQueryRunner = {
        manager: {
          create: jest.fn().mockImplementation((_entity, data) => data),
          save: jest.fn().mockImplementation((entity) => Promise.resolve(entity))
        }
      };
      mockCoinService.getMultipleCoinsBySymbol.mockResolvedValue([]);
    });

    it('should create order with exchange order ID on success', async () => {
      const mockExchangeClient = {
        createOrder: jest.fn().mockResolvedValue({ id: 'exch-tp-1', clientOrderId: 'client-tp-1', info: {} })
      } as any;

      const result = await service.placeTakeProfitOrder(
        baseParams,
        mockExchangeClient,
        mockUser,
        mockExchangeKey,
        mockQueryRunner,
        'binance'
      );

      expect(mockExchangeClient.createOrder).toHaveBeenCalledWith('BTC/USDT', 'limit', 'sell', 0.5, 70000);
      expect(result.orderId).toBe('exch-tp-1');
      expect(result.type).toBe(OrderType.TAKE_PROFIT);
      expect(result.takeProfitPrice).toBe(70000);
    });

    it('should create pending order when exchange call fails', async () => {
      const mockExchangeClient = {
        createOrder: jest.fn().mockRejectedValue(new Error('exchange error'))
      } as any;

      const result = await service.placeTakeProfitOrder(
        baseParams,
        mockExchangeClient,
        mockUser,
        mockExchangeKey,
        mockQueryRunner,
        'binance'
      );

      expect(result.orderId).toMatch(/^tp_pending_/);
      expect(result.type).toBe(OrderType.TAKE_PROFIT);
    });
  });
});
