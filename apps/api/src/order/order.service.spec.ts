import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Order, OrderStatus } from './order.entity';
import { OrderService } from './order.service';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderSyncService } from './services/order-sync.service';
import { OrderValidationService } from './services/order-validation.service';

import { CoinService } from '../coin/coin.service';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { ExchangeService } from '../exchange/exchange.service';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

describe('OrderService', () => {
  let service: OrderService;

  // Mock data
  const mockUser: Partial<User> = { id: '1', email: 'test@example.com' };
  const mockBaseCoin = {
    id: '1',
    name: 'Bitcoin',
    symbol: 'BTC',
    slug: 'bitcoin',
    image: 'https://example.com/bitcoin.png'
  };

  const mockQuoteCoin = {
    id: '2',
    name: 'Tether USD',
    symbol: 'USDT',
    slug: 'tether',
    image: 'https://example.com/tether.png'
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
    baseCoin: mockBaseCoin,
    quoteCoin: mockQuoteCoin,
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
  const mockExchangeManagerService = {
    getBalance: jest.fn(),
    getExchangeClient: jest.fn()
  };
  const mockCoinService = {
    getCoinBySymbol: jest.fn(),
    getCoinById: jest.fn()
  };
  const mockTickerPairService = {};
  const mockExchangeKeyService = {};
  const mockExchangeService = {};
  const mockUsersService = {};
  const mockOrderValidationService = {};
  const mockOrderCalculationService = {
    extractCoinSymbol: jest.fn()
  };
  const mockOrderSyncService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: getRepositoryToken(Order),
          useValue: mockOrderRepository
        },
        {
          provide: ExchangeManagerService,
          useValue: mockExchangeManagerService
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
          provide: ExchangeService,
          useValue: mockExchangeService
        },
        {
          provide: UsersService,
          useValue: mockUsersService
        },
        {
          provide: OrderValidationService,
          useValue: mockOrderValidationService
        },
        {
          provide: OrderCalculationService,
          useValue: mockOrderCalculationService
        },
        {
          provide: OrderSyncService,
          useValue: mockOrderSyncService
        }
      ]
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOrders', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return orders with correct format', async () => {
      // Setup repository mock to return a test order
      mockOrderRepository.find.mockResolvedValue([mockOrder]);

      // Call the method
      const result = await service.getOrders(mockUser as User);

      // Verify repository was called with correct parameters
      expect(mockOrderRepository.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id } },
        relations: ['baseCoin', 'quoteCoin', 'exchange'],
        order: { transactTime: 'DESC' }
      });

      // Verify the result format
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id', mockOrder.id);
      expect(result[0]).toHaveProperty('symbol', mockOrder.symbol);
      expect(result[0]).toHaveProperty('baseCoin');
      expect(result[0]).toHaveProperty('quoteCoin');
      expect(result[0]).toHaveProperty('quantity', mockOrder.quantity);
      expect(result[0]).toHaveProperty('price', mockOrder.price);
      expect(result[0]).toHaveProperty('status', mockOrder.status);
      expect(result[0].baseCoin).toHaveProperty('image', mockOrder.baseCoin.image);
    });

    it('should handle errors and return empty array', async () => {
      // Setup repository to throw an error
      mockOrderRepository.find.mockRejectedValue(new Error('Database error'));

      // Create a spy on the logger
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      // Call the method
      const result = await service.getOrders(mockUser as User);

      // Verify error handling
      expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch orders: Database error', expect.any(String));
      expect(result).toEqual([]);

      // Clean up spy
      loggerSpy.mockRestore();
    });

    it('should return empty array when no orders found', async () => {
      // Setup repository to return empty array
      mockOrderRepository.find.mockResolvedValue([]);

      // Call the method
      const result = await service.getOrders(mockUser as User);

      // Verify result
      expect(result).toEqual([]);
      expect(mockOrderRepository.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenOrders', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return only open orders with correct format', async () => {
      // Setup repository mock
      mockOrderRepository.find.mockResolvedValue([mockOrder]);

      // Call the method
      const result = await service.getOpenOrders(mockUser as User);

      // Verify result format and filtering
      expect(mockOrderRepository.find).toHaveBeenCalledWith({
        where: {
          user: { id: mockUser.id },
          status: OrderStatus.NEW
        },
        relations: ['baseCoin', 'quoteCoin', 'exchange'],
        order: { transactTime: 'DESC' }
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('symbol', mockOrder.symbol);
      expect(result[0]).toHaveProperty('baseCoin');
      expect(result[0]).toHaveProperty('quoteCoin');
      expect(result[0]).toHaveProperty('status', OrderStatus.NEW);
    });

    it('should handle errors and return empty array', async () => {
      // Setup repository to throw an error
      mockOrderRepository.find.mockRejectedValue(new Error('Database connection failed'));

      // Create a spy on the logger
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      // Call the method
      const result = await service.getOpenOrders(mockUser as User);

      // Verify error handling
      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to fetch open orders: Database connection failed',
        expect.any(String)
      );
      expect(result).toEqual([]);

      // Clean up spy
      loggerSpy.mockRestore();
    });

    it('should return empty array when no open orders found', async () => {
      // Setup repository to return empty array
      mockOrderRepository.find.mockResolvedValue([]);

      // Call the method
      const result = await service.getOpenOrders(mockUser as User);

      // Verify result
      expect(result).toEqual([]);
      expect(mockOrderRepository.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOrder', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return a single order with correct format', async () => {
      // Setup repository mock
      mockOrderRepository.findOne.mockResolvedValue(mockOrder);

      // Call the method
      const result = await service.getOrder(mockUser as User, mockOrder.id);

      // Verify repository was called with correct parameters
      expect(mockOrderRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockOrder.id, user: { id: mockUser.id } },
        relations: ['baseCoin', 'quoteCoin', 'exchange']
      });

      // Verify result format
      expect(result).toHaveProperty('id', mockOrder.id);
      expect(result).toHaveProperty('symbol', mockOrder.symbol);
      expect(result).toHaveProperty('baseCoin');
      expect(result).toHaveProperty('quoteCoin');
      expect(result).toHaveProperty('quantity', mockOrder.quantity);
      expect(result).toHaveProperty('price', mockOrder.price);
      expect(result).toHaveProperty('status', mockOrder.status);
      expect(result.baseCoin).toHaveProperty('image', mockOrder.baseCoin.image);
    });

    it('should throw NotFoundCustomException when order not found', async () => {
      // Setup repository to return null
      mockOrderRepository.findOne.mockResolvedValue(null);

      // Call the method and expect it to throw
      await expect(service.getOrder(mockUser as User, 'non-existent-id')).rejects.toThrow(
        'Order with id: non-existent-id not found'
      );

      // Verify repository was called
      expect(mockOrderRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent-id', user: { id: mockUser.id } },
        relations: ['baseCoin', 'quoteCoin', 'exchange']
      });
    });

    it('should handle database errors gracefully', async () => {
      // Setup repository to throw an error
      mockOrderRepository.findOne.mockRejectedValue(new Error('Database timeout'));

      // Create a spy on the logger
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      // Call the method and expect it to throw NotFoundCustomException
      await expect(service.getOrder(mockUser as User, mockOrder.id)).rejects.toThrow('Order with id: 123 not found');

      // Verify error was logged
      expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch order 123', expect.any(Error));

      // Clean up spy
      loggerSpy.mockRestore();
    });
  });

  describe('loadMissingCoinInfo integration', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should load missing coin information when baseCoin or quoteCoin is null', async () => {
      // Create order with missing coin information
      const orderWithMissingCoins = {
        ...mockOrder,
        baseCoin: null,
        quoteCoin: null
      };

      // Setup repository mock
      mockOrderRepository.find.mockResolvedValue([orderWithMissingCoins]);

      // Setup coin service mocks
      mockCoinService.getCoinBySymbol
        .mockResolvedValueOnce(mockBaseCoin) // for base coin
        .mockResolvedValueOnce(mockQuoteCoin); // for quote coin

      // Setup calculation service mock
      mockOrderCalculationService.extractCoinSymbol.mockReturnValue({
        base: 'BTC',
        quote: 'USDT'
      });

      // Call the method
      const result = await service.getOrders(mockUser as User);

      // Verify coin service was called to fetch missing coins
      expect(mockOrderCalculationService.extractCoinSymbol).toHaveBeenCalledWith(mockOrder.symbol);
      expect(mockCoinService.getCoinBySymbol).toHaveBeenCalledWith('BTC', undefined, false);
      expect(mockCoinService.getCoinBySymbol).toHaveBeenCalledWith('USDT', undefined, false);

      // Verify result contains the loaded coins
      expect(result).toHaveLength(1);
      expect(result[0].baseCoin).toEqual(mockBaseCoin);
      expect(result[0].quoteCoin).toEqual(mockQuoteCoin);
    });
  });
});
