import { Cache } from 'cache-manager';

import { RealtimeTickerService } from './realtime-ticker.service';

import { CoinService } from '../../coin/coin.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';

describe('RealtimeTickerService', () => {
  let service: RealtimeTickerService;
  let cache: jest.Mocked<Cache>;
  let exchangeManager: jest.Mocked<ExchangeManagerService>;
  let coinService: jest.Mocked<CoinService>;

  beforeEach(() => {
    cache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn()
    } as unknown as jest.Mocked<Cache>;

    exchangeManager = {
      getPublicClient: jest.fn()
    } as unknown as jest.Mocked<ExchangeManagerService>;

    coinService = {
      getCoinById: jest.fn(),
      updateCurrentPrice: jest.fn()
    } as unknown as jest.Mocked<CoinService>;

    service = new RealtimeTickerService(cache, exchangeManager, coinService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('getPrice returns cached value', async () => {
    const cached = {
      coinId: 'btc',
      symbol: 'BTC/USD',
      price: 10,
      change24h: 0,
      changePercent24h: 0,
      volume24h: 1,
      high24h: 11,
      low24h: 9,
      updatedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
      source: 'binance_us'
    };
    cache.get.mockResolvedValue(JSON.stringify(cached));

    const result = await service.getPrice('btc');

    expect(result?.price).toBe(10);
    expect(result?.updatedAt).toBeInstanceOf(Date);
    expect(coinService.getCoinById).not.toHaveBeenCalled();
  });

  it('getPrice returns null when coin missing', async () => {
    cache.get.mockResolvedValue(null);
    coinService.getCoinById.mockRejectedValue(new Error('missing'));

    const result = await service.getPrice('btc');

    expect(result).toBeNull();
  });

  it('getPrice fetches ticker and caches it', async () => {
    cache.get.mockResolvedValue(null);
    coinService.getCoinById.mockResolvedValue({ id: 'btc', symbol: 'btc' } as any);
    jest.spyOn(service as any, 'fetchTicker').mockResolvedValue({
      symbol: 'BTC/USD',
      price: 20,
      change24h: 1,
      changePercent24h: 5,
      volume24h: 100,
      high24h: 22,
      low24h: 19,
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      source: 'binance_us'
    });

    const result = await service.getPrice('btc');

    expect(result?.price).toBe(20);
    expect(cache.set).toHaveBeenCalled();
  });

  it('getPrices mixes cached and fetched prices', async () => {
    const cached = {
      coinId: 'btc',
      symbol: 'BTC/USD',
      price: 10,
      change24h: 0,
      changePercent24h: 0,
      volume24h: 1,
      high24h: 11,
      low24h: 9,
      updatedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
      source: 'binance_us'
    };

    cache.get.mockResolvedValueOnce(JSON.stringify(cached)).mockResolvedValueOnce(null);
    coinService.getCoinById.mockResolvedValueOnce({ id: 'eth', symbol: 'eth' } as any);
    jest.spyOn(service as any, 'fetchTicker').mockResolvedValue({
      symbol: 'ETH/USD',
      price: 30,
      change24h: 0,
      changePercent24h: 0,
      volume24h: 1,
      high24h: 31,
      low24h: 29,
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      source: 'binance_us'
    });

    const result = await service.getPrices(['btc', 'eth']);

    expect(result.get('btc')?.price).toBe(10);
    expect(result.get('eth')?.price).toBe(30);
    expect(cache.set).toHaveBeenCalled();
  });

  it('refreshPrice clears cache and calls getPrice', async () => {
    const getSpy = jest.spyOn(service, 'getPrice').mockResolvedValue(null);

    await service.refreshPrice('btc');

    expect(cache.del).toHaveBeenCalled();
    expect(getSpy).toHaveBeenCalledWith('btc');
  });

  it('syncCoinCurrentPrice updates current price when ticker exists', async () => {
    jest.spyOn(service, 'getPrice').mockResolvedValue({
      coinId: 'btc',
      symbol: 'BTC/USD',
      price: 50,
      change24h: 0,
      changePercent24h: 0,
      volume24h: 1,
      high24h: 51,
      low24h: 49,
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      source: 'binance_us'
    });

    await service.syncCoinCurrentPrice('btc');

    expect(coinService.updateCurrentPrice).toHaveBeenCalledWith('btc', 50);
  });

  it('syncCoinCurrentPrices updates all prices', async () => {
    jest.spyOn(service, 'getPrices').mockResolvedValue(
      new Map([
        [
          'btc',
          {
            coinId: 'btc',
            symbol: 'BTC/USD',
            price: 50,
            change24h: 0,
            changePercent24h: 0,
            volume24h: 1,
            high24h: 51,
            low24h: 49,
            updatedAt: new Date('2024-01-01T00:00:00Z'),
            source: 'binance_us'
          }
        ],
        [
          'eth',
          {
            coinId: 'eth',
            symbol: 'ETH/USD',
            price: 70,
            change24h: 0,
            changePercent24h: 0,
            volume24h: 1,
            high24h: 71,
            low24h: 69,
            updatedAt: new Date('2024-01-01T00:00:00Z'),
            source: 'binance_us'
          }
        ]
      ])
    );

    await service.syncCoinCurrentPrices(['btc', 'eth']);

    expect(coinService.updateCurrentPrice).toHaveBeenCalledTimes(2);
    expect(coinService.updateCurrentPrice).toHaveBeenCalledWith('btc', 50);
    expect(coinService.updateCurrentPrice).toHaveBeenCalledWith('eth', 70);
  });

  it('getPrice uses kraken symbol mapping', async () => {
    cache.get.mockResolvedValue(null);
    coinService.getCoinById.mockResolvedValue({ id: 'btc', symbol: 'btc' } as any);

    const binanceClient = {
      markets: {},
      loadMarkets: jest.fn(),
      fetchTicker: jest.fn()
    };
    const gdaxClient = {
      markets: {},
      loadMarkets: jest.fn(),
      fetchTicker: jest.fn()
    };
    const krakenClient = {
      markets: { 'XBT/ZUSD': {} },
      loadMarkets: jest.fn(),
      fetchTicker: jest.fn().mockResolvedValue({ last: 42 })
    };

    exchangeManager.getPublicClient.mockImplementation(async (slug?: string) => {
      if (slug === 'binance_us') return binanceClient as any;
      if (slug === 'gdax') return gdaxClient as any;
      return krakenClient as any;
    });

    const result = await service.getPrice('btc');

    expect(result?.price).toBe(42);
    expect(krakenClient.fetchTicker).toHaveBeenCalledWith('XBT/ZUSD');
  });
});
