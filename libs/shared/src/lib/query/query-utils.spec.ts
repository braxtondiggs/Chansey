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
    injectMutation: (factory: () => unknown) => factory(),
    injectQuery: (factory: () => unknown) => factory(),
    injectQueryClient: () => tokenMap.get(QueryClient)
  };
});

import { STANDARD_POLICY } from './cache-policies';
import {
  authenticatedBlobFetch,
  authenticatedFetch,
  batchInvalidate,
  buildUrl,
  createDomainInvalidator,
  createQueryConfig,
  resetSessionExpiredFlag,
  useAuthMutation,
  useAuthQuery,
  useGetQueryData,
  useInvalidateQueries,
  usePrefetchQuery,
  useSetQueryData
} from './query-utils';

const queryClientMock = {
  getQueryData: jest.fn(),
  invalidateQueries: jest.fn().mockResolvedValue(undefined),
  prefetchQuery: jest.fn().mockResolvedValue(undefined),
  setQueryData: jest.fn()
};

const fetchMock = () => global.fetch as unknown as jest.Mock;

const makeJsonResponse = (status: number, body: unknown, statusText = status === 200 ? 'OK' : 'Error') => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  json: jest.fn().mockResolvedValue(body)
});

const makeNoContentResponse = () => ({
  ok: true,
  status: 204,
  statusText: 'No Content',
  json: jest.fn()
});

const make401 = () => makeJsonResponse(401, {}, 'Unauthorized');
const make200 = (body: unknown = {}) => makeJsonResponse(200, body, 'OK');

