import { injectQueryClient } from '@tanstack/angular-query-experimental';

import * as shared from '@chansey/shared';
import { queryKeys, STANDARD_POLICY, STABLE_POLICY, STATIC_POLICY, FREQUENT_POLICY, TIME } from '@chansey/shared';

import { AlgorithmDetailQueries } from './algorithm-detail.queries';

jest.mock('@tanstack/angular-query-experimental', () => ({
  injectQueryClient: jest.fn()
}));

describe('AlgorithmDetailQueries', () => {
  const queryClientMock = {
    invalidateQueries: jest.fn().mockResolvedValue(undefined),
    prefetchQuery: jest.fn().mockResolvedValue(undefined)
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (injectQueryClient as jest.Mock).mockReturnValue(queryClientMock);
  });

  it('creates detail and performance query configs with correct policies', async () => {
    const fetchSpy = jest.spyOn(shared, 'authenticatedFetch').mockResolvedValue({} as unknown);
    const service = new AlgorithmDetailQueries();

    const detailQuery = service.useAlgorithmDetailQuery('123');
    expect(detailQuery.queryKey).toEqual(queryKeys.algorithms.detail('123'));
    expect(detailQuery.staleTime).toBe(STANDARD_POLICY.staleTime);
    await detailQuery.queryFn();
    expect(fetchSpy).toHaveBeenCalledWith('/api/algorithm/123');

    const performanceQuery = service.useAlgorithmPerformanceQuery('123');
    expect(performanceQuery.queryKey).toEqual(queryKeys.algorithms.performance('123'));
    expect(performanceQuery.staleTime).toBe(TIME.MINUTES.m2);
    expect(performanceQuery.gcTime).toBe(TIME.MINUTES.m10);
    expect(performanceQuery.refetchInterval).toBe(TIME.MINUTES.m5);
    expect(performanceQuery.retry).toBe(FREQUENT_POLICY.retry);
  });

  it('creates history and strategies queries with stable/static policies', () => {
    const service = new AlgorithmDetailQueries();

    const historyQuery = service.useAlgorithmPerformanceHistoryQuery('123', '24h');
    expect(historyQuery.queryKey).toEqual(queryKeys.algorithms.performanceHistory('123', '24h'));
    expect(historyQuery.staleTime).toBe(STABLE_POLICY.staleTime);
    expect(historyQuery.gcTime).toBe(TIME.MINUTES.m15);

    const strategiesQuery = service.useStrategiesQuery();
    expect(strategiesQuery.queryKey).toEqual(queryKeys.algorithms.strategies());
    expect(strategiesQuery.staleTime).toBe(STATIC_POLICY.staleTime);
    expect(strategiesQuery.enabled).toBe(true);
  });

  it('executes algorithm mutation and invalidates related queries', async () => {
    const fetchSpy = jest.spyOn(shared, 'authenticatedFetch').mockResolvedValue({ executed: true } as unknown);
    const service = new AlgorithmDetailQueries();

    const mutation = service.useExecuteAlgorithmMutation('999') as any;

    expect(mutation.mutationKey).toEqual(['execute-algorithm', '999', false]);
    await mutation.mutationFn();
    expect(fetchSpy).toHaveBeenCalledWith('/api/algorithm/999/execute?minimal=false', { method: 'POST' });

    await mutation.onSuccess?.({ executed: true } as unknown, undefined as unknown, undefined, undefined);
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.algorithms.detail('999') });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.algorithms.performance('999')
    });
  });
});
