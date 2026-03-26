import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { TradingService } from './trading.service';

import { BalanceService } from '../balance/balance.service';
import { CoinService } from '../coin/coin.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { ExchangeService } from '../exchange/exchange.service';
import { CCXT_DECIMAL_PLACES, CCXT_TICK_SIZE } from '../shared/precision.util';

describe('TradingService', () => {
  let service: TradingService;
  let balanceService: jest.Mocked<BalanceService>;
  let coinService: jest.Mocked<CoinService>;
  let exchangeKeyService: jest.Mocked<ExchangeKeyService>;
  let exchangeService: jest.Mocked<ExchangeService>;
  let exchangeManagerService: jest.Mocked<ExchangeManagerService>;

  const mockUser = { id: 'user-1' } as any;
  const mockCoin = { id: 'coin-1', name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin' } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingService,
        {
          provide: BalanceService,
          useValue: { getUserBalances: jest.fn() }
        },
        {
          provide: CoinService,
          useValue: { getCoinBySymbol: jest.fn() }
        },
        {
          provide: ExchangeKeyService,
          useValue: { findOne: jest.fn() }
        },
        {
          provide: ExchangeService,
          useValue: { findOne: jest.fn() }
        },
        {
          provide: ExchangeManagerService,
          useValue: { getExchangeService: jest.fn(), getPublicClient: jest.fn() }
        }
      ]
    }).compile();

    service = module.get(TradingService);
    balanceService = module.get(BalanceService);
    coinService = module.get(CoinService);
    exchangeKeyService = module.get(ExchangeKeyService);
    exchangeService = module.get(ExchangeService);
    exchangeManagerService = module.get(ExchangeManagerService);
  });

  // ---------------------------------------------------------------------------
  // getMarketLimits
  // ---------------------------------------------------------------------------
  describe('getMarketLimits', () => {
    const exchangeKeyId = '00000000-0000-0000-0000-000000000001';

    function setupMocks(opts: { market?: any; precisionMode?: number; exchangeKey?: any }) {
      const { market, precisionMode = CCXT_DECIMAL_PLACES, exchangeKey } = opts;

      exchangeKeyService.findOne.mockResolvedValue(
        exchangeKey ?? {
          id: exchangeKeyId,
          exchange: { slug: 'binance_us', name: 'Binance US' }
        }
      );

      const mockClient = {
        markets: market !== undefined ? { 'BTC/USDT': market } : null,
        precisionMode,
        loadMarkets: jest.fn().mockImplementation(async function (this: any) {
          this.markets = { 'BTC/USDT': market };
        })
      };

      exchangeManagerService.getExchangeService.mockReturnValue({
        getClient: jest.fn().mockResolvedValue(mockClient)
      } as any);
    }

    it('returns limits for a valid symbol with DECIMAL_PLACES mode', async () => {
      setupMocks({
        market: {
          limits: { amount: { min: 0.001, max: 9000 }, cost: { min: 10 } },
          precision: { amount: 3, price: 2 }
        },
        precisionMode: CCXT_DECIMAL_PLACES
      });

      const result = await service.getMarketLimits('BTC/USDT', exchangeKeyId, mockUser);
      expect(result.minQuantity).toBe(0.001);
      expect(result.maxQuantity).toBe(9000);
      expect(result.minCost).toBe(10);
      expect(result.quantityStep).toBeCloseTo(0.001);
      expect(result.priceStep).toBeCloseTo(0.01);
    });

    it('returns limits for a valid symbol with TICK_SIZE mode', async () => {
      setupMocks({
        market: {
          limits: { amount: { min: 0.001, max: 9000 }, cost: { min: 10 } },
          precision: { amount: 0.001, price: 0.01 }
        },
        precisionMode: CCXT_TICK_SIZE
      });

      const result = await service.getMarketLimits('BTC/USDT', exchangeKeyId, mockUser);
      expect(result.quantityStep).toBe(0.001);
      expect(result.priceStep).toBe(0.01);
    });

    it('throws NotFoundException when exchange key is not found', async () => {
      exchangeKeyService.findOne.mockResolvedValue(null as any);

      await expect(service.getMarketLimits('BTC/USDT', exchangeKeyId, mockUser)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for unavailable symbol', async () => {
      setupMocks({
        market: {
          limits: { amount: { min: 0.001 }, cost: { min: 10 } },
          precision: { amount: 3, price: 2 }
        }
      });

      await expect(service.getMarketLimits('ETH/USDT', exchangeKeyId, mockUser)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid symbol format', async () => {
      await expect(service.getMarketLimits('BTCUSDT', exchangeKeyId, mockUser)).rejects.toThrow(BadRequestException);
    });

    it('calls loadMarkets when client.markets is null', async () => {
      const market = {
        limits: { amount: { min: 0.01, max: 100 }, cost: { min: 1 } },
        precision: { amount: 2, price: 2 }
      };

      exchangeKeyService.findOne.mockResolvedValue({
        id: exchangeKeyId,
        exchange: { slug: 'binance_us', name: 'Binance US' }
      } as any);

      const loadMarkets = jest.fn().mockImplementation(async function (this: any) {
        this.markets = { 'BTC/USDT': market };
      });

      const mockClient = { markets: null, precisionMode: CCXT_DECIMAL_PLACES, loadMarkets };

      exchangeManagerService.getExchangeService.mockReturnValue({
        getClient: jest.fn().mockResolvedValue(mockClient)
      } as any);

      await service.getMarketLimits('BTC/USDT', exchangeKeyId, mockUser);
      expect(loadMarkets).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getTradingBalances
  // ---------------------------------------------------------------------------
  describe('getTradingBalances', () => {
    function setupExchangeClient(balances: Record<string, any>) {
      exchangeService.findOne.mockResolvedValue({ slug: 'binance_us', name: 'Binance US' } as any);
      exchangeManagerService.getExchangeService.mockReturnValue({
        getClient: jest.fn().mockResolvedValue({
          fetchBalance: jest.fn().mockResolvedValue(balances)
        })
      } as any);
    }

    it('returns CCXT balances when exchangeId is provided', async () => {
      setupExchangeClient({
        BTC: { free: 1.5, used: 0.5, total: 2 },
        info: {},
        free: {},
        used: {},
        total: {}
      });
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);

      const result = await service.getTradingBalances(mockUser, 'exchange-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        coin: { id: 'coin-1', name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin' },
        available: 1.5,
        locked: 0.5,
        total: 2
      });
    });

    it('skips CCXT meta keys (info, free, used, total, timestamp, datetime)', async () => {
      setupExchangeClient({
        BTC: { free: 1, used: 0, total: 1 },
        info: { someData: true },
        free: { BTC: 1 },
        used: { BTC: 0 },
        total: { BTC: 1 },
        timestamp: 12345,
        datetime: '2024-01-01'
      });
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);

      const result = await service.getTradingBalances(mockUser, 'exchange-1');
      expect(result).toHaveLength(1);
      expect(result[0].coin.symbol).toBe('BTC');
    });

    it('skips assets with zero or negative total balance', async () => {
      setupExchangeClient({
        BTC: { free: 0, used: 0, total: 0 },
        ETH: { free: -1, used: 0, total: -1 }
      });
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);

      const result = await service.getTradingBalances(mockUser, 'exchange-1');
      expect(result).toHaveLength(0);
    });

    it('skips assets where coin is not found in database', async () => {
      setupExchangeClient({
        UNKNOWN: { free: 10, used: 0, total: 10 }
      });
      coinService.getCoinBySymbol.mockResolvedValue(null as any);

      const result = await service.getTradingBalances(mockUser, 'exchange-1');
      expect(result).toHaveLength(0);
    });

    it('falls back to DB balances when CCXT fetch fails', async () => {
      exchangeService.findOne.mockRejectedValue(new Error('Exchange not found'));
      balanceService.getUserBalances.mockResolvedValue({
        current: [
          {
            id: 'exchange-1',
            balances: [{ asset: 'BTC', free: '2.0', locked: '0.5' }]
          }
        ]
      } as any);
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);

      const result = await service.getTradingBalances(mockUser, 'exchange-1');
      expect(result).toHaveLength(1);
      expect(result[0].available).toBe(2);
      expect(result[0].locked).toBe(0.5);
      expect(result[0].total).toBe(2.5);
    });

    it('uses DB balances when no exchangeId is provided', async () => {
      balanceService.getUserBalances.mockResolvedValue({
        current: [
          {
            id: 'ex-1',
            balances: [{ asset: 'BTC', free: '1.0', locked: '0.0' }]
          }
        ]
      } as any);
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);

      const result = await service.getTradingBalances(mockUser);
      expect(result).toHaveLength(1);
      expect(result[0].total).toBe(1);
    });

    it('throws NotFoundException when exchangeId filter yields no results from DB', async () => {
      balanceService.getUserBalances.mockResolvedValue({ current: [] } as any);

      await expect(service.getTradingBalances(mockUser, 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // getOrderBook
  // ---------------------------------------------------------------------------
  describe('getOrderBook', () => {
    function setupPublicClient(overrides: Partial<Record<string, any>> = {}) {
      const mockClient = {
        markets: {
          'BTC/USDT': { active: true, ...overrides.marketOverrides }
        },
        loadMarkets: jest.fn(),
        fetchOrderBook: jest.fn().mockResolvedValue({
          bids: [[50000, 1.5]],
          asks: [[50100, 2.0]],
          datetime: '2024-01-01T00:00:00Z',
          ...overrides.orderBook
        }),
        ...overrides.client
      };
      exchangeManagerService.getPublicClient.mockResolvedValue(mockClient as any);
      return mockClient;
    }

    it('returns mapped order book for a valid symbol', async () => {
      setupPublicClient();

      const result = await service.getOrderBook('BTC/USDT');

      expect(result.bids).toHaveLength(1);
      expect(result.bids[0]).toEqual({ price: 50000, quantity: 1.5, total: 75000 });
      expect(result.asks).toHaveLength(1);
      expect(result.asks[0]).toEqual({ price: 50100, quantity: 2.0, total: 100200 });
      expect(result.lastUpdated).toEqual(new Date('2024-01-01T00:00:00Z'));
    });

    it('uses current date when datetime is missing', async () => {
      setupPublicClient({ orderBook: { bids: [], asks: [], datetime: null } });

      const before = Date.now();
      const result = await service.getOrderBook('BTC/USDT');
      const after = Date.now();

      expect(result.lastUpdated.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.lastUpdated.getTime()).toBeLessThanOrEqual(after);
    });

    it('throws BadRequestException for invalid symbol format', async () => {
      await expect(service.getOrderBook('BTCUSDT')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when symbol is not available on exchange', async () => {
      setupPublicClient();

      await expect(service.getOrderBook('ETH/USDT')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when market is suspended', async () => {
      const mockClient = {
        markets: { 'BTC/USDT': { active: false } },
        loadMarkets: jest.fn(),
        fetchOrderBook: jest.fn()
      };
      exchangeManagerService.getPublicClient.mockResolvedValue(mockClient as any);

      await expect(service.getOrderBook('BTC/USDT')).rejects.toThrow(BadRequestException);
    });

    it('loads markets when not yet loaded', async () => {
      const loadMarkets = jest.fn().mockImplementation(async function (this: any) {
        this.markets = { 'BTC/USDT': { active: true } };
      });
      const mockClient = {
        markets: null,
        loadMarkets,
        fetchOrderBook: jest.fn().mockResolvedValue({ bids: [], asks: [], datetime: null })
      };
      exchangeManagerService.getPublicClient.mockResolvedValue(mockClient as any);

      await service.getOrderBook('BTC/USDT');
      expect(loadMarkets).toHaveBeenCalled();
    });

    it('wraps non-BadRequestException errors', async () => {
      const mockClient = {
        markets: { 'BTC/USDT': { active: true } },
        loadMarkets: jest.fn(),
        fetchOrderBook: jest.fn().mockRejectedValue(new Error('Insufficient funds'))
      };
      exchangeManagerService.getPublicClient.mockResolvedValue(mockClient as any);

      await expect(service.getOrderBook('BTC/USDT')).rejects.toThrow(BadRequestException);
    });

    it('uses specific exchange when exchangeId is provided', async () => {
      exchangeService.findOne.mockResolvedValue({ slug: 'coinbase', name: 'Coinbase' } as any);
      exchangeManagerService.getExchangeService.mockReturnValue({
        getClient: jest.fn().mockResolvedValue({
          markets: { 'BTC/USDT': { active: true } },
          loadMarkets: jest.fn(),
          fetchOrderBook: jest.fn().mockResolvedValue({ bids: [], asks: [], datetime: null })
        })
      } as any);

      const result = await service.getOrderBook('BTC/USDT', 'exchange-1');
      expect(result.bids).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getTicker
  // ---------------------------------------------------------------------------
  describe('getTicker', () => {
    function setupTicker(tickerData: Record<string, any> = {}) {
      const mockClient = {
        fetchTicker: jest.fn().mockResolvedValue({
          last: 50000,
          change: 500,
          percentage: 1.01,
          high: 51000,
          low: 49000,
          baseVolume: 1000,
          quoteVolume: 50000000,
          open: 49500,
          previousClose: 49400,
          datetime: '2024-01-01T00:00:00Z',
          ...tickerData
        })
      };
      exchangeManagerService.getPublicClient.mockResolvedValue(mockClient as any);
      return mockClient;
    }

    it('returns all ticker fields when present', async () => {
      setupTicker();

      const result = await service.getTicker('BTC/USDT');

      expect(result).toEqual({
        symbol: 'BTC/USDT',
        price: 50000,
        priceChange: 500,
        priceChangePercent: 1.01,
        high24h: 51000,
        low24h: 49000,
        volume24h: 1000,
        quoteVolume24h: 50000000,
        openPrice: 49500,
        prevClosePrice: 49400,
        lastUpdated: new Date('2024-01-01T00:00:00Z')
      });
    });

    it('returns undefined for null optional fields', async () => {
      setupTicker({
        change: null,
        percentage: null,
        high: null,
        low: null,
        baseVolume: null,
        quoteVolume: null,
        open: null,
        previousClose: null
      });

      const result = await service.getTicker('BTC/USDT');

      expect(result.price).toBe(50000);
      expect(result.priceChange).toBeUndefined();
      expect(result.priceChangePercent).toBeUndefined();
      expect(result.high24h).toBeUndefined();
      expect(result.low24h).toBeUndefined();
      expect(result.volume24h).toBeUndefined();
      expect(result.quoteVolume24h).toBeUndefined();
      expect(result.openPrice).toBeUndefined();
      expect(result.prevClosePrice).toBeUndefined();
    });

    it('defaults price to 0 when last is null', async () => {
      setupTicker({ last: null });

      const result = await service.getTicker('BTC/USDT');
      expect(result.price).toBe(0);
    });

    it('throws BadRequestException for invalid symbol format', async () => {
      await expect(service.getTicker('BTCUSDT')).rejects.toThrow(BadRequestException);
    });

    it('re-throws errors from exchange', async () => {
      const mockClient = {
        fetchTicker: jest.fn().mockRejectedValue(new Error('Exchange down'))
      };
      exchangeManagerService.getPublicClient.mockResolvedValue(mockClient as any);

      await expect(service.getTicker('BTC/USDT')).rejects.toThrow('Exchange down');
    });
  });
});