describe('query-utils', () => {
  beforeEach(() => {
    tokenMap.clear();
    tokenMap.set(QueryClient, queryClientMock);

    jest.clearAllMocks();
    resetSessionExpiredFlag();

    (global.fetch as unknown as jest.Mock) = jest.fn().mockResolvedValue(make200());
  });

  describe('authenticatedFetch', () => {
    it('sends credentials and JSON content type for request bodies', async () => {
      fetchMock().mockResolvedValueOnce(make200({ ok: true }));

      const result = await authenticatedFetch('/api/test', {
        body: JSON.stringify({ foo: 'bar' }),
        method: 'POST'
      });

      expect(fetchMock()).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          credentials: 'include',
          method: 'POST'
        })
      );
      expect(fetchMock().mock.calls[0][1]).toMatchObject({
        headers: { 'Content-Type': 'application/json' }
      });
      expect(result).toEqual({ ok: true });
    });

    it('does not force content type for FormData bodies', async () => {
      const formData = new FormData();
      formData.append('name', 'file');

      await authenticatedFetch('/api/form', { body: formData, method: 'POST' });

      expect(fetchMock().mock.calls[0][1]).toMatchObject({
        body: formData,
        method: 'POST'
      });
      expect((fetchMock().mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Content-Type');
    });

    it('returns undefined for 204 No Content responses', async () => {
      fetchMock().mockResolvedValueOnce(makeNoContentResponse());

      const result = await authenticatedFetch('/api/no-content');
      expect(result).toBeUndefined();
    });

    it('surfaces backend error messages and falls back to HTTP status text', async () => {
      fetchMock().mockResolvedValueOnce(makeJsonResponse(500, { message: 'Something broke' }, 'Server Error'));
      await expect(authenticatedFetch('/api/error')).rejects.toThrow('Something broke');

      fetchMock().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: jest.fn().mockRejectedValue(new Error('bad json'))
      });
      await expect(authenticatedFetch('/api/error')).rejects.toThrow('Error 500: Server Error');
    });
  });

  describe('authenticatedBlobFetch', () => {
    it('returns raw response with credentials included', async () => {
      const blobResponse = { ok: true, status: 200, statusText: 'OK', blob: jest.fn().mockResolvedValue(new Blob()) };
      fetchMock().mockResolvedValueOnce(blobResponse);

      const result = await authenticatedBlobFetch('/api/export');

      expect(fetchMock()).toHaveBeenCalledWith('/api/export', expect.objectContaining({ credentials: 'include' }));
      expect(result).toBe(blobResponse);
    });

    it('retries once after successful token refresh on 401', async () => {
      const blobResponse = { ok: true, status: 200, statusText: 'OK' };
      fetchMock().mockResolvedValueOnce(make401()).mockResolvedValueOnce(make200()).mockResolvedValueOnce(blobResponse);

      const result = await authenticatedBlobFetch('/api/export');

      expect(result).toBe(blobResponse);
      expect(fetchMock()).toHaveBeenCalledTimes(3);
    });

    it('throws ApiError on non-401 failure', async () => {
      fetchMock().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: jest.fn().mockResolvedValue({ message: 'Internal error' })
      });

      await expect(authenticatedBlobFetch('/api/export')).rejects.toThrow('Internal error');
    });
  });

  describe('token refresh logic', () => {
    it('retries original request once after successful refresh', async () => {
      fetchMock()
        .mockResolvedValueOnce(make401())
        .mockResolvedValueOnce(make200())
        .mockResolvedValueOnce(make200({ id: 1 }));

      const result = await authenticatedFetch('/api/data');

      expect(result).toEqual({ id: 1 });
      expect(fetchMock()).toHaveBeenCalledTimes(3);
      expect(fetchMock().mock.calls[1][0]).toBe('/api/auth/refresh');
      expect(fetchMock().mock.calls[2][0]).toBe('/api/data');
    });

    it('dispatches session-expired and blocks subsequent refresh attempts when refresh fails', async () => {
      const listener = jest.fn();
      window.addEventListener('auth:session-expired', listener);

      fetchMock().mockResolvedValue(make401());
      await expect(authenticatedFetch('/api/first')).rejects.toThrow('Authentication required');
      expect(fetchMock()).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledTimes(1);

      fetchMock().mockClear();
      fetchMock().mockResolvedValue(make401());

      await expect(authenticatedFetch('/api/second')).rejects.toThrow('Authentication required');
      expect(fetchMock()).toHaveBeenCalledTimes(1);

      window.removeEventListener('auth:session-expired', listener);
    });

    it('does not attempt refresh for the refresh endpoint itself', async () => {
      fetchMock().mockResolvedValue(make401());

      await expect(authenticatedFetch('/api/auth/refresh')).rejects.toThrow('Authentication required');
      expect(fetchMock()).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent 401s into one refresh request', async () => {
      let refreshCallCount = 0;

      fetchMock().mockImplementation((url: string) => {
        if (url === '/api/auth/refresh') {
          refreshCallCount += 1;
          return Promise.resolve(make200());
        }

        const callsForUrl = fetchMock().mock.calls.filter((call) => call[0] === url).length;
        if (callsForUrl <= 1) {
          return Promise.resolve(make401());
        }

        return Promise.resolve(make200({ url }));
      });

      const [a, b] = await Promise.all([authenticatedFetch('/api/a'), authenticatedFetch('/api/b')]);

      expect(a).toEqual({ url: '/api/a' });
      expect(b).toEqual({ url: '/api/b' });
      expect(refreshCallCount).toBe(1);
    });

    it('allows refresh attempts again after resetSessionExpiredFlag', async () => {
      fetchMock().mockResolvedValue(make401());
      await expect(authenticatedFetch('/api/data')).rejects.toThrow('Authentication required');

      resetSessionExpiredFlag();

      fetchMock()
        .mockResolvedValueOnce(make401())
        .mockResolvedValueOnce(make200())
        .mockResolvedValueOnce(make200({ ok: true }));

      await expect(authenticatedFetch('/api/data')).resolves.toEqual({ ok: true });
    });
  });

  describe('createQueryConfig and useAuthQuery', () => {
    it('merges cache policy overrides into query config', () => {
      const config = createQueryConfig(['items'], () => Promise.resolve(['a', 'b']), {
        cachePolicy: { retry: 0, staleTime: 10_000 }
      });

      expect(config.queryKey).toEqual(['items']);
      expect(config.staleTime).toBe(10_000);
      expect(config.retry).toBe(0);
      expect(config.gcTime).toBe(STANDARD_POLICY.gcTime);
    });

    it('passes through optional query configuration fields', () => {
      const config = createQueryConfig(['items'], () => Promise.resolve(['a', 'b']), {
        enabled: false,
        placeholderData: ['placeholder'],
        throwOnError: true
      });

      expect(config.enabled).toBe(false);
      expect(config.placeholderData).toEqual(['placeholder']);
      expect(config.throwOnError).toBe(true);
    });

    it('builds authenticated query options and executes queryFn', async () => {
      const query = useAuthQuery(['items'], '/api/items', {
        cachePolicy: { refetchOnWindowFocus: false, staleTime: 5000 }
      }) as unknown as {
        queryFn: () => Promise<unknown>;
        queryKey: QueryKey;
        refetchOnWindowFocus: boolean;
        staleTime: number;
      };

      expect(query.queryKey).toEqual(['items']);
      expect(query.staleTime).toBe(5000);
      expect(query.refetchOnWindowFocus).toBe(false);

      await expect(query.queryFn()).resolves.toEqual({});
      expect(fetchMock()).toHaveBeenCalledWith('/api/items', expect.objectContaining({ credentials: 'include' }));
    });

    it('does not leak cachePolicy into the query config object', () => {
      const query = useAuthQuery(['items'], '/api/items', {
        cachePolicy: { staleTime: 5000 }
      }) as unknown as Record<string, unknown>;

      expect(query).not.toHaveProperty('cachePolicy');
      expect(query.staleTime).toBe(5000);
    });

    it('passes through select and throwOnError in static overload', () => {
      const selectFn = (data: string[]) => data.slice(0, 1);
      const query = useAuthQuery<string[]>(['items'], '/api/items', {
        select: selectFn,
        throwOnError: true
      }) as unknown as {
        select: (data: string[]) => string[];
        throwOnError: boolean;
      };

      expect(query.select).toBe(selectFn);
      expect(query.throwOnError).toBe(true);
    });

    it('throws when url is missing in static overload', () => {
      expect(() => {
        useAuthQuery(['items'], undefined as unknown as string);
      }).toThrow('useAuthQuery: url is required for static (non-factory) calls');
    });
  });

  describe('useAuthMutation', () => {
    it('removes id from JSON body, invalidates queries, and calls onSuccess', async () => {
      const onSuccess = jest.fn();

      const mutation = useAuthMutation<{ saved: boolean }, { id: string; name: string }>(
        (variables) => `/api/resource/${variables.id}`,
        'PATCH',
        { invalidateQueries: [['resources'] as QueryKey], onSuccess }
      ) as unknown as {
        mutationFn: (variables: { id: string; name: string }) => Promise<{ saved: boolean }>;
        onSuccess: (
          data: { saved: boolean },
          variables: { id: string; name: string },
          onMutateResult: unknown,
          context: unknown
        ) => Promise<void>;
      };

      await mutation.mutationFn({ id: 'abc', name: 'test' });

      expect(fetchMock()).toHaveBeenCalledWith(
        '/api/resource/abc',
        expect.objectContaining({
          body: JSON.stringify({ name: 'test' }),
          method: 'PATCH'
        })
      );

      await mutation.onSuccess({ saved: true }, { id: 'abc', name: 'test' }, undefined, undefined);

      expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['resources'] });
      expect(onSuccess).toHaveBeenCalledWith({ saved: true }, { id: 'abc', name: 'test' }, undefined, undefined);
    });

    it('supports FormData mutation bodies without JSON stringification', async () => {
      const formData = new FormData();
      formData.append('file', 'x');

      const mutation = useAuthMutation<void, FormData>('/api/upload', 'POST') as unknown as {
        mutationFn: (variables: FormData) => Promise<void>;
      };
      await mutation.mutationFn(formData);

      expect(fetchMock()).toHaveBeenCalledWith(
        '/api/upload',
        expect.objectContaining({
          body: formData,
          method: 'POST'
        })
      );
    });

    it('omits request body for DELETE mutations with undefined variables', async () => {
      const mutation = useAuthMutation<void, void>('/api/delete', 'DELETE') as unknown as {
        mutationFn: (variables: void) => Promise<void>;
      };
      await mutation.mutationFn(undefined);

      expect(fetchMock()).toHaveBeenCalledWith(
        '/api/delete',
        expect.objectContaining({
          body: undefined,
          method: 'DELETE'
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

    it.each([
      { label: 'explicit stale time', staleTime: 123, expected: 123 },
      { label: 'default stale time', staleTime: undefined, expected: 60000 }
    ])('prefetches queries with $label', async ({ staleTime, expected }) => {
      const prefetch = usePrefetchQuery();

      await prefetch(['prefetch'], () => Promise.resolve('data'), staleTime);
      expect(queryClientMock.prefetchQuery).toHaveBeenCalledWith({
        queryFn: expect.any(Function),
        queryKey: ['prefetch'],
        staleTime: expected
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
  });

  describe('invalidation helpers', () => {
    it('invalidates domain and batch invalidates query keys', async () => {
      const invalidateDomain = createDomainInvalidator(['domain']);
      await invalidateDomain();
      expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['domain'] });

      queryClientMock.invalidateQueries.mockClear();

      await batchInvalidate(queryClientMock as unknown as QueryClient, [['a'], ['b']]);
      expect(queryClientMock.invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ['a'] });
      expect(queryClientMock.invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ['b'] });
    });
  });

  describe('buildUrl', () => {
    it('returns base URL when no params or empty params are provided', () => {
      expect(buildUrl('/api/test')).toBe('/api/test');
      expect(buildUrl('/api/test', undefined)).toBe('/api/test');
      expect(buildUrl('/api/test', {})).toBe('/api/test');
    });

    it('appends query parameters to URL', () => {
      const result = buildUrl('/api/test', { page: 1, limit: 10 });
      expect(result).toBe('/api/test?page=1&limit=10');
    });

    it('filters out null, undefined, and empty string values', () => {
      const result = buildUrl('/api/test', {
        keep: 'yes',
        nullVal: null,
        undefinedVal: undefined,
        emptyVal: '',
        zero: 0
      });
      expect(result).toBe('/api/test?keep=yes&zero=0');
    });

    it('coerces non-string values to strings', () => {
      const result = buildUrl('/api/test', {
        num: 42,
        bool: true,
        falseBool: false
      });
      expect(result).toBe('/api/test?num=42&bool=true&falseBool=false');
    });

    it('returns base URL when all params are filtered out', () => {
      const result = buildUrl('/api/test', {
        a: null,
        b: undefined,
        c: ''
      });
      expect(result).toBe('/api/test');
    });

    it('serializes array values as comma-separated strings', () => {
      const result = buildUrl('/api/test', {
        keep: 'yes',
        arr: ['a', 'b', 'c'],
        num: 42
      });
      expect(result).toBe('/api/test?keep=yes&arr=a%2Cb%2Cc&num=42');
    });
  });

  describe('useAuthQuery reactive overload', () => {
    it('resolves factory function and builds authenticated query', async () => {
      const query = useAuthQuery<{ id: string }>(() => ({
        queryKey: ['items', 'abc'],
        url: '/api/items/abc'
      })) as unknown as {
        queryFn: () => Promise<unknown>;
        queryKey: QueryKey;
        staleTime: number;
      };

      expect(query.queryKey).toEqual(['items', 'abc']);
      expect(query.staleTime).toBe(STANDARD_POLICY.staleTime);

      await expect(query.queryFn()).resolves.toEqual({});
      expect(fetchMock()).toHaveBeenCalledWith('/api/items/abc', expect.objectContaining({ credentials: 'include' }));
    });

    it('merges cache policy from reactive options', () => {
      const query = useAuthQuery<string[]>(() => ({
        queryKey: ['items'],
        url: '/api/items',
        options: {
          cachePolicy: { staleTime: 99_000, retry: 0 }
        }
      })) as unknown as {
        queryKey: QueryKey;
        staleTime: number;
        retry: number;
        gcTime: number;
      };

      expect(query.staleTime).toBe(99_000);
      expect(query.retry).toBe(0);
      expect(query.gcTime).toBe(STANDARD_POLICY.gcTime);
    });

    it('passes through enabled, refetchOnWindowFocus, and select options', () => {
      const selectFn = (data: string[]) => data.filter(Boolean);
      const query = useAuthQuery<string[]>(() => ({
        queryKey: ['items'],
        url: '/api/items',
        options: {
          enabled: false,
          refetchOnWindowFocus: false,
          select: selectFn
        }
      })) as unknown as {
        enabled: boolean;
        refetchOnWindowFocus: boolean;
        select: (data: string[]) => string[];
      };

      expect(query.enabled).toBe(false);
      expect(query.refetchOnWindowFocus).toBe(false);
      expect(query.select).toBe(selectFn);
    });
  });
});
