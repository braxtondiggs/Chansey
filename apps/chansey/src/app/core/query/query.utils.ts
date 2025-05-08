import { inject } from '@angular/core';

import {
  CreateMutationOptions,
  CreateQueryOptions,
  QueryClient,
  QueryKey,
  injectMutation,
  injectQuery
} from '@tanstack/angular-query-experimental';

/**
 * Custom fetch function that adds JWT authentication token
 */
export async function authenticatedFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token') || ''; // authService.getToken();

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Error ${response.status}: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Creates a query key factory for a specific domain
 */
export const createQueryKeys = <T extends Record<string, any>>(prefix: string) => {
  const keys: T & {
    all: QueryKey;
  } = {} as any;

  keys.all = [prefix];

  return keys;
};

/**
 * Hook for using queries with authenticated requests
 */
export function useAuthQuery<TData, TParam = void>(
  queryKey: QueryKey | ((param: TParam) => QueryKey),
  url: string | ((param: TParam) => string),
  options?: Omit<CreateQueryOptions<TData, Error>, 'queryKey' | 'queryFn'> & { queryKey?: QueryKey }
) {
  return injectQuery(() => {
    if (typeof queryKey === 'function' || typeof url === 'function') {
      // For dynamic queries that require parameters
      return {
        queryKey:
          typeof queryKey === 'function'
            ? // Use a placeholder key that will be replaced in queryFn
              [...typeof queryKey(undefined as unknown as TParam), 'placeholder']
            : queryKey,
        queryFn: ({ queryKey }) => {
          // The last parameter in the actual call will be the parameter value
          const param = queryKey[queryKey.length - 1] as TParam;

          // Resolve the actual queryKey if it's a function
          const actualQueryKey = typeof queryKey === 'function' ? param : queryKey;

          // Resolve the URL if it's a function
          const resolvedUrl = typeof url === 'function' ? url(param) : url;

          return authenticatedFetch<TData>(resolvedUrl);
        },
        ...options
      };
    } else {
      // For static queries (original behavior)
      return {
        queryKey,
        queryFn: () => authenticatedFetch<TData>(url as string),
        ...options
      };
    }
  });
}

/**
 * Hook for using mutations with authenticated requests
 */
export function useAuthMutation<TData, TVariables>(
  url: string | ((variables: TVariables) => string),
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
  options?: Omit<CreateMutationOptions<TData, Error, TVariables>, 'mutationFn'> & {
    invalidateQueries?: QueryKey[];
  }
) {
  const queryClient = inject(QueryClient);

  return injectMutation(() => ({
    mutationFn: (variables: TVariables) => {
      // Handle dynamic URL if a function is provided
      const resolvedUrl = typeof url === 'function' ? url(variables) : url;
      const isEmpty = typeof variables === 'undefined';
      if (!isEmpty) delete (variables as any).id;

      return authenticatedFetch<TData>(resolvedUrl, {
        method,
        body: method !== 'DELETE' && !isEmpty ? JSON.stringify(variables) : JSON.stringify({})
      });
    },
    onSuccess: (data, variables, context) => {
      // Invalidate specified queries on success
      if (options?.invalidateQueries?.length) {
        Promise.all(options.invalidateQueries.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      }

      // Call the original onSuccess if provided
      if (options?.onSuccess) {
        options.onSuccess(data, variables, context);
      }
    },
    ...options
  }));
}

/**
 * Invalidates queries by key
 */
export function invalidateQueries(queryKey: QueryKey): Promise<void> {
  const queryClient = inject(QueryClient);
  return queryClient.invalidateQueries({ queryKey });
}
