import { CoinDetailSyncService } from './coin-detail-sync.service';

import { type CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { type CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { type CoinService } from '../coin.service';

// Mock CoinGecko SDK calls
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
  let circuitBreaker: jest.Mocked<
    Pick<CircuitBreakerService, 'configure' | 'isOpen' | 'recordSuccess' | 'recordFailure'>
  >;

  const makeCoin = (overrides: Partial<{ id: string; slug: string; symbol: string; geckoRank: number | null }> = {}) =>
    ({
      id: overrides.id ?? 'coin-1',
      slug: overrides.slug ?? 'bitcoin',
      symbol: overrides.symbol ?? 'btc',
      geckoRank: overrides.geckoRank ?? null
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
          getID: mockCoinId
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

  it('clears rank data before processing coins', async () => {
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
    await jest.runAllTimersAsync();
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
    await jest.runAllTimersAsync();
    await promise;

    expect(btc.geckoRank).toBe(5);
  });

  it('passes gecko response, geckoRank, and symbol to mapping util', async () => {
    const coin = makeCoin({ id: 'c1', slug: 'bitcoin', symbol: 'btc', geckoRank: 7 });
    coinService.getCoins.mockResolvedValue([coin]);
    const geckoResponse = { market_data: { total_volume: { usd: 100 } } };
    mockCoinId.mockResolvedValue(geckoResponse);

    const promise = service.syncCoinDetails();
    await jest.runAllTimersAsync();
    await promise;

    expect(mockMapDetail).toHaveBeenCalledWith(geckoResponse, 7, 'btc');
    expect(coinService.update).toHaveBeenCalledWith('c1', { description: 'mapped' });
  });

  it('skips coin update when withRateLimitRetry reports failure', async () => {
    coinService.getCoins.mockResolvedValue([makeCoin({ id: 'c1', slug: 'fail-coin', symbol: 'fail' })]);
    mockCoinId.mockRejectedValue(new Error('Rate limited'));

    const promise = service.syncCoinDetails();
    await jest.runAllTimersAsync();
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

    mockCoinId.mockImplementation(async (id: string) => {
      if (id === 'bad-coin') throw new Error('API error');
      return { market_data: {} };
    });

    const promise = service.syncCoinDetails();
    await jest.runAllTimersAsync();
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
    mockCoinId.mockResolvedValue({ market_data: {} });
    coinService.update.mockRejectedValue(new Error('DB write failed'));

    const promise = service.syncCoinDetails();
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ totalCoins: 1, updatedSuccessfully: 0, errors: 1 });
  });

  it('handles trending fetch failure gracefully and still updates coins', async () => {
    coinService.getCoins.mockResolvedValue([makeCoin()]);
    mockTrending.mockRejectedValue(new Error('Trending API down'));
    mockCoinId.mockResolvedValue({ market_data: {} });

    const promise = service.syncCoinDetails();
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.updatedSuccessfully).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('returns zeroes when no coins exist', async () => {
    const result = await service.syncCoinDetails();

    expect(result).toEqual({ totalCoins: 0, updatedSuccessfully: 0, errors: 0 });
    expect(coinService.update).not.toHaveBeenCalled();
  });

  it('reports progress through all stages', async () => {
    coinService.getCoins.mockResolvedValue([makeCoin()]);
    mockCoinId.mockResolvedValue({ market_data: {} });

    const progress = jest.fn();
    const promise = service.syncCoinDetails(progress);
    await jest.runAllTimersAsync();
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

  it('records circuit breaker success on API success and failure on API error', async () => {
    const coins = [
      makeCoin({ id: 'c1', slug: 'ok-coin', symbol: 'ok' }),
      makeCoin({ id: 'c2', slug: 'bad-coin', symbol: 'bad' })
    ];
    coinService.getCoins.mockResolvedValue(coins);

    mockCoinId.mockImplementation(async (id: string) => {
      if (id === 'bad-coin') throw new Error('API error');
      return { market_data: {} };
    });

    const promise = service.syncCoinDetails();
    await jest.runAllTimersAsync();
    await promise;

    expect(circuitBreaker.recordSuccess).toHaveBeenCalledWith('coingecko-detail');
    expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('coingecko-detail');
  });

  it('pauses with exponential backoff when circuit opens then resumes and processes all coins', async () => {
    const coins = [
      makeCoin({ id: 'c1', slug: 'coin-1', symbol: 's1' }),
      makeCoin({ id: 'c2', slug: 'coin-2', symbol: 's2' }),
      makeCoin({ id: 'c3', slug: 'coin-3', symbol: 's3' }),
      makeCoin({ id: 'c4', slug: 'coin-4', symbol: 's4' })
    ];
    coinService.getCoins.mockResolvedValue(coins);
    mockCoinId.mockResolvedValue({ market_data: {} });

    // Circuit opens after first batch, stays open for one check, then closes
    let circuitCallCount = 0;
    circuitBreaker.isOpen.mockImplementation(() => {
      circuitCallCount++;
      // Open on the 2nd call (before second batch), closed on retry
      return circuitCallCount === 2;
    });

    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');

    const promise = service.syncCoinDetails();
    await jest.runAllTimersAsync();
    const result = await promise;

    // All 4 coins should be processed — no abort
    expect(result.totalCoins).toBe(4);
    expect(result.updatedSuccessfully).toBe(4);
    expect(result.errors).toBe(0);

    // First circuit pause should be at base backoff (CIRCUIT_RESET_MS = 45s)
    const circuitPauseDelays = setTimeoutSpy.mock.calls
      .map(([, ms]) => ms)
      .filter((ms): ms is number => typeof ms === 'number' && ms >= 45_000);
    expect(circuitPauseDelays[0]).toBe(45_000);

    setTimeoutSpy.mockRestore();
  });

  it('resets backoff after successful batch', async () => {
    const coins = Array.from({ length: 9 }, (_, i) => makeCoin({ id: `c${i}`, slug: `coin-${i}`, symbol: `s${i}` }));
    coinService.getCoins.mockResolvedValue(coins);
    mockCoinId.mockResolvedValue({ market_data: {} });

    // Circuit opens twice with a success in between — second pause should reset to base backoff
    let isOpenCallCount = 0;
    circuitBreaker.isOpen.mockImplementation(() => {
      isOpenCallCount++;
      // Open before batch 2 (call 2) and before batch 3's retry (call 4)
      return isOpenCallCount === 2 || isOpenCallCount === 4;
    });

    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');

    const promise = service.syncCoinDetails();
    await jest.runAllTimersAsync();
    const result = await promise;

    // All coins processed despite two circuit pauses
    expect(result.totalCoins).toBe(9);
    expect(result.updatedSuccessfully).toBe(9);

    // Both pauses should be at base backoff (45s) since consecutivePauses resets between them
    const circuitPauses = setTimeoutSpy.mock.calls
      .map(([, ms]) => ms)
      .filter((ms): ms is number => typeof ms === 'number' && ms >= 45_000);
    expect(circuitPauses).toHaveLength(2);
    expect(circuitPauses.every((ms) => ms === 45_000)).toBe(true);

    setTimeoutSpy.mockRestore();
  });

  it('uses elevated batch delay after circuit pause, normalizes after 3 successes', async () => {
    // 4 batches of 3 = 12 coins. Circuit opens before batch 1.
    const coins = Array.from({ length: 12 }, (_, i) => makeCoin({ id: `c${i}`, slug: `coin-${i}`, symbol: `s${i}` }));
    coinService.getCoins.mockResolvedValue(coins);
    mockCoinId.mockResolvedValue({ market_data: {} });

    // Circuit open only on the very first check
    let isOpenCallCount = 0;
    circuitBreaker.isOpen.mockImplementation(() => {
      isOpenCallCount++;
      return isOpenCallCount === 1;
    });

    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');

    const promise = service.syncCoinDetails();
    await jest.runAllTimersAsync();
    await promise;

    const delays = setTimeoutSpy.mock.calls
      .map(([, ms]) => ms)
      .filter((ms): ms is number => typeof ms === 'number' && ms > 1000);

    // First timeout is the circuit pause (45s), then elevated delays (5s) until normalization
    expect(delays[0]).toBe(45_000); // circuit backoff
    // After circuit pause, first inter-batch delays should be elevated (5000ms)
    expect(delays.filter((t) => t === 5000).length).toBeGreaterThanOrEqual(1);

    setTimeoutSpy.mockRestore();
  });
});
