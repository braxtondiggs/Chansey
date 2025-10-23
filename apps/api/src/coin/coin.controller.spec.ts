import { HttpModule } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CoinController, CoinsController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';

import { ExchangeService } from '../exchange/exchange.service';
import { OrderService } from '../order/order.service';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PortfolioHistoricalPriceTask } from '../portfolio/tasks/portfolio-historical-price.task';
import { PriceService } from '../price/price.service';

describe('CoinController', () => {
  let controller: CoinController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoinController],
      providers: [
        CoinService,
        {
          provide: getRepositoryToken(Coin),
          useValue: {
            find: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            save: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            delete: jest.fn(() => ({}))
          }
        },
        {
          provide: OrderService,
          useValue: {
            getHoldingsByCoin: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Portfolio),
          useValue: {
            find: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            save: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            delete: jest.fn(() => ({}))
          }
        },
        {
          provide: ExchangeService,
          useValue: {
            findAll: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            findBySlug: jest.fn(() => ({})),
            create: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            remove: jest.fn(() => ({}))
          }
        },
        PortfolioService,
        {
          provide: PortfolioHistoricalPriceTask,
          useValue: {
            addUpdateHistoricalPriceJob: jest.fn(),
            process: jest.fn()
          }
        },
        {
          provide: PriceService,
          useValue: {
            getPrices: jest.fn(() => []),
            getPrice: jest.fn(() => ({})),
            getPriceBySymbol: jest.fn(() => ({})),
            createPrice: jest.fn(() => ({})),
            getSummary: jest.fn(() => [])
          }
        },
        {
          provide: 'BullQueue_coin-queue',
          useValue: {
            add: jest.fn(),
            getRepeatableJobs: jest.fn()
            // Add other methods as needed for your tests
          }
        },
        {
          provide: 'BullQueue_ticker-pairs-queue',
          useValue: {
            add: jest.fn(),
            getRepeatableJobs: jest.fn()
            // Add other methods as needed for your tests
          }
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn()
          }
        }
      ],
      imports: [ConfigModule, HttpModule]
    }).compile();

    controller = module.get<CoinController>(CoinController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

/**
 * COIN DETAIL PAGE TESTS (T004-T007)
 * These tests validate the new coin detail page endpoints
 */
describe('CoinController - Detail Page Endpoints (TDD)', () => {
  let controller: CoinsController;
  let coinService: jest.Mocked<CoinService>;
  let orderService: jest.Mocked<OrderService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com'
  };

  const mockCoinDetail = {
    id: 'coin-uuid-123',
    slug: 'bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    imageUrl: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    currentPrice: 43250.5,
    priceChange24h: 1250.75,
    priceChange24hPercent: 2.98,
    marketCap: 845000000000,
    marketCapRank: 1,
    volume24h: 28500000000,
    circulatingSupply: 19500000,
    totalSupply: 21000000,
    maxSupply: 21000000,
    description: 'Bitcoin is a decentralized cryptocurrency...',
    links: {
      homepage: ['https://bitcoin.org'],
      blockchainSite: ['https://blockchain.com'],
      officialForumUrl: ['https://bitcointalk.org'],
      subredditUrl: 'https://reddit.com/r/bitcoin',
      repositoryUrl: ['https://github.com/bitcoin/bitcoin']
    },
    lastUpdated: new Date(),
    metadataLastUpdated: new Date()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoinsController],
      providers: [
        {
          provide: CoinService,
          useValue: {
            getCoinDetailBySlug: jest.fn(),
            getMarketChart: jest.fn(),
            getCoinBySlug: jest.fn()
          }
        },
        {
          provide: OrderService,
          useValue: {
            getHoldingsByCoin: jest.fn()
          }
        }
      ]
    }).compile();

    controller = module.get<CoinsController>(CoinsController);
    coinService = module.get<CoinService>(CoinService) as jest.Mocked<CoinService>;
    orderService = module.get<OrderService>(OrderService) as jest.Mocked<OrderService>;
  });

  /**
   * T004: GET /api/coins/:slug (unauthenticated)
   * Expected: These tests should FAIL because endpoint doesn't exist yet
   */
  describe('GET /coins/:slug (unauthenticated) - T004', () => {
    it('should return coin detail for valid slug', async () => {
      jest.spyOn(coinService, 'getCoinDetailBySlug').mockResolvedValue(mockCoinDetail as any);

      // This will fail - getCoinDetail method doesn't exist yet
      const result = await (controller as any).getCoinDetail('bitcoin', { user: undefined });

      expect(result).toBeDefined();
      expect(result.slug).toBe('bitcoin');
      expect(result.name).toBe('Bitcoin');
    });

    it('should not include userHoldings for unauthenticated user', async () => {
      jest.spyOn(coinService, 'getCoinDetailBySlug').mockResolvedValue(mockCoinDetail as any);

      const result = await (controller as any).getCoinDetail('bitcoin', { user: undefined });

      expect(result.userHoldings).toBeUndefined();
    });

    it('should throw NotFoundException for invalid slug', async () => {
      jest.spyOn(coinService, 'getCoinDetailBySlug').mockRejectedValue(new Error('Not found'));

      await expect((controller as any).getCoinDetail('invalid', { user: undefined })).rejects.toThrow();
    });
  });

  /**
   * T005: GET /api/coins/:slug (authenticated)
   * Expected: These tests should FAIL because endpoint doesn't exist yet
   */
  describe('GET /coins/:slug (authenticated) - T005', () => {
    it('should include userHoldings for authenticated user', async () => {
      const mockWithHoldings = {
        ...mockCoinDetail,
        userHoldings: {
          coinSymbol: 'BTC',
          totalAmount: 0.5,
          averageBuyPrice: 38000,
          currentValue: 21625.25,
          profitLoss: 2625.25,
          profitLossPercent: 13.82,
          exchanges: []
        }
      };

      jest.spyOn(coinService, 'getCoinDetailBySlug').mockResolvedValue(mockWithHoldings as any);

      const result = await (controller as any).getCoinDetail('bitcoin', { user: mockUser });

      expect(result.userHoldings).toBeDefined();
      expect(result.userHoldings.totalAmount).toBe(0.5);
    });
  });

  /**
   * T006: GET /api/coins/:slug/chart?period=X
   * Expected: These tests should FAIL because endpoint doesn't exist yet
   */
  describe('GET /coins/:slug/chart - T006', () => {
    const mockChartData = {
      coinSlug: 'bitcoin',
      period: '7d',
      prices: [
        { timestamp: 1697846400000, price: 42000.5 },
        { timestamp: 1697932800000, price: 42500.25 }
      ],
      timestamps: [1697846400000, 1697932800000],
      generatedAt: new Date()
    };

    it('should return chart data for 24h period', async () => {
      jest.spyOn(coinService, 'getMarketChart').mockResolvedValue({ ...mockChartData, period: '24h' } as any);

      const result = await (controller as any).getMarketChart('bitcoin', '24h');

      expect(result.period).toBe('24h');
      expect(result.prices).toBeDefined();
    });

    it('should return chart data for 7d period', async () => {
      jest.spyOn(coinService, 'getMarketChart').mockResolvedValue(mockChartData as any);

      const result = await (controller as any).getMarketChart('bitcoin', '7d');

      expect(result.period).toBe('7d');
    });

    it('should return chart data for 30d period', async () => {
      jest.spyOn(coinService, 'getMarketChart').mockResolvedValue({ ...mockChartData, period: '30d' } as any);

      const result = await (controller as any).getMarketChart('bitcoin', '30d');

      expect(result.period).toBe('30d');
    });

    it('should return chart data for 1y period', async () => {
      jest.spyOn(coinService, 'getMarketChart').mockResolvedValue({ ...mockChartData, period: '1y' } as any);

      const result = await (controller as any).getMarketChart('bitcoin', '1y');

      expect(result.period).toBe('1y');
    });

    it('should throw error for invalid period', async () => {
      jest.spyOn(coinService, 'getMarketChart').mockRejectedValue(new Error('Invalid period'));

      await expect((controller as any).getMarketChart('bitcoin', 'invalid')).rejects.toThrow();
    });
  });

  /**
   * T007: GET /api/coins/:slug/holdings (authenticated)
   * Expected: These tests should FAIL because endpoint doesn't exist yet
   */
  describe('GET /coins/:slug/holdings - T007', () => {
    it('should return user holdings for valid coin', async () => {
      const mockHoldings = {
        coinSymbol: 'BTC',
        totalAmount: 0.5,
        averageBuyPrice: 38000,
        currentValue: 21625.25,
        profitLoss: 2625.25,
        profitLossPercent: 13.82,
        exchanges: [{ exchangeName: 'Binance', amount: 0.3, lastSynced: new Date() }]
      };

      // This will fail - getHoldings method doesn't exist yet
      jest.spyOn(coinService, 'getCoinBySlug').mockResolvedValue({ id: 'coin-uuid-123', slug: 'bitcoin' } as any);
      jest.spyOn(orderService, 'getHoldingsByCoin').mockResolvedValue(mockHoldings as any);

      const result = await (controller as any).getHoldings('bitcoin', mockUser);

      expect(result).toBeDefined();
      expect(result.coinSymbol).toBe('BTC');
    });

    it('should throw error when user has no holdings', async () => {
      jest.spyOn(coinService, 'getCoinBySlug').mockResolvedValue(null);

      await expect((controller as any).getHoldings('bitcoin', mockUser)).rejects.toThrow(
        "Coin with slug 'bitcoin' not found"
      );
    });
  });
});
