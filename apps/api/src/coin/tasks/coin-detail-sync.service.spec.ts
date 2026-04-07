import { CoinDetailSyncService } from './coin-detail-sync.service';

import { CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { CoinService } from '../coin.service';

// Mock CoinGecko SDK calls
const mockCoinId = jest.fn();
const mockTrending = jest.fn();

// Mock withRetry to pass through
jest.mock('../../shared/retry.util', () => ({
  withRetry: jest.fn(async (fn: () => Promise<any>) => {
    try {
      const result = await fn();
      return { success: true, result };
    } catch (error) {
      return { success: false, error };
    }
  })
}));

// Mock mapCoinGeckoDetailToUpdate to track calls
const mockMapDetail = jest.fn().mockReturnValue({ description: 'mapped' });
jest.mock('./map-coingecko-detail.util', () => ({
  mapCoinGeckoDetailToUpdate: (...args: any[]) => mockMapDetail(...args)
}));

jest.useFakeTimers();

describe('CoinDetailSyncService', () => {
  let service: CoinDetailSyncService;
  let coinService: jest.Mocked<Pick<CoinService, 'getCoins' | 'update' | 'clearRank'>>;
  let geckoService: CoinGeckoClientService;

  const makeCoin = (overrides: Partial<{ id: string; slug: string; symbol: string; geckoRank: number | null }> = {}) =>
    ({
      id: overrides.id ?? 'coin-1',
      slug: overrides.slug ?? 'bitcoin',
      symbol: overrides.symbol ?? 'btc',
      geckoRank: overrides.geckoRank ?? null
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();

    coinService = {
      getCoins: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      clearRank: jest.fn()
    } as any;

    geckoService = {
      client: {
        coins: {
          getID: mockCoinId
        },
        search: {
          trending: { get: mockTrending }
        }
      }
    } as unknown as CoinGeckoClientService;

    service = new CoinDetailSyncService(coinService as any, geckoService);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('clears rank data before processing coins', async () => {
    coinService.getCoins.mockResolvedValue([]);
    mockTrending.mockResolvedValue({ coins: [] });

    await service.syncCoinDetails();

    expect(coinService.clearRank).toHaveBeenCalled();
  });

  it('awaits clearRank before getCoins and applyTrendingRanks', async () => {
    const order: string[] = [];

    coinService.clearRank.mockImplementation(async () => {
      order.push('clearRank');
    });
    coinService.getCoins.mockImplementation(async () => {
      order.push('getCoins');
      return [];
    });
    mockTrending.mockImplementation(async () => {
      order.push('trending');
      return { coins: [] };
    });

    await service.syncCoinDetails();

    expect(order.indexOf('clearRank')).toBeLessThan(order.indexOf('getCoins'));
  });

  it('applies trending rank scores to matching coins by slug', async () => {
    const btc = makeCoin({ id: 'btc-id', slug: 'bitcoin', symbol: 'btc' });
    const eth = makeCoin({ id: 'eth-id', slug: 'ethereum', symbol: 'eth' });
    coinService.getCoins.mockResolvedValue([btc, eth]);
    mockTrending.mockResolvedValue({
      coins: [
        { id: 'bitcoin', score: 3 },
        { id: 'unknown-coin', score: 1 } // no match — should be ignored
      ]
    });
    mockCoinId.mockResolvedValue({ market_data: {} });

    const promise = service.syncCoinDetails();
    jest.runAllTimersAsync();
    await promise;

    expect(btc.geckoRank).toBe(3);
    expect(eth.geckoRank).toBeNull(); // not in trending
  });

  it('skips trending items with missing item.id', async () => {
    const btc = makeCoin({ slug: 'bitcoin' });
    coinService.getCoins.mockResolvedValue([btc]);
    mockTrending.mockResolvedValue({
      coins: [{}, { id: 'bitcoin', score: 5 }]
    });
    mockCoinId.mockResolvedValue({ market_data: {} });

    const promise = service.syncCoinDetails();
    jest.runAllTimersAsync();
    await promise;

    expect(btc.geckoRank).toBe(5);
  });

  it('passes gecko response, geckoRank, and symbol to mapping util', async () => {
    const coin = makeCoin({ id: 'c1', slug: 'bitcoin', symbol: 'btc', geckoRank: 7 });
    coinService.getCoins.mockResolvedValue([coin]);
    mockTrending.mockResolvedValue({ coins: [] });
    const geckoResponse = { market_data: { total_volume: { usd: 100 } } };
    mockCoinId.mockResolvedValue(geckoResponse);

    const promise = service.syncCoinDetails();
    jest.runAllTimersAsync();
    await promise;

    expect(mockMapDetail).toHaveBeenCalledWith(geckoResponse, 7, 'btc');
    expect(coinService.update).toHaveBeenCalledWith('c1', { description: 'mapped' });
  });

  it('skips coin update when withRetry reports failure', async () => {
    coinService.getCoins.mockResolvedValue([makeCoin({ id: 'c1', slug: 'fail-coin', symbol: 'fail' })]);
    mockTrending.mockResolvedValue({ coins: [] });
    mockCoinId.mockRejectedValue(new Error('Rate limited'));

    const promise = service.syncCoinDetails();
    jest.runAllTimersAsync();
    const result = await promise;

    expect(coinService.update).not.toHaveBeenCalled();
    expect(result).toEqual({ totalCoins: 1, updatedSuccessfully: 0, errors: 1 });
  });

  it('returns correct counts on mixed success/failure', async () => {
    const coins = [
      makeCoin({ id: 'c1', slug: 'ok-coin', symbol: 'ok' }),
      makeCoin({ id: 'c2', slug: 'bad-coin', symbol: 'bad' })
    ];
    coinService.getCoins.mockResolvedValue(coins);
    mockTrending.mockResolvedValue({ coins: [] });

    mockCoinId.mockImplementation((id: string) => {
      if (id === 'bad-coin') throw new Error('API error');
      return { market_data: {} };
    });

    const promise = service.syncCoinDetails();
    jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({
      totalCoins: 2,
      updatedSuccessfully: 1,
      errors: 1
    });
    // update should only be called for the successful coin
    expect(coinService.update).toHaveBeenCalledTimes(1);
  });

  it('counts error when coinService.update throws', async () => {
    coinService.getCoins.mockResolvedValue([makeCoin({ id: 'c1', slug: 'coin-1', symbol: 'sym' })]);
    mockTrending.mockResolvedValue({ coins: [] });
    mockCoinId.mockResolvedValue({ market_data: {} });
    coinService.update.mockRejectedValue(new Error('DB write failed'));

    const promise = service.syncCoinDetails();
    jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ totalCoins: 1, updatedSuccessfully: 0, errors: 1 });
  });

  it('handles trending fetch failure gracefully and still updates coins', async () => {
    coinService.getCoins.mockResolvedValue([makeCoin()]);
    mockTrending.mockRejectedValue(new Error('Trending API down'));
    mockCoinId.mockResolvedValue({ market_data: {} });

    const promise = service.syncCoinDetails();
    jest.runAllTimersAsync();
    const result = await promise;

    expect(result.updatedSuccessfully).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('returns zeroes when no coins exist', async () => {
    coinService.getCoins.mockResolvedValue([]);
    mockTrending.mockResolvedValue({ coins: [] });

    const result = await service.syncCoinDetails();

    expect(result).toEqual({ totalCoins: 0, updatedSuccessfully: 0, errors: 0 });
    expect(coinService.update).not.toHaveBeenCalled();
  });

  it('reports progress through all stages', async () => {
    coinService.getCoins.mockResolvedValue([makeCoin()]);
    mockTrending.mockResolvedValue({ coins: [] });
    mockCoinId.mockResolvedValue({ market_data: {} });

    const progress = jest.fn();
    const promise = service.syncCoinDetails(progress);
    jest.runAllTimersAsync();
    await promise;

    const calls = progress.mock.calls.map(([v]: [number]) => v);
    // Must start at 5, pass through 10, 30, and end at 100
    expect(calls[0]).toBe(5);
    expect(calls[1]).toBe(10);
    expect(calls[2]).toBe(30);
    expect(calls[calls.length - 1]).toBe(100);
    // All values should be monotonically non-decreasing
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
    }
  });
});
