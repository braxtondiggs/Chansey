import { CoinDetailSyncService } from './coin-detail-sync.service';

import { type CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { type CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { type CoinService } from '../coin.service';

// Mock CoinGecko SDK calls
const mockMarkets = jest.fn();
const mockCoinId = jest.fn();
const mockTrending = jest.fn();

// Mock withRateLimitRetry to pass through
jest.mock('../../shared/retry.util', () => ({
  withRateLimitRetry: jest.fn(async (fn: () => Promise<any>) => {
    try {
      const result = await fn();
      return { success: true, result };
    } catch (error) {
      return { success: false, error };
    }
  })
}));

// Track the markets mapper
const mockMapMarkets = jest.fn().mockImplementation((entry: any) => ({ currentPrice: entry.current_price }));
jest.mock('./map-coingecko-markets.util', () => ({
  mapCoinGeckoMarketsToUpdate: (...args: any[]) => mockMapMarkets(...args)
}));

// Track the metadata mapper
const mockMapMetadata = jest.fn().mockImplementation(() => ({ description: 'refreshed' }));
jest.mock('./map-coingecko-detail.util', () => ({
  mapCoinGeckoDetailToMetadataUpdate: (...args: any[]) => mockMapMetadata(...args)
}));

jest.useFakeTimers();

describe('CoinDetailSyncService', () => {
  let service: CoinDetailSyncService;
  let coinService: jest.Mocked<Pick<CoinService, 'getCoins' | 'update' | 'clearRank'>>;
  let geckoService: CoinGeckoClientService;
  let circuitBreaker: jest.Mocked<
    Pick<CircuitBreakerService, 'configure' | 'isOpen' | 'recordSuccess' | 'recordFailure'>
  >;

  const makeCoin = (
    overrides: Partial<{
      id: string;
      slug: string;
      symbol: string;
      geckoRank: number | null;
      metadataLastUpdated: Date | null;
    }> = {}
  ) =>
    ({
      id: overrides.id ?? 'coin-1',
      slug: overrides.slug ?? 'bitcoin',
      symbol: overrides.symbol ?? 'btc',
      geckoRank: overrides.geckoRank ?? null,
      metadataLastUpdated: overrides.metadataLastUpdated ?? null
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTrending.mockResolvedValue({ coins: [] });

    coinService = {
      getCoins: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      clearRank: jest.fn()
    } as any;

    geckoService = {
      client: {
        coins: {
          getID: mockCoinId,
          markets: { get: mockMarkets }
        },
        search: {
          trending: { get: mockTrending }
        }
      }
    } as unknown as CoinGeckoClientService;

    circuitBreaker = {
      configure: jest.fn(),
      isOpen: jest.fn().mockReturnValue(false),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn()
    } as any;

    service = new CoinDetailSyncService(coinService as any, geckoService, circuitBreaker as any);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('syncCoinDetails (batched markets path)', () => {
    it('issues a single /coins/markets call for a 250-coin batch', async () => {
      const coins = Array.from({ length: 250 }, (_, i) =>
        makeCoin({ id: `c${i}`, slug: `coin-${i}`, symbol: `s${i}` })
      );
      coinService.getCoins.mockResolvedValue(coins);
      mockMarkets.mockResolvedValue(coins.map((c) => ({ id: c.slug, current_price: 100 })));

      const promise = service.syncCoinDetails();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(mockMarkets).toHaveBeenCalledTimes(1);
      expect(mockMarkets).toHaveBeenCalledWith(
        expect.objectContaining({
          vs_currency: 'usd',
          ids: expect.stringContaining('coin-0'),
          per_page: 250
        })
      );
      expect(result.totalCoins).toBe(250);
      expect(result.updatedSuccessfully).toBe(250);
      expect(result.errors).toBe(0);
    });

    it('splits >250 coins into multiple batches', async () => {
      const coins = Array.from({ length: 260 }, (_, i) =>
        makeCoin({ id: `c${i}`, slug: `coin-${i}`, symbol: `s${i}` })
      );
      coinService.getCoins.mockResolvedValue(coins);
      mockMarkets.mockImplementation(async (params: any) => {
        const ids = String(params.ids).split(',');
        return ids.map((id) => ({ id, current_price: 10 }));
      });

      const promise = service.syncCoinDetails();
      await jest.runAllTimersAsync();
      await promise;

      expect(mockMarkets).toHaveBeenCalledTimes(2);
    });

    it('passes the mapped markets entry, geckoRank, and symbol to the markets mapper', async () => {
      const coin = makeCoin({ id: 'c1', slug: 'bitcoin', symbol: 'btc', geckoRank: 7 });
      coinService.getCoins.mockResolvedValue([coin]);
      const marketsEntry = { id: 'bitcoin', current_price: 42000, market_cap: 1e12 };
      mockMarkets.mockResolvedValue([marketsEntry]);

      const promise = service.syncCoinDetails();
      await jest.runAllTimersAsync();
      await promise;

      expect(mockMapMarkets).toHaveBeenCalledWith(marketsEntry, 7, 'btc');
      expect(coinService.update).toHaveBeenCalledWith('c1', { currentPrice: 42000 });
    });

    it('counts batch-level API failure as all-coins-failed', async () => {
      const coins = [makeCoin({ id: 'c1', slug: 'coin-1', symbol: 's1' })];
      coinService.getCoins.mockResolvedValue(coins);
      mockMarkets.mockRejectedValue(new Error('API down'));

      const promise = service.syncCoinDetails();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ totalCoins: 1, updatedSuccessfully: 0, errors: 1 });
      expect(coinService.update).not.toHaveBeenCalled();
    });

    it('counts coins missing from the markets response as failures', async () => {
      const coins = [
        makeCoin({ id: 'c1', slug: 'coin-1', symbol: 's1' }),
        makeCoin({ id: 'c2', slug: 'coin-2', symbol: 's2' })
      ];
      coinService.getCoins.mockResolvedValue(coins);
      // Only one coin in response
      mockMarkets.mockResolvedValue([{ id: 'coin-1', current_price: 10 }]);

      const promise = service.syncCoinDetails();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ totalCoins: 2, updatedSuccessfully: 1, errors: 1 });
    });

    it('records circuit breaker success on successful batch and failure on batch API error', async () => {
      const coins = [makeCoin({ id: 'c1', slug: 'coin-1', symbol: 's1' })];
      coinService.getCoins.mockResolvedValue(coins);
      mockMarkets.mockResolvedValueOnce([{ id: 'coin-1', current_price: 10 }]);

      const promise = service.syncCoinDetails();
      await jest.runAllTimersAsync();
      await promise;

      expect(circuitBreaker.recordSuccess).toHaveBeenCalledWith('coingecko-detail');
    });

    it('applies trending rank scores to matching coins by slug', async () => {
      const btc = makeCoin({ id: 'btc-id', slug: 'bitcoin', symbol: 'btc' });
      const eth = makeCoin({ id: 'eth-id', slug: 'ethereum', symbol: 'eth' });
      coinService.getCoins.mockResolvedValue([btc, eth]);
      mockTrending.mockResolvedValue({
        coins: [{ id: 'bitcoin', score: 3 }]
      });
      mockMarkets.mockResolvedValue([
        { id: 'bitcoin', current_price: 100 },
        { id: 'ethereum', current_price: 50 }
      ]);

      const promise = service.syncCoinDetails();
      await jest.runAllTimersAsync();
      await promise;

      expect(btc.geckoRank).toBe(3);
      expect(eth.geckoRank).toBeNull();
    });

    it('handles trending fetch failure gracefully and still updates coins', async () => {
      const coin = makeCoin({ id: 'c1', slug: 'coin-1', symbol: 's1' });
      coinService.getCoins.mockResolvedValue([coin]);
      mockTrending.mockRejectedValue(new Error('Trending API down'));
      mockMarkets.mockResolvedValue([{ id: 'coin-1', current_price: 10 }]);

      const promise = service.syncCoinDetails();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.updatedSuccessfully).toBe(1);
    });

    it('returns zeroes when no coins exist', async () => {
      const result = await service.syncCoinDetails();

      expect(result).toEqual({ totalCoins: 0, updatedSuccessfully: 0, errors: 0 });
      expect(coinService.update).not.toHaveBeenCalled();
      expect(mockMarkets).not.toHaveBeenCalled();
    });

    it('reports progress through all stages', async () => {
      const coins = [makeCoin({ id: 'c1', slug: 'coin-1', symbol: 's1' })];
      coinService.getCoins.mockResolvedValue(coins);
      mockMarkets.mockResolvedValue([{ id: 'coin-1', current_price: 10 }]);

      const progress = jest.fn();
      const promise = service.syncCoinDetails(progress);
      await jest.runAllTimersAsync();
      await promise;

      const calls = progress.mock.calls.map(([v]: [number]) => v);
      expect(calls[0]).toBe(5);
      expect(calls[calls.length - 1]).toBe(100);
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
    });

    it('pauses with backoff when circuit opens, then resumes', async () => {
      const coins = Array.from({ length: 251 }, (_, i) =>
        makeCoin({ id: `c${i}`, slug: `coin-${i}`, symbol: `s${i}` })
      );
      coinService.getCoins.mockResolvedValue(coins);
      mockMarkets.mockImplementation(async (params: any) => {
        const ids = String(params.ids).split(',');
        return ids.map((id) => ({ id, current_price: 1 }));
      });

      let circuitCallCount = 0;
      circuitBreaker.isOpen.mockImplementation(() => {
        circuitCallCount++;
        return circuitCallCount === 2; // open between batch 1 and batch 2, closed after
      });

      const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');

      const promise = service.syncCoinDetails();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.totalCoins).toBe(251);
      expect(result.updatedSuccessfully).toBe(251);
      const circuitPauseDelays = setTimeoutSpy.mock.calls
        .map(([, ms]) => ms)
        .filter((ms): ms is number => typeof ms === 'number' && ms >= 45_000);
      expect(circuitPauseDelays[0]).toBe(45_000);

      setTimeoutSpy.mockRestore();
    });
  });

  describe('syncCoinMetadata', () => {
    it('clears rank data before processing coins', async () => {
      await service.syncCoinMetadata();

      expect(coinService.clearRank).toHaveBeenCalled();
    });

    it('refreshes coins with stale metadata and persists metadataLastUpdated', async () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      const staleCoin = makeCoin({ id: 'c1', slug: 'coin-1', symbol: 's1', metadataLastUpdated: oldDate });
      coinService.getCoins.mockResolvedValue([staleCoin]);
      mockCoinId.mockResolvedValue({ description: { en: 'refreshed' }, genesis_date: '2009-01-03' });

      const promise = service.syncCoinMetadata();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(mockCoinId).toHaveBeenCalledWith('coin-1', expect.any(Object));
      expect(coinService.update).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          description: 'refreshed',
          metadataLastUpdated: expect.any(Date)
        })
      );
      expect(result.updatedSuccessfully).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('skips coins whose metadata was refreshed within 25 days', async () => {
      const freshDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      coinService.getCoins.mockResolvedValue([
        makeCoin({ id: 'c-fresh', slug: 'fresh', symbol: 'fr', metadataLastUpdated: freshDate }),
        makeCoin({ id: 'c-old', slug: 'old', symbol: 'ol', metadataLastUpdated: oldDate })
      ]);
      mockCoinId.mockResolvedValue({ description: { en: 'x' } });

      const promise = service.syncCoinMetadata();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(mockCoinId).toHaveBeenCalledTimes(1);
      expect(mockCoinId).toHaveBeenCalledWith('old', expect.any(Object));
      expect(result.updatedSuccessfully).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('treats null metadataLastUpdated as stale', async () => {
      const coin = makeCoin({ id: 'c-null', slug: 'never', symbol: 'nv', metadataLastUpdated: null });
      coinService.getCoins.mockResolvedValue([coin]);
      mockCoinId.mockResolvedValue({ description: { en: 'x' } });

      const promise = service.syncCoinMetadata();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(mockCoinId).toHaveBeenCalledTimes(1);
      expect(result.updatedSuccessfully).toBe(1);
    });

    it('records API failures without throwing', async () => {
      const staleCoin = makeCoin({ id: 'c1', slug: 'coin-1', symbol: 's1', metadataLastUpdated: null });
      coinService.getCoins.mockResolvedValue([staleCoin]);
      mockCoinId.mockRejectedValue(new Error('Rate limited'));

      const promise = service.syncCoinMetadata();
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.errors).toBe(1);
      expect(result.updatedSuccessfully).toBe(0);
    });

    it('returns zeroes when nothing needs refresh', async () => {
      const freshDate = new Date();
      coinService.getCoins.mockResolvedValue([
        makeCoin({ id: 'c1', slug: 'bitcoin', symbol: 'btc', metadataLastUpdated: freshDate })
      ]);

      const result = await service.syncCoinMetadata();

      expect(mockCoinId).not.toHaveBeenCalled();
      expect(result).toEqual({ totalCoins: 1, updatedSuccessfully: 0, skipped: 1, errors: 0 });
    });
  });
});
