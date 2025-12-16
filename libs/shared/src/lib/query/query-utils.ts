import { inject } from '@angular/core';

import {
  CreateMutationOptions,
  CreateQueryOptions,
  QueryClient,
  QueryKey,
  injectMutation,
  injectQuery,
  injectQueryClient
} from '@tanstack/angular-query-experimental';

import { STANDARD_POLICY, type CachePolicy, mergeCachePolicy } from './cache-policies';

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
// Authenticated Fetch
// ============================================================================

/**
 * Performs an authenticated fetch request with HttpOnly cookie credentials
 *
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @returns Promise resolving to the response data
 * @throws Error if the request fails
 */
export async function authenticatedFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
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
    if (response.status === 401) {
      throw new Error('Authentication required');
    }

    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Error ${response.status}: ${response.statusText}`);
  }

  // Handle 204 No Content responses
  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json();
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
 * Injects a query with authenticated fetch and standardized configuration
 *
 * @param queryKey - The query key
 * @param url - The API URL
 * @param options - Additional query options
 * @returns Query result signal
 *
 * @example
 * // Static query
 * coinsQuery = useAuthQuery<Coin[]>(
 *   queryKeys.coins.lists(),
 *   '/api/coin'
 * );
 */
export function useAuthQuery<TData>(
  queryKey: QueryKey,
  url: string,
  options?: Omit<CreateQueryOptions<TData, Error>, 'queryKey' | 'queryFn'> & {
    cachePolicy?: Partial<CachePolicy>;
    enabled?: boolean;
    refetchOnWindowFocus?: boolean;
  }
) {
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
    ...options
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
