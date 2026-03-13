import * as shared from '@chansey/shared';
import { queryKeys, STANDARD_POLICY, useAuthMutation, useAuthQuery } from '@chansey/shared';

import { CoinsService } from './coins.service';

jest.mock('@chansey/shared', () => {
  const actual = jest.requireActual('@chansey/shared');
  return {
    ...actual,
    useAuthQuery: jest.fn(),
    useAuthMutation: jest.fn()
  };
});

const useAuthQueryMock = useAuthQuery as unknown as jest.Mock;
const useAuthMutationMock = useAuthMutation as unknown as jest.Mock;

describe('CoinsService', () => {
  let service: CoinsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CoinsService();
  });

  it('uses list query with standard cache policy', () => {
    useAuthQueryMock.mockReturnValue('coins-query');

    const result = service.useCoins();

    expect(result).toBe('coins-query');
    expect(useAuthQueryMock).toHaveBeenCalledWith(queryKeys.coins.lists(), '/api/coin', {
      cachePolicy: STANDARD_POLICY
    });
  });

  it('builds dynamic coin query with id parameter', () => {
    const fetchSpy = jest.spyOn(shared, 'authenticatedFetch').mockResolvedValue({} as unknown);
    const coinId = jest.fn().mockReturnValue('abc') as unknown as import('@angular/core').Signal<string | null>;

    // Reactive overload: useAuthQuery receives a factory function
    useAuthQueryMock.mockImplementation((factory: () => unknown) => {
      const config = factory() as { queryKey: unknown; url: string; options?: unknown };
      return { ...config, queryFn: () => shared.authenticatedFetch(config.url) };
    });

    const result = service.useCoin(coinId) as any;

    expect(useAuthQueryMock).toHaveBeenCalledTimes(1);
    expect(typeof useAuthQueryMock.mock.calls[0][0]).toBe('function');
    expect(result.queryKey).toEqual(queryKeys.coins.detail('abc'));
    expect(result.options).toEqual({ cachePolicy: STANDARD_POLICY, enabled: true });

    result.queryFn();
    expect(fetchSpy).toHaveBeenCalledWith('/api/coin/abc');
  });

  it('disables coin query and uses empty key when id is null', () => {
    const coinId = jest.fn().mockReturnValue(null) as unknown as import('@angular/core').Signal<string | null>;

    useAuthQueryMock.mockImplementation((factory: () => unknown) => factory());

    const result = service.useCoin(coinId) as any;

    expect(result.queryKey).toEqual(queryKeys.coins.detail(''));
    expect(result.options.enabled).toBe(false);
  });

  it('wires up create/update/delete mutations with invalidation keys', () => {
    const mutationResult = { mutate: jest.fn() };
    useAuthMutationMock.mockReturnValue(mutationResult);

    const create = service.useCreateCoin();
    const update = service.useUpdateCoin();
    const remove = service.useDeleteCoin();

    expect(create).toBe(mutationResult);
    expect(update).toBe(mutationResult);
    expect(remove).toBe(mutationResult);

    const calls = useAuthMutationMock.mock.calls.map((call) => call[2]?.invalidateQueries);
    expect(calls).toEqual([[queryKeys.coins.all], [queryKeys.coins.all], [queryKeys.coins.all]]);
  });
});
