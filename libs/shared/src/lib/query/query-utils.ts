import { inject } from '@angular/core';

import {
  CreateMutationOptions,
  CreateQueryOptions,
  CreateQueryResult,
  QueryClient,
  QueryKey,
  injectMutation,
  injectQuery,
  injectQueryClient
} from '@tanstack/angular-query-experimental';

import { ApiError, type ApiErrorResponse } from './api-error';
import { STANDARD_POLICY, mergeCachePolicy, type CachePolicy } from './cache-policies';

// ============================================================================
// Types
// ============================================================================

/**
 * Base options for query configurations
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface BaseQueryOptions<TData, _TError = Error> {
  /** Custom cache policy overrides */
  cachePolicy?: Partial<CachePolicy>;
  /** Enable/disable the query */
  enabled?: boolean;
  /** Select/transform the data */
  select?: (data: TData) => TData;
  /** Placeholder data while loading */
  placeholderData?: TData | (() => TData);
  /** Custom error type */
  throwOnError?: boolean;
}

/**
 * Options for reactive (signal-based) auth query configuration
 */
export interface AuthQueryOptions<TData> extends Omit<BaseQueryOptions<TData>, 'placeholderData'> {
  refetchOnWindowFocus?: boolean;
}

/**
 * Configuration returned by the reactive useAuthQuery factory function
 */
export interface ReactiveAuthQueryConfig<TData> {
  queryKey: QueryKey;
  url: string;
  options?: AuthQueryOptions<TData>;
}

/**
 * Options for mutation configurations
 */
export interface MutationOptions<TData, TVariables, TError = Error> {
  /** Callback on success */
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  /** Callback on error */
  onError?: (error: TError, variables: TVariables) => void;
  /** Callback on mutation start */
  onMutate?: (variables: TVariables) => void | Promise<unknown>;
  /** Callback after mutation settles (success or error) */
  onSettled?: (data: TData | undefined, error: TError | null, variables: TVariables) => void;
  /** Query keys to invalidate on success */
  invalidateQueries?: QueryKey[];
}

// ============================================================================
// Token Refresh State
// ============================================================================

/** Coalesced refresh promise — concurrent 401s share a single refresh request */
let refreshPromise: Promise<boolean> | null = null;

/** Once true, no further refresh attempts are made until reset (e.g. re-login) */
let sessionExpired = false;

/**
 * Resets the session-expired flag so refresh attempts can resume.
 * Call this after a successful login.
 */
export function resetSessionExpiredFlag(): void {
  sessionExpired = false;
}

// ============================================================================
// Authenticated Fetch
// ============================================================================

/**
 * Attempts to refresh the access token via the refresh-token cookie.
 * Coalesces concurrent calls so only one network request is made.
 */
function attemptTokenRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include'
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/** Dispatches a custom event that Angular can listen for */
function dispatchSessionExpiredEvent(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth:session-expired'));
  }
}

/**
 * Performs an authenticated fetch request with HttpOnly cookie credentials.
 * On 401, transparently attempts a token refresh and retries once.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @param isRetry - Internal flag to prevent infinite retry loops
 * @returns Promise resolving to the response data
 * @throws ApiError if the request fails
 */
export async function authenticatedFetch<T>(url: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const hasBody = options.body !== undefined && options.body !== null;

  const headers: Record<string, string> = { ...((options.headers as Record<string, string>) || {}) };

  // Only set Content-Type for JSON requests with a body, not for FormData or empty requests
  if (!isFormData && hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include' // Include HttpOnly cookies
  });

  if (!response.ok) {
    // Parse error response from backend
    const errorData = await response.json().catch(() => ({}) as Partial<ApiErrorResponse>);

    // --- 401 handling with transparent token refresh ---
    if (response.status === 401) {
      const isRefreshEndpoint = url.includes('/api/auth/refresh');

      // Attempt refresh if this isn't already a retry, session hasn't expired,
      // and the failing request isn't the refresh endpoint itself
      if (!isRetry && !sessionExpired && !isRefreshEndpoint) {
        const refreshed = await attemptTokenRefresh();
        if (refreshed) {
          // Retry the original request exactly once
          return authenticatedFetch<T>(url, options, true);
        }

        // Refresh failed — mark session as expired
        sessionExpired = true;
        dispatchSessionExpiredEvent();
      }

      throw new ApiError({
        statusCode: 401,
        code: errorData.code || 'AUTH.INVALID_CREDENTIALS',
        message: errorData.message || 'Authentication required',
        path: url,
        timestamp: new Date().toISOString()
      });
    }

    // Create ApiError with full response structure
    throw new ApiError({
      statusCode: errorData.statusCode || response.status,
      code: errorData.code || `HTTP_${response.status}`,
      message: errorData.message || `Error ${response.status}: ${response.statusText}`,
      path: errorData.path || url,
      timestamp: errorData.timestamp || new Date().toISOString(),
      context: errorData.context
    });
  }

  // Handle 204 No Content responses
  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json();
}

