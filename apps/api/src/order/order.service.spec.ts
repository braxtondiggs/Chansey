import { Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { OrderService } from './order.service';
import { OrderValidationService } from './services/order-validation.service';

import { CoinService } from '../coin/coin.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { User } from '../users/users.entity';

describe('OrderService', () => {
  let service: OrderService;
  let orderRepository: jest.Mocked<Repository<Order>>;
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
            validateOrder: jest.fn(),
            validateAlgorithmicOrderSize: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<OrderService>(OrderService);
    orderRepository = module.get(getRepositoryToken(Order));
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerErrorSpy.mockRestore();
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
});
