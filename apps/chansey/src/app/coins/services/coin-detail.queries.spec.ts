import { injectQueryClient } from '@tanstack/angular-query-experimental';

import * as shared from '@chansey/shared';
import { TIME, queryKeys, STANDARD_POLICY, REALTIME_POLICY, STABLE_POLICY } from '@chansey/shared';

import { CoinDetailQueries } from './coin-detail.queries';

jest.mock('@tanstack/angular-query-experimental', () => ({
  injectQueryClient: jest.fn()
}));

describe('CoinDetailQueries', () => {
  const queryClientMock = {
    prefetchQuery: jest.fn().mockResolvedValue(undefined),
    invalidateQueries: jest.fn().mockResolvedValue(undefined)
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (injectQueryClient as jest.Mock).mockReturnValue(queryClientMock);
  });

  it('creates detail query config with standard policy', async () => {
    const fetchSpy = jest.spyOn(shared, 'authenticatedFetch').mockResolvedValue({} as unknown);
    const service = new CoinDetailQueries();

    const query = service.useCoinDetailQuery('btc');
    expect(query.queryKey).toEqual(queryKeys.coins.detail('btc'));
    expect(query.staleTime).toBe(STANDARD_POLICY.staleTime);
    expect(query.enabled).toBe(true);

    await query.queryFn();
    expect(fetchSpy).toHaveBeenCalledWith('/api/coins/btc');
  });

  it('uses realtime policy for price query', () => {
    const service = new CoinDetailQueries();
    const query = service.useCoinPriceQuery('eth');

    expect(query.queryKey).toEqual(queryKeys.coins.price('eth'));
    expect(query.staleTime).toBe(REALTIME_POLICY.staleTime);
    expect(query.enabled).toBe(true);
  });

  it('applies stable policy override for history queries', () => {
    const service = new CoinDetailQueries();
    const query = service.useCoinHistoryQuery('ada', '24h');

    expect(query.queryKey).toEqual(queryKeys.coins.chart('ada', '24h'));
    expect(query.gcTime).toBe(TIME.MINUTES.m15);
    expect(query.staleTime).toBe(STABLE_POLICY.staleTime);
  });

  it('builds holdings query based on authentication', async () => {
    const fetchSpy = jest.spyOn(shared, 'authenticatedFetch').mockResolvedValue({ holdings: [] } as unknown);
    const service = new CoinDetailQueries();

    const authedQuery = service.useUserHoldingsQuery('sol', true);
    expect(authedQuery.queryKey).toEqual(queryKeys.coins.holdings('sol'));
    expect(authedQuery.staleTime).toBe(TIME.MINUTES.m2);
    expect(authedQuery.refetchInterval).toBe(TIME.MINUTES.m5);
    expect(authedQuery.enabled).toBe(true);
    await authedQuery.queryFn();
    expect(fetchSpy).toHaveBeenCalledWith('/api/coins/sol/holdings');

    const unauthQuery = service.useUserHoldingsQuery('sol', false);
    expect(unauthQuery.enabled).toBe(false);
    await expect(unauthQuery.queryFn()).rejects.toThrow('User not authenticated');
    expect(unauthQuery.retry).toBe(0);
  });

  it('prefetches and invalidates queries via query client', async () => {
    const service = new CoinDetailQueries();

    await service.prefetchCoinDetail('doge');
    expect(queryClientMock.prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryKeys.coins.detail('doge')
      })
    );

    await service.invalidateCoinQueries('doge');
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.coins.detail('doge') });

    await service.invalidateAllCoinQueries();
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.coins.all });
  });
});
