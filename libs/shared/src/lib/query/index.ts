/**
 * TanStack Query Centralized Module
 *
 * This module provides a unified, consistent approach to data fetching
 * and caching across the Chansey application.
 *
 * Exports:
 * - queryKeys: Centralized query key factory
 * - Cache policies: Standardized caching strategies
 * - Query utilities: Helper functions for queries and mutations
 */

// Cache Policies
export {
  CACHE_POLICIES,
  REALTIME_POLICY,
  FREQUENT_POLICY,
  STANDARD_POLICY,
  STABLE_POLICY,
  STATIC_POLICY,
  INFINITE_POLICY,
  TIME,
  getCachePolicy,
  mergeCachePolicy,
  createCachePolicy
} from './cache-policies';
export type { CachePolicy, CachePolicyName } from './cache-policies';

// Query Keys
export { queryKeys } from './query-keys';
export type {
  QueryKeys,
  CoinsQueryKeys,
  AlgorithmsQueryKeys,
  ExchangesQueryKeys,
  CategoriesQueryKeys,
  RisksQueryKeys,
  TransactionsQueryKeys,
  BalancesQueryKeys,
  AuthQueryKeys,
  ProfileQueryKeys,
  BacktestsQueryKeys,
  ComparisonReportsQueryKeys,
  PricesQueryKeys
} from './query-keys';

// Query Utilities
export {
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
export type { BaseQueryOptions, MutationOptions } from './query-utils';

// API Error Handling
export { ApiError, ErrorCodes, isApiError, extractErrorInfo } from './api-error';
export type { ApiErrorResponse } from './api-error';