/**
 * Performs an authenticated fetch that returns the raw Response (for blob/binary downloads).
 * Same cookie/retry logic as authenticatedFetch, but does not parse the body.
 */
export async function authenticatedBlobFetch(
  url: string,
  options: RequestInit = {},
  isRetry = false
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include'
  });

  if (!response.ok) {
    if (response.status === 401) {
      const isRefreshEndpoint = url.includes('/api/auth/refresh');

      if (!isRetry && !sessionExpired && !isRefreshEndpoint) {
        const refreshed = await attemptTokenRefresh();
        if (refreshed) {
          return authenticatedBlobFetch(url, options, true);
        }

        sessionExpired = true;
        dispatchSessionExpiredEvent();
      }

      throw new ApiError({
        statusCode: 401,
        code: 'AUTH.INVALID_CREDENTIALS',
        message: 'Authentication required',
        path: url,
        timestamp: new Date().toISOString()
      });
    }

    // Try to extract error detail from response
    let errorMessage = `Error ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch {
      // Ignore JSON parse errors
    }

    throw new ApiError({
      statusCode: response.status,
      code: `HTTP_${response.status}`,
      message: errorMessage,
      path: url,
      timestamp: new Date().toISOString()
    });
  }

  return response;
}

// ============================================================================
// URL Utilities
// ============================================================================

/**
 * Builds a URL with query parameters, filtering out null/undefined/empty values.
 *
 * @param base - The base URL path
 * @param params - Optional record of query parameters
 * @returns The URL with query string appended (if any params are present)
 */
export type UrlParamValue = string | number | boolean | string[] | null | undefined;

export function buildUrl<T extends Partial<Record<keyof T & string, UrlParamValue>>>(base: string, params?: T): string {
  if (!params) return base;

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        searchParams.set(key, value.join(','));
      } else {
        searchParams.set(key, String(value));
      }
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `${base}?${queryString}` : base;
}

// ============================================================================
// Query Factory Functions
// ============================================================================

/**
 * Creates a query configuration object for use with injectQuery
 *
 * @param queryKey - The query key
 * @param queryFn - The function to fetch data
 * @param options - Additional options
 * @returns Query configuration object
 */
export function createQueryConfig<TData, TKey extends QueryKey = QueryKey>(
  queryKey: TKey,
  queryFn: () => Promise<TData>,
  options?: BaseQueryOptions<TData> & { cachePolicy?: Partial<CachePolicy> }
): CreateQueryOptions<TData, Error, TData, TKey> {
  const policy = options?.cachePolicy ? mergeCachePolicy(STANDARD_POLICY, options.cachePolicy) : STANDARD_POLICY;

  return {
    queryKey,
    queryFn,
    staleTime: policy.staleTime,
    gcTime: policy.gcTime,
    refetchInterval: policy.refetchInterval,
    refetchIntervalInBackground: policy.refetchIntervalInBackground,
    refetchOnWindowFocus: policy.refetchOnWindowFocus,
    retry: policy.retry,
    retryDelay: policy.retryDelay,
    enabled: options?.enabled,
    select: options?.select,
    placeholderData: options?.placeholderData,
    throwOnError: options?.throwOnError
  } as CreateQueryOptions<TData, Error, TData, TKey>;
}

/**
 * Injects a query with authenticated fetch and standardized configuration.
 *
 * Supports two calling styles:
 *
 * **Static** (existing, unchanged):
 * ```ts
 * useAuthQuery<Coin[]>(queryKeys.coins.lists(), '/api/coin');
 * ```
 *
 * **Reactive** (new, for signal-based queries):
 * ```ts
 * useAuthQuery<Coin>(() => ({
 *   queryKey: queryKeys.coins.detail(id()),
 *   url: `/api/coin/${id()}`,
 *   options: { enabled: !!id() }
 * }));
 * ```
 */
export function useAuthQuery<TData>(factory: () => ReactiveAuthQueryConfig<TData>): CreateQueryResult<TData, Error>;
export function useAuthQuery<TData>(
  queryKey: QueryKey,
  url: string,
  options?: Omit<CreateQueryOptions<TData, Error>, 'queryKey' | 'queryFn'> & {
    cachePolicy?: Partial<CachePolicy>;
    enabled?: boolean;
    refetchOnWindowFocus?: boolean;
  }
): CreateQueryResult<TData, Error>;
export function useAuthQuery<TData>(
  queryKeyOrFactory: QueryKey | (() => ReactiveAuthQueryConfig<TData>),
  url?: string,
  options?: Omit<CreateQueryOptions<TData, Error>, 'queryKey' | 'queryFn'> & {
    cachePolicy?: Partial<CachePolicy>;
    enabled?: boolean;
    refetchOnWindowFocus?: boolean;
  }
): CreateQueryResult<TData, Error> {
  // Reactive overload: factory function
  if (typeof queryKeyOrFactory === 'function') {
    const factory = queryKeyOrFactory as () => ReactiveAuthQueryConfig<TData>;
    return injectQuery(() => {
      const config = factory();
      const opts = config.options;
      const policy = opts?.cachePolicy ? mergeCachePolicy(STANDARD_POLICY, opts.cachePolicy) : STANDARD_POLICY;

      return {
        queryKey: config.queryKey,
        queryFn: () => authenticatedFetch<TData>(config.url),
        staleTime: policy.staleTime,
        gcTime: policy.gcTime,
        refetchInterval: policy.refetchInterval,
        refetchIntervalInBackground: policy.refetchIntervalInBackground,
        refetchOnWindowFocus: opts?.refetchOnWindowFocus ?? policy.refetchOnWindowFocus,
        retry: policy.retry,
        retryDelay: policy.retryDelay,
        enabled: opts?.enabled,
        select: opts?.select,
        throwOnError: opts?.throwOnError
      };
    });
  }

  // Static overload: queryKey + url
  const queryKey = queryKeyOrFactory as QueryKey;

  if (!url) {
    throw new Error('useAuthQuery: url is required for static (non-factory) calls');
  }

  const policy = options?.cachePolicy ? mergeCachePolicy(STANDARD_POLICY, options.cachePolicy) : STANDARD_POLICY;

  return injectQuery(() => ({
    queryKey,
    queryFn: () => authenticatedFetch<TData>(url),
    staleTime: policy.staleTime,
    gcTime: policy.gcTime,
    refetchInterval: policy.refetchInterval,
    refetchIntervalInBackground: policy.refetchIntervalInBackground,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? policy.refetchOnWindowFocus,
    retry: policy.retry,
    retryDelay: policy.retryDelay,
    enabled: options?.enabled,
    select: options?.select,
    throwOnError: options?.throwOnError
  }));
}

// ============================================================================
// Mutation Factory Functions
// ============================================================================

/**
 * Injects a mutation with authenticated fetch and automatic query invalidation
 *
 * @param url - The API URL (or function for dynamic URLs)
 * @param method - HTTP method (POST, PUT, PATCH, DELETE)
 * @param options - Mutation options including invalidation config
 * @returns Mutation result
 *
 * @example
 * createCoin = useAuthMutation<Coin, CreateCoinDto>(
 *   '/api/coin',
 *   'POST',
 *   { invalidateQueries: [queryKeys.coins.all] }
 * );
 *
 * @example
 * updateCoin = useAuthMutation<Coin, UpdateCoinDto>(
 *   (data) => `/api/coin/${data.id}`,
 *   'PATCH',
 *   { invalidateQueries: [queryKeys.coins.all] }
 * );
 */
export function useAuthMutation<TData, TVariables>(
  url: string | ((variables: TVariables) => string),
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
  options?: Omit<CreateMutationOptions<TData, Error, TVariables>, 'mutationFn'> & {
    invalidateQueries?: QueryKey[];
  }
) {
  const queryClient = inject(QueryClient);
  const { invalidateQueries = [], onSuccess: originalOnSuccess, ...restOptions } = options ?? {};

  return injectMutation(() => ({
    mutationFn: (variables: TVariables) => {
      const resolvedUrl = typeof url === 'function' ? url(variables) : url;
      const isEmpty = typeof variables === 'undefined';

      // Clone variables to avoid mutating the original
      let body: unknown = variables;

      // Remove id from variables for request body (already in URL for PATCH/DELETE)
      if (
        !isEmpty &&
        typeof variables === 'object' &&
        variables !== null &&
        !(variables instanceof FormData) &&
        'id' in variables
      ) {
        const { id: _id, ...rest } = variables as Record<string, unknown>;
        body = rest;
      }

      const isFormData = variables instanceof FormData;

      return authenticatedFetch<TData>(resolvedUrl, {
        method,
        body:
          method !== 'DELETE' && !isEmpty ? (isFormData ? (variables as FormData) : JSON.stringify(body)) : undefined
      });
    },
    onSuccess: async (data, variables, onMutateResult, mutationContext) => {
      // Invalidate specified queries on success
      if (invalidateQueries.length) {
        await Promise.all(invalidateQueries.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      }

      // Call original onSuccess if provided
      if (originalOnSuccess) {
        await originalOnSuccess(data, variables, onMutateResult, mutationContext);
      }
    },
    ...restOptions
  }));
}

// ============================================================================
// Query Client Utilities
// ============================================================================

/**
 * Invalidate queries by key pattern
 *
 * @param queryKey - The query key or pattern to invalidate
 * @returns Promise that resolves when invalidation is complete
 */
export function useInvalidateQueries() {
  const queryClient = injectQueryClient();

  return (queryKey: QueryKey): Promise<void> => {
    return queryClient.invalidateQueries({ queryKey });
  };
}

/**
 * Prefetch a query for optimistic loading
 *
 * @param queryKey - The query key
 * @param queryFn - The function to fetch data
 * @param staleTime - How long to consider the prefetched data fresh
 * @returns Promise that resolves when prefetch is complete
 */
export function usePrefetchQuery() {
  const queryClient = injectQueryClient();

  return <TData>(queryKey: QueryKey, queryFn: () => Promise<TData>, staleTime = 60000): Promise<void> => {
    return queryClient.prefetchQuery({
      queryKey,
      queryFn,
      staleTime
    });
  };
}

/**
 * Set query data directly in the cache
 *
 * @param queryKey - The query key
 * @param data - The data to set
 */
export function useSetQueryData() {
  const queryClient = injectQueryClient();

  return <TData>(queryKey: QueryKey, data: TData | ((old: TData | undefined) => TData)): void => {
    queryClient.setQueryData(queryKey, data);
  };
}

/**
 * Get cached query data
 *
 * @param queryKey - The query key
 * @returns The cached data or undefined
 */
export function useGetQueryData() {
  const queryClient = injectQueryClient();

  return <TData>(queryKey: QueryKey): TData | undefined => {
    return queryClient.getQueryData<TData>(queryKey);
  };
}

// ============================================================================
// Invalidation Helpers
// ============================================================================

/**
 * Creates a function to invalidate all queries for a domain
 *
 * @example
 * const invalidateCoins = createDomainInvalidator(queryKeys.coins.all);
 * await invalidateCoins();
 */
export function createDomainInvalidator(domainKey: QueryKey) {
  return () => {
    const queryClient = inject(QueryClient);
    return queryClient.invalidateQueries({ queryKey: domainKey });
  };
}

/**
 * Batch invalidate multiple query keys
 *
 * @param queryClient - The query client instance
 * @param queryKeys - Array of query keys to invalidate
 * @returns Promise that resolves when all invalidations are complete
 */
export async function batchInvalidate(queryClient: QueryClient, queryKeys: QueryKey[]): Promise<void> {
  await Promise.all(queryKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
}
