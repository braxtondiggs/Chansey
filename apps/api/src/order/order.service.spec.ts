import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { OrderDto } from './dto/order.dto';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { OrderService } from './order.service';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderValidationService } from './services/order-validation.service';

import { CoinService } from '../coin/coin.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { User } from '../users/users.entity';

describe('OrderService', () => {
  let service: OrderService;
  let orderRepository: jest.Mocked<Repository<Order>>;
  let exchangeManagerService: jest.Mocked<ExchangeManagerService>;
  let coinService: jest.Mocked<CoinService>;
  let orderValidationService: jest.Mocked<OrderValidationService>;
  let orderCalculationService: jest.Mocked<OrderCalculationService>;

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
          provide: ExchangeManagerService,
          useValue: {
            getExchangeClient: jest.fn()
          }
        },
        {
          provide: CoinService,
          useValue: {
            getCoinById: jest.fn(),
            getCoinBySymbol: jest.fn()
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
    exchangeManagerService = module.get(ExchangeManagerService);
    coinService = module.get(CoinService);
    orderValidationService = module.get(OrderValidationService);
    orderCalculationService = module.get(OrderCalculationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    const mockOrderDto: OrderDto = {
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      coinId: 'coin-btc',
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
      exchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient as any);
      orderValidationService.validateOrder.mockResolvedValue();
      mockExchangeClient.createOrder.mockResolvedValue(mockExchangeOrder);
      orderRepository.create.mockReturnValue(mockOrder);
      orderRepository.save.mockResolvedValue(mockOrder);
    });

    it('should create a buy order successfully', async () => {
      const result = await service.createOrder(mockOrderDto, mockUser);

      expect(coinService.getCoinById).toHaveBeenCalledWith('coin-btc');
      expect(coinService.getCoinBySymbol).toHaveBeenCalledWith('USDT');
      expect(exchangeManagerService.getExchangeClient).toHaveBeenCalledWith('binance_us', mockUser);
      expect(orderValidationService.validateOrder).toHaveBeenCalledWith(
        mockOrderDto,
        'BTC/USDT',
        mockExchangeClient
      );
      expect(mockExchangeClient.createOrder).toHaveBeenCalledWith(
        'BTC/USDT',
        'market',
        'buy',
        0.1,
        undefined
      );
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

      expect(mockExchangeClient.createOrder).toHaveBeenCalledWith(
        'BTC/USDT',
        'market',
        'sell',
        0.1,
        undefined
      );
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

      expect(mockExchangeClient.createOrder).toHaveBeenCalledWith(
        'BTC/USDT',
        'limit',
        'buy',
        0.1,
        55000
      );
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

      await service.createOrder(orderDtoWithQuote, mockUser);

      expect(coinService.getCoinById).toHaveBeenCalledWith('coin-busd');
      expect(mockExchangeClient.createOrder).toHaveBeenCalledWith(
        'BTC/BUSD',
        'market',
        'buy',
        0.1,
        undefined
      );
    });

    it('should throw BadRequestException for invalid coin ID', async () => {
      coinService.getCoinById.mockResolvedValue(null);

      await expect(service.createOrder(mockOrderDto, mockUser)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.createOrder(mockOrderDto, mockUser)).rejects.toThrow(
        'Invalid coin ID: coin-btc'
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

      await expect(service.createOrder(orderDtoWithInvalidQuote, mockUser)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException when USDT not found', async () => {
      coinService.getCoinBySymbol.mockResolvedValue(null);

      await expect(service.createOrder(mockOrderDto, mockUser)).rejects.toThrow(
        'USDT not found in system'
      );
    });

    it('should throw BadRequestException when validation fails', async () => {
      orderValidationService.validateOrder.mockRejectedValue(
        new BadRequestException('Insufficient balance')
      );

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
        relations: ['baseCoin', 'quoteCoin', 'exchange'],
        order: { createdAt: 'DESC' }
      });
      expect(result).toEqual([mockOrder]);
    });

    it('should apply status filter', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { status: OrderStatus.FILLED });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id }, status: OrderStatus.FILLED },
        relations: ['baseCoin', 'quoteCoin', 'exchange'],
        order: { createdAt: 'DESC' }
      });
    });

    it('should apply side filter', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { side: OrderSide.BUY });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id }, side: OrderSide.BUY },
        relations: ['baseCoin', 'quoteCoin', 'exchange'],
        order: { createdAt: 'DESC' }
      });
    });

    it('should apply limit', async () => {
      orderRepository.find.mockResolvedValue([mockOrder]);

      await service.getOrders(mockUser, { limit: 10 });

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id } },
        relations: ['baseCoin', 'quoteCoin', 'exchange'],
        order: { createdAt: 'DESC' },
        take: 10
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
      await expect(service.getOrder(mockUser, 'non-existent')).rejects.toThrow(
        'Order with ID non-existent not found'
      );
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
});
