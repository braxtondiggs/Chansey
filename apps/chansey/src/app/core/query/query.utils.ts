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
 * Custom fetch function that uses HttpOnly cookies for authentication
 */
export async function authenticatedFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  // Check if body is FormData and avoid setting Content-Type to let the browser set it correctly
  const isFormData = options.body instanceof FormData;

  // Create headers object
  const headers = { ...((options.headers as Record<string, string>) || {}) };

  // Only set Content-Type for JSON requests, not for FormData
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
    // Include HttpOnly cookies in requests
    credentials: 'include'
  });

  if (!response.ok) {
    // Check for 401 Unauthorized - let the interceptor handle token refresh
    if (response.status === 401) {
      throw new Error('Authentication required');
    }

    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Error ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Creates a query key factory for a specific domain
 */
export const createQueryKeys = <T extends Record<string, unknown>>(prefix: string) => {
  const keys: T & {
    all: QueryKey;
  } = {} as T & { all: QueryKey };

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
        queryFn: ({ queryKey }: { queryKey: QueryKey }) => {
          // The last parameter in the actual call will be the parameter value
          const param = queryKey[queryKey.length - 1] as TParam;

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
  const {
    invalidateQueries = [],
    onSuccess: originalOnSuccess,
    ...restOptions
  } = options ?? {};

  return injectMutation(() => ({
    mutationFn: (variables: TVariables) => {
      // Handle dynamic URL if a function is provided
      const resolvedUrl = typeof url === 'function' ? url(variables) : url;
      const isEmpty = typeof variables === 'undefined';

      // Remove id from variables (for non-FormData objects)
      if (
        !isEmpty &&
        typeof variables === 'object' &&
        variables !== null &&
        !(variables instanceof FormData) &&
        'id' in variables
      ) {
        const variablesObj = variables as Record<string, unknown>;
        delete variablesObj['id'];
      }

      // Handle FormData objects differently than regular JSON data
      const isFormData = variables instanceof FormData;

      return authenticatedFetch<TData>(resolvedUrl, {
        method,
        body:
          method !== 'DELETE' && !isEmpty
            ? isFormData
              ? (variables as FormData)
              : JSON.stringify(variables)
            : JSON.stringify({})
      });
    },
    onSuccess: async (data, variables, onMutateResult, context) => {
      // Invalidate specified queries on success
      if (invalidateQueries.length) {
        await Promise.all(invalidateQueries.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      }

      // Call the original onSuccess if provided
      if (originalOnSuccess) {
        return originalOnSuccess(data, variables, onMutateResult, context);
      }

      return undefined;
    },
    ...restOptions
  }));
}

/**
 * Invalidates queries by key
 */
export function invalidateQueries(queryKey: QueryKey): Promise<void> {
  const queryClient = inject(QueryClient);
  return queryClient.invalidateQueries({ queryKey });
}
