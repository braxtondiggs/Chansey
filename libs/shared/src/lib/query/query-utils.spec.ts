import type { QueryKey } from '@tanstack/angular-query-experimental';
import { QueryClient } from '@tanstack/angular-query-experimental';

const tokenMap = new Map<unknown, unknown>();

jest.mock('@angular/core', () => ({
  inject: (token: unknown) => tokenMap.get(token)
}));

jest.mock('@tanstack/angular-query-experimental', () => {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const QueryClient = function QueryClient() {};
  return {
    QueryClient,
    injectQuery: (factory: () => unknown) => factory(),
    injectMutation: (factory: () => unknown) => factory(),
    injectQueryClient: () => tokenMap.get(QueryClient)
  };
});

import { STANDARD_POLICY } from './cache-policies';
import {
  authenticatedFetch,
  createQueryConfig,
  useAuthQuery,
  useAuthMutation,
  useInvalidateQueries,
  usePrefetchQuery,
  useSetQueryData,
  useGetQueryData,
  createDomainInvalidator,
  batchInvalidate
} from './query-utils';

const queryClientMock = {
  invalidateQueries: jest.fn().mockResolvedValue(undefined),
  prefetchQuery: jest.fn().mockResolvedValue(undefined),
  setQueryData: jest.fn(),
  getQueryData: jest.fn()
};

describe('query-utils', () => {
  beforeEach(() => {
    tokenMap.clear();
    tokenMap.set(QueryClient, queryClientMock);
    jest.clearAllMocks();
    (global.fetch as unknown as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({})
    });
  });

  describe('authenticatedFetch', () => {
    it('sends JSON requests with credentials and content type', async () => {
      const responseJson = { ok: true };
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue(responseJson)
      });

      const result = await authenticatedFetch('/api/test', { method: 'POST', body: JSON.stringify({ foo: 'bar' }) });

      expect(global.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ credentials: 'include' }));
      const options = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' });
      expect(result).toEqual(responseJson);
    });

    it('omits content type for FormData bodies', async () => {
      const body = new FormData();
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue({})
      });

      await authenticatedFetch('/api/form', { method: 'POST', body });

      const options = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(options.headers).not.toHaveProperty('Content-Type');
    });

    it('throws authentication error for 401 responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: jest.fn().mockResolvedValue({})
      });

      await expect(authenticatedFetch('/api/protected')).rejects.toThrow('Authentication required');
    });

    it('surfaces server error messages and falls back to status text', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: jest.fn().mockResolvedValue({ message: 'Something broke' })
      });

      await expect(authenticatedFetch('/api/error')).rejects.toThrow('Something broke');

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: jest.fn().mockRejectedValue(new Error('bad json'))
      });

      await expect(authenticatedFetch('/api/error')).rejects.toThrow('Error 500: Server Error');
    });
  });

  describe('createQueryConfig & useAuthQuery', () => {
    it('merges cache policy overrides when creating query config', () => {
      const config = createQueryConfig(['items'], () => Promise.resolve(['a', 'b']), {
        cachePolicy: { staleTime: 10_000, retry: 0 }
      });

      expect(config.queryKey).toEqual(['items']);
      expect(config.staleTime).toBe(10_000);
      expect(config.retry).toBe(0);
      expect(config.gcTime).toBe(STANDARD_POLICY.gcTime);
    });

    it('builds auth query options with merged policy', async () => {
      const query = useAuthQuery(['items'], '/api/items', {
        cachePolicy: { refetchOnWindowFocus: false, staleTime: 5000 }
      }) as any;

      expect(query.queryKey).toEqual(['items']);
      expect(query.staleTime).toBe(5000);
      expect(query.refetchOnWindowFocus).toBe(false);

      const result = await query.queryFn();
      expect(global.fetch).toHaveBeenCalledWith('/api/items', expect.objectContaining({ credentials: 'include' }));
      expect(result).toEqual({});
    });
  });

  describe('useAuthMutation', () => {
    it('sends mutation without id in body and invalidates queries on success', async () => {
      const mutation = useAuthMutation<{ saved: boolean }, { id: string; name: string }>(
        (variables) => `/api/resource/${variables.id}`,
        'PATCH',
        { invalidateQueries: [['resources'] as QueryKey] }
      ) as any;

      await mutation.mutationFn({ id: 'abc', name: 'test' });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/resource/abc',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'test' })
        })
      );

      await mutation.onSuccess({ saved: true }, { id: 'abc', name: 'test' }, undefined, undefined);
      expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['resources'] });
    });

    it('supports FormData bodies without JSON stringification', async () => {
      const formData = new FormData();
      formData.append('file', 'x');

      const mutation = useAuthMutation<void, FormData>('/api/upload', 'POST') as any;
      await mutation.mutationFn(formData);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/upload',
        expect.objectContaining({
          method: 'POST',
          body: formData
        })
      );
    });

    it('omits body for DELETE when variables are undefined', async () => {
      const mutation = useAuthMutation<void, void>('/api/delete', 'DELETE') as any;
      await mutation.mutationFn(undefined);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/delete',
        expect.objectContaining({
          method: 'DELETE',
          body: undefined
        })
      );
    });
  });

  describe('query client helpers', () => {
    it('invalidates queries via useInvalidateQueries', async () => {
      const invalidate = useInvalidateQueries();
      await invalidate(['key']);
      expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['key'] });
    });

    it('prefetches queries via usePrefetchQuery', async () => {
      const prefetch = usePrefetchQuery();
      await prefetch(['prefetch'], () => Promise.resolve('data'), 123);
      expect(queryClientMock.prefetchQuery).toHaveBeenCalledWith({
        queryKey: ['prefetch'],
        queryFn: expect.any(Function),
        staleTime: 123
      });
    });

    it('sets and gets query data', () => {
      const setData = useSetQueryData();
      const getData = useGetQueryData();

      queryClientMock.getQueryData.mockReturnValue('value');

      setData(['data'], 'value');
      expect(queryClientMock.setQueryData).toHaveBeenCalledWith(['data'], 'value');
      expect(getData(['data'])).toBe('value');
    });

    it('creates a domain invalidator and batch invalidates', async () => {
      const invalidateDomain = createDomainInvalidator(['domain']);
      await invalidateDomain();
      expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['domain'] });

      queryClientMock.invalidateQueries.mockClear();
      await batchInvalidate(queryClientMock as any, [['a'], ['b']]);
      expect(queryClientMock.invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ['a'] });
      expect(queryClientMock.invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ['b'] });
    });
  });
});
