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
  createCachePolicy,
  FREQUENT_POLICY,
  getCachePolicy,
  INFINITE_POLICY,
  mergeCachePolicy,
  REALTIME_POLICY,
  STABLE_POLICY,
  STANDARD_POLICY,
  STATIC_POLICY,
  TIME
} from './cache-policies';
export type { CachePolicy, CachePolicyName } from './cache-policies';

// Query Keys
export { queryKeys } from './query-keys';
export type {
  AlgorithmsQueryKeys,
  AuthQueryKeys,
  BacktestsQueryKeys,
  BalancesQueryKeys,
  CategoriesQueryKeys,
  CoinsQueryKeys,
  ComparisonReportsQueryKeys,
  ExchangesQueryKeys,
  PricesQueryKeys,
  ProfileQueryKeys,
  QueryKeys,
  RisksQueryKeys,
  TransactionsQueryKeys
} from './query-keys';

// Query Utilities
export {
  authenticatedFetch,
  batchInvalidate,
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
export type { BaseQueryOptions, MutationOptions } from './query-utils';

// API Error Handling
export { ApiError, ErrorCodes, extractErrorInfo, isApiError } from './api-error';
export type { ApiErrorResponse } from './api-error';
