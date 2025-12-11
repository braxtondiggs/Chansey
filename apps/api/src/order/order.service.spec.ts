import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource, In, Repository } from 'typeorm';

import { OrderDto } from './dto/order.dto';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { OrderService } from './order.service';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderValidationService } from './services/order-validation.service';

import { CoinService } from '../coin/coin.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { ExchangeService } from '../exchange/exchange.service';
import { User } from '../users/users.entity';

describe('OrderService', () => {
  let service: OrderService;
  let orderRepository: jest.Mocked<Repository<Order>>;
  let exchangeService: jest.Mocked<ExchangeService>;
  let exchangeKeyService: jest.Mocked<ExchangeKeyService>;
  let exchangeManagerService: jest.Mocked<ExchangeManagerService>;
  let coinService: jest.Mocked<CoinService>;
  let orderValidationService: jest.Mocked<OrderValidationService>;
  let orderCalculationService: jest.Mocked<OrderCalculationService>;
  let loggerErrorSpy: jest.SpyInstance;

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com'
  } as User;

  const mockBaseCoin = {
    id: 'coin-btc',
    symbol: 'BTC',
    name: 'Bitcoin',
    slug: 'bitcoin'
  };

  const mockQuoteCoin = {
    id: 'coin-usdt',
    symbol: 'USDT',
    name: 'Tether USD',
    slug: 'tether'
  };

  const mockExchangeOrder = {
    id: 'exchange-order-123',
    symbol: 'BTC/USDT',
    side: 'buy',
    type: 'market',
    amount: 0.1,
    price: 50000,
    filled: 0.1,
    cost: 5000,
    fee: { cost: 5, currency: 'USDT' },
    status: 'closed',
    timestamp: Date.now(),
    trades: [],
    info: {}
  };

  const mockOrder: Order = {
    id: 'order-123',
    symbol: 'BTC/USDT',
    orderId: 'exchange-order-123',
    clientOrderId: 'client-123',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    quantity: 0.1,
    price: 50000,
    executedQuantity: 0.1,
    cost: 5000,
    fee: 5,
    feeCurrency: 'USDT',
    status: OrderStatus.FILLED,
    transactTime: new Date(),
    baseCoin: mockBaseCoin,
    quoteCoin: mockQuoteCoin,
    user: mockUser,
    createdAt: new Date(),
    updatedAt: new Date()
  } as Order;

  beforeEach(async () => {
    // Mock Logger.error to suppress expected error logs in tests
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: getRepositoryToken(Order),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn()
          }
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue({
              connect: jest.fn(),
              startTransaction: jest.fn(),
              commitTransaction: jest.fn(),
              rollbackTransaction: jest.fn(),
              release: jest.fn(),
              manager: {
                create: jest.fn(),
                save: jest.fn()
              }
            })
          }
        },
        {
          provide: ExchangeService,
          useValue: {
            getExchangeById: jest.fn()
          }
        },
        {
          provide: ExchangeManagerService,
          useValue: {
            getExchangeClient: jest.fn(),
            formatSymbol: jest.fn()
          }
        },
        {
          provide: ExchangeKeyService,
          useValue: {
            findOne: jest.fn()
          }
        },
        {
          provide: CoinService,
          useValue: {
            getCoinById: jest.fn(),
            getCoinBySymbol: jest.fn(),
            getMultipleCoinsBySymbol: jest.fn()
          }
        },
        {
          provide: OrderValidationService,
          useValue: {
            validateOrder: jest.fn()
          }
        },
        {
          provide: OrderCalculationService,
          useValue: {
            mapCcxtStatusToOrderStatus: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<OrderService>(OrderService);
    orderRepository = module.get(getRepositoryToken(Order));
    exchangeService = module.get(ExchangeService);
    exchangeKeyService = module.get(ExchangeKeyService);
    exchangeManagerService = module.get(ExchangeManagerService);
    exchangeKeyService = module.get(ExchangeKeyService);
    coinService = module.get(CoinService);
    orderValidationService = module.get(OrderValidationService);
    orderCalculationService = module.get(OrderCalculationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerErrorSpy.mockRestore();
  });

  describe('createOrder', () => {
    const mockOrderDto: OrderDto = {
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      baseCoinId: 'coin-btc',
      exchangeId: 'binance_us',
      quantity: '0.1'
    };

    const mockExchangeClient = {
      createOrder: jest.fn()
    };

    beforeEach(() => {
      coinService.getCoinById.mockImplementation((id) => {
        if (id === 'coin-btc') return Promise.resolve(mockBaseCoin as any);
        if (id === 'coin-usdt') return Promise.resolve(mockQuoteCoin as any);
        return Promise.resolve(null);
      });
      coinService.getCoinBySymbol.mockResolvedValue(mockQuoteCoin as any);
      exchangeService.getExchangeById.mockResolvedValue({ slug: 'binance_us' } as any);
      exchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient as any);
      exchangeManagerService.formatSymbol.mockReturnValue('BTC/USDT');
      orderValidationService.validateOrder.mockResolvedValue();
      mockExchangeClient.createOrder.mockResolvedValue(mockExchangeOrder);
      orderRepository.create.mockReturnValue(mockOrder);
      orderRepository.save.mockResolvedValue(mockOrder);
    });

    it('should create a buy order successfully', async () => {
      const result = await service.createOrder(mockOrderDto, mockUser);

      expect(coinService.getCoinById).toHaveBeenCalledWith('coin-btc');
      expect(coinService.getCoinBySymbol).toHaveBeenCalledWith('USDT');
      expect(exchangeService.getExchangeById).toHaveBeenCalledWith('binance_us');
      expect(exchangeManagerService.getExchangeClient).toHaveBeenCalledWith('binance_us', mockUser);
      expect(exchangeManagerService.formatSymbol).toHaveBeenCalledWith('binance_us', 'BTCUSDT');
      expect(orderValidationService.validateOrder).toHaveBeenCalledWith(mockOrderDto, 'BTC/USDT', mockExchangeClient);
      expect(mockExchangeClient.createOrder).toHaveBeenCalledWith('BTC/USDT', 'market', 'buy', 0.1, undefined);
      expect(orderRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockOrder);
    });

    it('should create a sell order successfully', async () => {
      const sellOrderDto: OrderDto = {
        ...mockOrderDto,
        side: OrderSide.SELL
      };

      mockExchangeClient.createOrder.mockResolvedValue({
        ...mockExchangeOrder,
        side: 'sell'
      });

      const result = await service.createOrder(sellOrderDto, mockUser);

      expect(mockExchangeClient.createOrder).toHaveBeenCalledWith('BTC/USDT', 'market', 'sell', 0.1, undefined);
      expect(result).toEqual(mockOrder);
    });

    it('should create a limit order with price', async () => {
      const limitOrderDto: OrderDto = {
        ...mockOrderDto,
        type: OrderType.LIMIT,
        price: '55000'
      };

      mockExchangeClient.createOrder.mockResolvedValue({
        ...mockExchangeOrder,
        type: 'limit',
        price: 55000
      });

      await service.createOrder(limitOrderDto, mockUser);

      expect(mockExchangeClient.createOrder).toHaveBeenCalledWith('BTC/USDT', 'limit', 'buy', 0.1, 55000);
    });

    it('should use custom quote coin when provided', async () => {
      const customQuoteCoin = { id: 'coin-busd', symbol: 'BUSD' };
      const orderDtoWithQuote: OrderDto = {
        ...mockOrderDto,
        quoteCoinId: 'coin-busd'
      };

      coinService.getCoinById.mockImplementation((id) => {
        if (id === 'coin-btc') return Promise.resolve(mockBaseCoin as any);
        if (id === 'coin-busd') return Promise.resolve(customQuoteCoin as any);
        return Promise.resolve(null);
      });
      exchangeManagerService.formatSymbol.mockReturnValue('BTC/BUSD');

      await service.createOrder(orderDtoWithQuote, mockUser);

      expect(coinService.getCoinById).toHaveBeenCalledWith('coin-busd');
      expect(exchangeManagerService.formatSymbol).toHaveBeenCalledWith('binance_us', 'BTCBUSD');
      expect(mockExchangeClient.createOrder).toHaveBeenCalledWith('BTC/BUSD', 'market', 'buy', 0.1, undefined);
    });

    it('should throw BadRequestException for invalid coin ID', async () => {
      coinService.getCoinById.mockResolvedValue(null);

      await expect(service.createOrder(mockOrderDto, mockUser)).rejects.toThrow(BadRequestException);
      await expect(service.createOrder(mockOrderDto, mockUser)).rejects.toThrow(
        'Failed to create order: Invalid base coin ID: coin-btc'
      );
    });

    it('should throw BadRequestException for invalid quote coin ID', async () => {
      const orderDtoWithInvalidQuote: OrderDto = {
        ...mockOrderDto,
        quoteCoinId: 'invalid-quote'
      };

      coinService.getCoinById.mockImplementation((id) => {
        if (id === 'coin-btc') return Promise.resolve(mockBaseCoin as any);
        if (id === 'invalid-quote') return Promise.resolve(null);
        return Promise.resolve(null);
      });

      await expect(service.createOrder(orderDtoWithInvalidQuote, mockUser)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when USDT not found', async () => {
      coinService.getCoinBySymbol.mockResolvedValue(null);

      await expect(service.createOrder(mockOrderDto, mockUser)).rejects.toThrow('USDT not found in system');
    });

    it('should throw BadRequestException when validation fails', async () => {
      orderValidationService.validateOrder.mockRejectedValue(new BadRequestException('Insufficient balance'));

      await expect(service.createOrder(mockOrderDto, mockUser)).rejects.toThrow(
        'Failed to create order: Insufficient balance'
      );
    });

    it('should throw BadRequestException when exchange order fails', async () => {
      mockExchangeClient.createOrder.mockRejectedValue(new Error('Exchange API error'));

      await expect(service.createOrder(mockOrderDto, mockUser)).rejects.toThrow(
        'Failed to create order: Exchange error: Exchange API error'
      );
    });
  });

  describe('getOrders', () => {
    it('should return orders with default options', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      const result = await service.getOrders(mockUser);

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id } },
        relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
        order: { createdAt: 'DESC' }
      });
      expect(result).toEqual([mockOrder]);
    });

    it('should apply status filter', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { status: OrderStatus.FILLED });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id }, status: OrderStatus.FILLED },
        relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
        order: { createdAt: 'DESC' }
      });
    });

    it('should apply side filter', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { side: OrderSide.BUY });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id }, side: OrderSide.BUY },
        relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
        order: { createdAt: 'DESC' }
      });
    });

    it('should apply limit', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { limit: 10 });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id } },
        relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
        order: { createdAt: 'DESC' },
        take: 10
      });
    });

    it('should handle comma-separated status values', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { status: 'NEW,PARTIALLY_FILLED' });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: {
          user: { id: mockUser.id },
          status: In([OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED])
        },
        relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
        order: { createdAt: 'DESC' }
      });
    });

    it('should handle comma-separated side values', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { side: 'BUY,SELL' });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: {
          user: { id: mockUser.id },
          side: In([OrderSide.BUY, OrderSide.SELL])
        },
        relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
        order: { createdAt: 'DESC' }
      });
    });

    it('should handle comma-separated orderType values', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { orderType: 'market,limit' });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: {
          user: { id: mockUser.id },
          type: In([OrderType.MARKET, OrderType.LIMIT])
        },
        relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
        order: { createdAt: 'DESC' }
      });
    });

    it('should handle single status value from comma-separated string', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { status: 'FILLED' });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: {
          user: { id: mockUser.id },
          status: OrderStatus.FILLED
        },
        relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
        order: { createdAt: 'DESC' }
      });
    });

    it('should apply manual flag and limit together', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { isManual: true, limit: 5 });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id }, isManual: true },
        relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
        order: { createdAt: 'DESC' },
        take: 5
      });
    });
  });

  describe('getOrder', () => {
    it('should return a specific order', async () => {
      orderRepository.findOne.mockResolvedValue(mockOrder);

      const result = await service.getOrder(mockUser, 'order-123');

      expect(orderRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'order-123', user: { id: mockUser.id } },
        relations: ['baseCoin', 'quoteCoin', 'exchange']
      });
      expect(result).toEqual(mockOrder);
    });

    it('should throw NotFoundException when order not found', async () => {
      orderRepository.findOne.mockResolvedValue(null);

      await expect(service.getOrder(mockUser, 'non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.getOrder(mockUser, 'non-existent')).rejects.toThrow('Order with ID non-existent not found');
    });
  });

  describe('mapExchangeStatusToOrderStatus', () => {
    it('should map exchange statuses correctly', () => {
      // Access private method for testing
      const mapMethod = (service as any).mapExchangeStatusToOrderStatus.bind(service);

      expect(mapMethod('open')).toBe(OrderStatus.NEW);
      expect(mapMethod('closed')).toBe(OrderStatus.FILLED);
      expect(mapMethod('canceled')).toBe(OrderStatus.CANCELED);
      expect(mapMethod('cancelled')).toBe(OrderStatus.CANCELED);
      expect(mapMethod('expired')).toBe(OrderStatus.EXPIRED);
      expect(mapMethod('rejected')).toBe(OrderStatus.REJECTED);
      expect(mapMethod('partial')).toBe(OrderStatus.PARTIALLY_FILLED);
      expect(mapMethod('unknown')).toBe(OrderStatus.NEW); // default case
    });
  });

  describe('previewOrder', () => {
    it('should build preview with slippage and balance warning', async () => {
      const exchangeStub: any = {
        fetchTicker: jest.fn().mockResolvedValue({ last: 100 }),
        fetchBalance: jest.fn().mockResolvedValue({ USDT: { free: 50 } }),
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [
            [100, 0.4],
            [105, 0.6]
          ]
        }),
        fetchTradingFees: jest.fn().mockResolvedValue({ maker: 0.001, taker: 0.002 })
      };

      coinService.getCoinById.mockResolvedValueOnce(mockBaseCoin as any);
      coinService.getCoinBySymbol.mockResolvedValue(mockQuoteCoin as any);
      exchangeService.getExchangeById.mockResolvedValue({ slug: 'binance' } as any);
      exchangeManagerService.getExchangeClient.mockResolvedValue(exchangeStub);
      exchangeManagerService.formatSymbol.mockReturnValue('BTC/USDT');

      const preview = await service.previewOrder(
        {
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          baseCoinId: 'coin-btc',
          exchangeId: 'binance',
          quantity: '0.5'
        },
        mockUser
      );

      expect(preview.symbol).toBe('BTC/USDT');
      expect(preview.estimatedSlippage).toBeGreaterThanOrEqual(1);
      expect(preview.warnings.some((w) => w.includes('Insufficient'))).toBe(true);
      expect(exchangeStub.fetchOrderBook).toHaveBeenCalledWith('BTC/USDT', 20);
    });
  });

  describe('internal helpers', () => {
    it('calculates trading fees using market fallback when API fails', async () => {
      const exchangeStub: any = {
        fetchTradingFees: jest.fn().mockRejectedValue(new Error('api down')),
        markets: { BTCUSDT: { maker: 0.002, taker: 0.003 } }
      };

      const { feeRate, feeAmount } = await (service as any).getTradingFees(
        exchangeStub,
        'binance',
        OrderType.LIMIT,
        1000
      );

      expect(feeRate).toBe(0.002);
      expect(feeAmount).toBe(2);
    });

    it('calculates trading fees using default fallback when no market data', async () => {
      const exchangeStub: any = {
        fetchTradingFees: jest.fn().mockRejectedValue(new Error('api down')),
        markets: {}
      };

      const { feeRate, feeAmount } = await (service as any).getTradingFees(
        exchangeStub,
        'unknown',
        OrderType.MARKET,
        100
      );

      expect(feeRate).toBe(0.001); // default taker
      expect(feeAmount).toBeCloseTo(0.1);
    });

    it('calculates slippage from order book', () => {
      const orderBook = {
        asks: [
          [100, 0.5],
          [110, 0.5]
        ],
        bids: [[99, 1]]
      };
      const slippage = (service as any).calculateSlippage(orderBook, 0.75, OrderSide.BUY);

      expect(slippage).toBeGreaterThan(0);
      expect(slippage).toBeLessThan(10);
    });
  });

  /**
   * T010: Holdings calculation tests
   * Expected: These tests should FAIL because getHoldingsByCoin method doesn't exist yet
   */
  describe('getHoldingsByCoin() - T010', () => {
    const mockBtcCoin = {
      id: 'coin-btc',
      symbol: 'BTC',
      name: 'Bitcoin',
      slug: 'bitcoin',
      currentPrice: 43250.5
    };

    const mockBinanceExchange = {
      id: 'exchange-binance',
      name: 'Binance',
      slug: 'binance_us'
    };

    const mockCoinbaseExchange = {
      id: 'exchange-coinbase',
      name: 'Coinbase',
      slug: 'coinbase_pro'
    };

    it('should aggregate buy orders across multiple exchanges', async () => {
      const buyOrders = [
        {
          ...mockOrder,
          id: 'order-1',
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.3,
          price: 40000,
          cost: 12000
        } as Order,
        {
          ...mockOrder,
          id: 'order-2',
          baseCoin: mockBtcCoin,
          exchange: mockCoinbaseExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.2,
          price: 45000,
          cost: 9000
        } as Order
      ];

      orderRepository.find.mockResolvedValue(buyOrders);

      // This will fail - getHoldingsByCoin doesn't exist yet
      const result = await (service as any).getHoldingsByCoin(mockUser, mockBtcCoin);

      expect(result.coinSymbol).toBe('BTC');
      expect(result.totalAmount).toBe(0.5); // 0.3 + 0.2
      expect(result.averageBuyPrice).toBe(42000); // (12000 + 9000) / 0.5
      expect(result.currentValue).toBe(21625.25); // 0.5 * 43250.50
      expect(result.exchanges).toHaveLength(2);
    });

    it('should calculate weighted average buy price correctly', async () => {
      const buyOrders = [
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.5,
          price: 40000,
          cost: 20000
        } as Order,
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.3,
          price: 50000,
          cost: 15000
        } as Order,
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.2,
          price: 45000,
          cost: 9000
        } as Order
      ];

      orderRepository.find.mockResolvedValue(buyOrders);

      const result = await (service as any).getHoldingsByCoin(mockUser, mockBtcCoin);

      // Weighted average: (20000 + 15000 + 9000) / (0.5 + 0.3 + 0.2) = 44000 / 1.0 = 44000
      expect(result.averageBuyPrice).toBe(44000);
      expect(result.totalAmount).toBe(1.0);
    });

    it('should handle sells reducing total amount', async () => {
      const orders = [
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 1.0,
          price: 40000,
          cost: 40000
        } as Order,
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.SELL,
          executedQuantity: 0.3,
          price: 45000,
          cost: 13500
        } as Order
      ];

      orderRepository.find.mockResolvedValue(orders);

      const result = await (service as any).getHoldingsByCoin(mockUser, mockBtcCoin);

      expect(result.totalAmount).toBe(0.7); // 1.0 - 0.3
      expect(result.averageBuyPrice).toBe(40000); // Buy price remains from original purchase
    });

    it('should handle multiple buys and sells correctly', async () => {
      const orders = [
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 1.0,
          price: 40000,
          cost: 40000
        } as Order,
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.SELL,
          executedQuantity: 0.5,
          price: 50000,
          cost: 25000
        } as Order,
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.3,
          price: 45000,
          cost: 13500
        } as Order
      ];

      orderRepository.find.mockResolvedValue(orders);

      const result = await (service as any).getHoldingsByCoin(mockUser, mockBtcCoin);

      // Net amount: 1.0 - 0.5 + 0.3 = 0.8
      expect(result.totalAmount).toBe(0.8);
    });

    it('should handle no orders (zero holdings)', async () => {
      orderRepository.find.mockResolvedValue([]);

      const result = await (service as any).getHoldingsByCoin(mockUser, mockBtcCoin);

      expect(result.totalAmount).toBe(0);
      expect(result.averageBuyPrice).toBe(0);
      expect(result.currentValue).toBe(0);
      expect(result.profitLoss).toBe(0);
      expect(result.profitLossPercent).toBe(0);
      expect(result.exchanges).toHaveLength(0);
    });

    it('should calculate profit/loss correctly', async () => {
      const buyOrders = [
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.5,
          price: 38000,
          cost: 19000
        } as Order
      ];

      orderRepository.find.mockResolvedValue(buyOrders);

      const result = await (service as any).getHoldingsByCoin(mockUser, mockBtcCoin);

      const invested = 0.5 * 38000; // 19000
      const currentValue = 0.5 * 43250.5; // 21625.25
      const profitLoss = currentValue - invested; // 2625.25
      const profitLossPercent = (profitLoss / invested) * 100; // 13.82%

      expect(result.currentValue).toBeCloseTo(21625.25, 2);
      expect(result.profitLoss).toBeCloseTo(2625.25, 2);
      expect(result.profitLossPercent).toBeCloseTo(13.82, 2);
    });

    it('should provide per-exchange breakdown', async () => {
      const orders = [
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.3,
          price: 40000,
          cost: 12000,
          transactTime: new Date('2024-01-01')
        } as Order,
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockCoinbaseExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.2,
          price: 45000,
          cost: 9000,
          transactTime: new Date('2024-01-02')
        } as Order
      ];

      orderRepository.find.mockResolvedValue(orders);

      const result = await (service as any).getHoldingsByCoin(mockUser, mockBtcCoin);

      expect(result.exchanges).toHaveLength(2);

      const binanceHolding = result.exchanges.find((e: any) => e.exchangeName === 'Binance');
      expect(binanceHolding).toBeDefined();
      expect(binanceHolding.amount).toBe(0.3);
      expect(binanceHolding.lastSynced).toEqual(new Date('2024-01-01'));

      const coinbaseHolding = result.exchanges.find((e: any) => e.exchangeName === 'Coinbase');
      expect(coinbaseHolding).toBeDefined();
      expect(coinbaseHolding.amount).toBe(0.2);
      expect(coinbaseHolding.lastSynced).toEqual(new Date('2024-01-02'));
    });

    it('should handle partial fills and multiple orders per exchange', async () => {
      const orders = [
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.3,
          price: 40000,
          cost: 12000,
          transactTime: new Date('2024-01-01')
        } as Order,
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.2,
          price: 42000,
          cost: 8400,
          transactTime: new Date('2024-01-03')
        } as Order,
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.SELL,
          executedQuantity: 0.1,
          price: 45000,
          cost: 4500,
          transactTime: new Date('2024-01-04')
        } as Order
      ];

      orderRepository.find.mockResolvedValue(orders);

      const result = await (service as any).getHoldingsByCoin(mockUser, mockBtcCoin);

      // Net for Binance: 0.3 + 0.2 - 0.1 = 0.4
      expect(result.totalAmount).toBe(0.4);

      const binanceHolding = result.exchanges.find((e: any) => e.exchangeName === 'Binance');
      expect(binanceHolding.amount).toBe(0.4);
      expect(binanceHolding.lastSynced).toEqual(new Date('2024-01-04')); // Most recent transaction
    });

    it('should exclude exchanges with zero holdings', async () => {
      const orders = [
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.5,
          price: 40000,
          cost: 20000
        } as Order,
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockBinanceExchange,
          side: OrderSide.SELL,
          executedQuantity: 0.5,
          price: 45000,
          cost: 22500
        } as Order,
        {
          ...mockOrder,
          baseCoin: mockBtcCoin,
          exchange: mockCoinbaseExchange,
          side: OrderSide.BUY,
          executedQuantity: 0.2,
          price: 43000,
          cost: 8600
        } as Order
      ];

      orderRepository.find.mockResolvedValue(orders);

      const result = await (service as any).getHoldingsByCoin(mockUser, mockBtcCoin);

      // Binance has 0 net holdings, should be excluded
      expect(result.totalAmount).toBeCloseTo(0.2, 10);
      expect(result.exchanges).toHaveLength(1);
      expect(result.exchanges[0].exchangeName).toBe('Coinbase');
    });
  });
});
