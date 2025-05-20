import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Order, OrderStatus } from './order.entity';
import { OrderService } from './order.service';

import { CoinService } from '../coin/coin.service';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { BinanceUSService } from '../exchange/binance/binance-us.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { UsersService } from '../users/users.service';

describe('OrderService', () => {
  let service: OrderService;
  let orderRepository: Repository<Order>;

  // Mock data
  const mockUser = { id: '1', username: 'testuser' };
  const mockCoin = {
    id: '1',
    name: 'Bitcoin',
    symbol: 'BTC',
    slug: 'bitcoin',
    image: 'https://example.com/bitcoin.png'
  };

  const mockOrder = {
    id: '123',
    symbol: 'BTCUSDT',
    orderId: '456',
    clientOrderId: 'client123',
    transactTime: new Date(),
    quantity: 0.1,
    price: 50000,
    executedQuantity: 0.1,
    status: OrderStatus.NEW,
    side: 'BUY',
    type: 'MARKET',
    coin: mockCoin,
    user: mockUser,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  // Create mock repository
  const mockOrderRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    insert: jest.fn()
  };

  // Mock services
  const mockBinanceUSService = {};
  const mockCoinService = {};
  const mockTickerPairService = {};
  const mockExchangeKeyService = {};
  const mockUsersService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: getRepositoryToken(Order),
          useValue: mockOrderRepository
        },
        {
          provide: BinanceUSService,
          useValue: mockBinanceUSService
        },
        {
          provide: CoinService,
          useValue: mockCoinService
        },
        {
          provide: TickerPairService,
          useValue: mockTickerPairService
        },
        {
          provide: ExchangeKeyService,
          useValue: mockExchangeKeyService
        },
        {
          provide: UsersService,
          useValue: mockUsersService
        }
      ]
    }).compile();

    service = module.get<OrderService>(OrderService);
    orderRepository = module.get<Repository<Order>>(getRepositoryToken(Order));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOrders', () => {
    it('should return orders with correct format', async () => {
      // Setup repository mock to return a test order
      mockOrderRepository.find.mockResolvedValue([mockOrder]);

      // Call the method
      const result = await service.getOrders(mockUser as any);

      // Verify the result format
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id', mockOrder.id);
      expect(result[0].coin).toHaveProperty('logo', mockOrder.coin.image);
    });

    it('should handle errors and return empty array', async () => {
      // Setup repository to throw an error
      mockOrderRepository.find.mockRejectedValue(new Error('Database error'));

      // Create a spy on the logger
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      // Call the method
      const result = await service.getOrders(mockUser as any);

      // Verify error handling
      expect(loggerSpy).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('getOpenOrders', () => {
    it('should return only open orders with correct format', async () => {
      // Setup repository mock
      mockOrderRepository.find.mockResolvedValue([mockOrder]);

      // Call the method
      const result = await service.getOpenOrders(mockUser as any);

      // Verify result format and filtering
      expect(mockOrderRepository.find).toHaveBeenCalledWith({
        where: {
          user: { id: mockUser.id },
          status: OrderStatus.NEW
        },
        relations: ['coin'],
        order: { transactTime: 'DESC' }
      });

      expect(result).toHaveLength(1);
      expect(result[0].coin).toHaveProperty('logo');
    });
  });

  describe('getOrder', () => {
    it('should return a single order with correct format', async () => {
      // Setup repository mock
      mockOrderRepository.findOne.mockResolvedValue(mockOrder);

      // Call the method
      const result = await service.getOrder(mockUser as any, mockOrder.id);

      // Verify result format
      expect(result).toHaveProperty('id', mockOrder.id);
      expect(result.coin).toHaveProperty('logo', mockOrder.coin.image);
    });
  });
});
