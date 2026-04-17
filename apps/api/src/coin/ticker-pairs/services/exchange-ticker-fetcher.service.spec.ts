import { ExchangeTickerFetcherService } from './exchange-ticker-fetcher.service';

import { type CoinGeckoClientService } from '../../../shared/coingecko-client.service';

const mockExchangeTickers = jest.fn();

// Pass-through retry wrapper so the tests observe real pagination / error behavior
jest.mock('../../../shared/retry.util', () => ({
  withRateLimitRetry: jest.fn(async (fn: () => Promise<any>) => {
    try {
      const result = await fn();
      return { success: true, result };
    } catch (error) {
      return { success: false, error };
    }
  })
}));

jest.useFakeTimers();

describe('ExchangeTickerFetcherService', () => {
  let service: ExchangeTickerFetcherService;
  let cache: { get: jest.Mock; set: jest.Mock };
  let gecko: CoinGeckoClientService;

  beforeEach(() => {
    jest.clearAllMocks();

    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined)
    };

    gecko = {
      client: {
        exchanges: {
          tickers: { get: mockExchangeTickers }
        }
      }
    } as unknown as CoinGeckoClientService;

    service = new ExchangeTickerFetcherService(gecko, cache as any);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('returns cached tickers on hit without hitting the API', async () => {
    const cachedTickers = [{ coin_id: 'bitcoin', target_coin_id: 'tether' }];
    cache.get.mockResolvedValue(cachedTickers);

    const result = await service.fetchAllTickersForExchange('binance');

    expect(result).toEqual(cachedTickers);
    expect(mockExchangeTickers).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('paginates CoinGecko on cache miss and caches the result', async () => {
    cache.get.mockResolvedValue(undefined);
    mockExchangeTickers
      .mockResolvedValueOnce({ tickers: [{ coin_id: 'bitcoin' }] })
      .mockResolvedValueOnce({ tickers: [{ coin_id: 'ethereum' }] })
      .mockResolvedValueOnce({ tickers: [] });

    const promise = service.fetchAllTickersForExchange('binance');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(mockExchangeTickers).toHaveBeenCalledTimes(3);
    expect(result).toEqual([{ coin_id: 'bitcoin' }, { coin_id: 'ethereum' }]);
    expect(cache.set).toHaveBeenCalledWith(
      'coingecko:exchange-tickers:binance',
      [{ coin_id: 'bitcoin' }, { coin_id: 'ethereum' }],
      expect.any(Number)
    );
  });

  it('maps coinbase slug to gdax when querying CoinGecko', async () => {
    mockExchangeTickers.mockResolvedValueOnce({ tickers: [] });

    const promise = service.fetchAllTickersForExchange('coinbase');
    await jest.runAllTimersAsync();
    await promise;

    expect(mockExchangeTickers).toHaveBeenCalledWith('gdax', { page: 1 });
  });

  it('returns empty array when first page fails (and does not cache)', async () => {
    mockExchangeTickers.mockRejectedValueOnce(new Error('upstream error'));

    const promise = service.fetchAllTickersForExchange('binance');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual([]);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('caches partial results when a later page fails', async () => {
    mockExchangeTickers
      .mockResolvedValueOnce({ tickers: [{ coin_id: 'bitcoin' }] })
      .mockRejectedValueOnce(new Error('page 2 error'));

    const promise = service.fetchAllTickersForExchange('binance');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual([{ coin_id: 'bitcoin' }]);
    expect(cache.set).toHaveBeenCalledWith(
      'coingecko:exchange-tickers:binance',
      [{ coin_id: 'bitcoin' }],
      expect.any(Number)
    );
  });

  it('falls back to API when cache read throws', async () => {
    cache.get.mockRejectedValue(new Error('redis down'));
    mockExchangeTickers.mockResolvedValueOnce({ tickers: [{ coin_id: 'bitcoin' }] });
    mockExchangeTickers.mockResolvedValueOnce({ tickers: [] });

    const promise = service.fetchAllTickersForExchange('binance');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual([{ coin_id: 'bitcoin' }]);
  });
});
