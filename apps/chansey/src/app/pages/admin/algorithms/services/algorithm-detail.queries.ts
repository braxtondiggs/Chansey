import { Injectable } from '@angular/core';

import { CreateMutationOptions, injectQueryClient } from '@tanstack/angular-query-experimental';

import {
  AlgorithmDetailResponse,
  AlgorithmExecutionResponse,
  AlgorithmPerformance,
  AlgorithmStrategy
} from '@chansey/api-interfaces';
import {
  queryKeys,
  authenticatedFetch,
  STANDARD_POLICY,
  STABLE_POLICY,
  STATIC_POLICY,
  FREQUENT_POLICY,
  TIME
} from '@chansey/shared';

export type TimePeriod = '24h' | '7d' | '30d' | '1y';

/**
 * TanStack Query configuration for algorithm detail pages
 *
 * Provides query configurations with appropriate caching strategies
 * for algorithm-related data.
 */
@Injectable({
  providedIn: 'root'
})
export class AlgorithmDetailQueries {
  private queryClient = injectQueryClient();

  /**
   * Query config for algorithm detail
   *
   * Uses STANDARD policy - algorithm config may change
   */
  useAlgorithmDetailQuery(id: string, options?: { enabled?: boolean }) {
    return {
      queryKey: queryKeys.algorithms.detail(id),
      queryFn: () => authenticatedFetch<AlgorithmDetailResponse>(`/api/algorithm/${id}`),
      ...STANDARD_POLICY,
      enabled: (options?.enabled ?? true) && !!id
    };
  }

  /**
   * Query config for algorithm performance metrics
   *
   * Uses FREQUENT policy with auto-refresh for live metrics
   */
  useAlgorithmPerformanceQuery(id: string, options?: { enabled?: boolean; refetchInterval?: number | false }) {
    return {
      queryKey: queryKeys.algorithms.performance(id),
      queryFn: () => authenticatedFetch<AlgorithmPerformance>(`/api/algorithm/${id}/performance`),
      staleTime: TIME.MINUTES.m2,
      gcTime: TIME.MINUTES.m10,
      refetchInterval: options?.refetchInterval ?? TIME.MINUTES.m5,
      enabled: (options?.enabled ?? true) && !!id,
      retry: FREQUENT_POLICY.retry
    };
  }

  /**
   * Query config for historical performance data
   *
   * Uses STABLE policy - historical data rarely changes
   */
  useAlgorithmPerformanceHistoryQuery(id: string, period: TimePeriod, options?: { enabled?: boolean }) {
    return {
      queryKey: queryKeys.algorithms.performanceHistory(id, period),
      queryFn: () =>
        authenticatedFetch<AlgorithmPerformance[]>(`/api/algorithm/${id}/performance/history?period=${period}`),
      ...STABLE_POLICY,
      gcTime: TIME.MINUTES.m15,
      enabled: (options?.enabled ?? true) && !!id
    };
  }

  /**
   * Query config for algorithm strategies list
   *
   * Uses STATIC policy - strategies rarely change
   */
  useStrategiesQuery(options?: { enabled?: boolean }) {
    return {
      queryKey: queryKeys.algorithms.strategies(),
      queryFn: () => authenticatedFetch<AlgorithmStrategy[]>('/api/algorithm/strategies'),
      ...STATIC_POLICY,
      enabled: options?.enabled ?? true
    };
  }

  /**
   * Mutation config for executing an algorithm
   */
  useExecuteAlgorithmMutation(
    id: string,
    minimal: boolean = false
  ): CreateMutationOptions<AlgorithmExecutionResponse, Error, void> {
    return {
      mutationKey: ['execute-algorithm', id, minimal],
      mutationFn: () =>
        authenticatedFetch<AlgorithmExecutionResponse>(`/api/algorithm/${id}/execute?minimal=${minimal}`, {
          method: 'POST'
        }),
      onSuccess: () => {
        // Invalidate related queries to refresh data
        this.queryClient.invalidateQueries({ queryKey: queryKeys.algorithms.detail(id) });
        this.queryClient.invalidateQueries({ queryKey: queryKeys.algorithms.performance(id) });
      }
    };
  }

  /**
   * Prefetch algorithm detail data
   */
  prefetchAlgorithmDetail(id: string): Promise<void> {
    return this.queryClient.prefetchQuery({
      queryKey: queryKeys.algorithms.detail(id),
      queryFn: () => authenticatedFetch<AlgorithmDetailResponse>(`/api/algorithm/${id}`),
      staleTime: STANDARD_POLICY.staleTime
    });
  }

  /**
   * Invalidate all queries for a specific algorithm
   */
  invalidateAlgorithmQueries(id: string): Promise<void> {
    return Promise.all([
      this.queryClient.invalidateQueries({ queryKey: queryKeys.algorithms.detail(id) }),
      this.queryClient.invalidateQueries({ queryKey: queryKeys.algorithms.performance(id) }),
      this.queryClient.invalidateQueries({ queryKey: queryKeys.algorithms.performanceHistory(id, '24h') }),
      this.queryClient.invalidateQueries({ queryKey: queryKeys.algorithms.performanceHistory(id, '7d') }),
      this.queryClient.invalidateQueries({ queryKey: queryKeys.algorithms.performanceHistory(id, '30d') }),
      this.queryClient.invalidateQueries({ queryKey: queryKeys.algorithms.performanceHistory(id, '1y') })
    ]).then(() => undefined);
  }

  /**
   * Invalidate all algorithm-related queries
   */
  invalidateAllAlgorithmQueries(): Promise<void> {
    return this.queryClient.invalidateQueries({
      queryKey: queryKeys.algorithms.all
    });
  }
}
