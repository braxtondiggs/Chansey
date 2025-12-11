import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { CreateMutationOptions, CreateQueryOptions, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import {
  AlgorithmDetailResponse,
  AlgorithmExecutionResponse,
  AlgorithmPerformance,
  AlgorithmStrategy
} from '@chansey/api-interfaces';

type AlgorithmQueryOptions<TData, TKey extends readonly unknown[]> = Omit<
  CreateQueryOptions<TData, Error, TData, TKey>,
  'staleTime' | 'gcTime' | 'refetchInterval' | 'refetchIntervalInBackground' | 'enabled' | 'retry' | 'retryDelay'
> & {
  staleTime?: number;
  gcTime?: number;
  refetchInterval?: number | false;
  refetchIntervalInBackground?: boolean;
  enabled?: boolean;
  retry?: number | boolean;
  retryDelay?: number | ((attemptIndex: number, error: Error) => number);
};

export type TimePeriod = '24h' | '7d' | '30d' | '1y';

/**
 * TanStack Query hooks for algorithm detail page
 *
 * Manages data fetching, caching, and mutations for the algorithm detail page.
 */
@Injectable({
  providedIn: 'root'
})
export class AlgorithmDetailQueries {
  private http = inject(HttpClient);
  private queryClient = injectQueryClient();

  private getAlgorithmDetailQueryFn(id: string) {
    return () => lastValueFrom(this.http.get<AlgorithmDetailResponse>(`/api/algorithm/${id}`));
  }

  private getAlgorithmPerformanceQueryFn(id: string) {
    return () => lastValueFrom(this.http.get<AlgorithmPerformance>(`/api/algorithm/${id}/performance`));
  }

  private getAlgorithmPerformanceHistoryQueryFn(id: string, period: TimePeriod) {
    return () =>
      lastValueFrom(this.http.get<AlgorithmPerformance[]>(`/api/algorithm/${id}/performance/history?period=${period}`));
  }

  private getStrategiesQueryFn() {
    return () => lastValueFrom(this.http.get<AlgorithmStrategy[]>(`/api/algorithm/strategies`));
  }

  private executeAlgorithmFn(id: string, minimal: boolean) {
    return () =>
      lastValueFrom(this.http.post<AlgorithmExecutionResponse>(`/api/algorithm/${id}/execute?minimal=${minimal}`, {}));
  }

  /**
   * Fetch algorithm detail by ID including strategy information
   *
   * @param id Algorithm UUID
   * @param options Additional query options
   * @returns Query config for TanStack Query
   */
  useAlgorithmDetailQuery(
    id: string,
    options?: {
      enabled?: boolean;
      staleTime?: number;
      gcTime?: number;
      retry?: number | boolean;
      retryDelay?: number | ((attemptIndex: number, error: Error) => number);
    }
  ): AlgorithmQueryOptions<AlgorithmDetailResponse, ['algorithm-detail', string]> {
    return {
      queryKey: ['algorithm-detail', id],
      queryFn: this.getAlgorithmDetailQueryFn(id),
      staleTime: options?.staleTime ?? 60000, // 1 minute
      gcTime: options?.gcTime ?? 300000, // 5 minutes
      enabled: (options?.enabled ?? true) && !!id,
      retry: options?.retry ?? 1,
      retryDelay: options?.retryDelay ?? ((attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000))
    };
  }

  /**
   * Fetch current performance metrics for an algorithm
   *
   * @param id Algorithm UUID
   * @param options Additional query options
   * @returns Query config for TanStack Query
   */
  useAlgorithmPerformanceQuery(
    id: string,
    options?: {
      enabled?: boolean;
      staleTime?: number;
      gcTime?: number;
      refetchInterval?: number | false;
      retry?: number | boolean;
    }
  ): AlgorithmQueryOptions<AlgorithmPerformance, ['algorithm-performance', string]> {
    return {
      queryKey: ['algorithm-performance', id],
      queryFn: this.getAlgorithmPerformanceQueryFn(id),
      staleTime: options?.staleTime ?? 120000, // 2 minutes
      gcTime: options?.gcTime ?? 600000, // 10 minutes
      refetchInterval: options?.refetchInterval ?? 300000, // 5 minutes
      enabled: (options?.enabled ?? true) && !!id,
      retry: options?.retry ?? 1
    };
  }

  /**
   * Fetch historical performance data for charting
   *
   * @param id Algorithm UUID
   * @param period Time period for historical data
   * @param options Additional query options
   * @returns Query config for TanStack Query
   */
  useAlgorithmPerformanceHistoryQuery(
    id: string,
    period: TimePeriod,
    options?: {
      enabled?: boolean;
      staleTime?: number;
      gcTime?: number;
      retry?: number | boolean;
    }
  ): AlgorithmQueryOptions<AlgorithmPerformance[], ['algorithm-performance-history', string, TimePeriod]> {
    return {
      queryKey: ['algorithm-performance-history', id, period],
      queryFn: this.getAlgorithmPerformanceHistoryQueryFn(id, period),
      staleTime: options?.staleTime ?? 300000, // 5 minutes
      gcTime: options?.gcTime ?? 900000, // 15 minutes
      enabled: (options?.enabled ?? true) && !!id,
      retry: options?.retry ?? 1
    };
  }

  /**
   * Fetch all available strategies
   *
   * @param options Additional query options
   * @returns Query config for TanStack Query
   */
  useStrategiesQuery(options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }): AlgorithmQueryOptions<AlgorithmStrategy[], ['algorithm-strategies']> {
    return {
      queryKey: ['algorithm-strategies'],
      queryFn: this.getStrategiesQueryFn(),
      staleTime: options?.staleTime ?? 600000, // 10 minutes
      gcTime: options?.gcTime ?? 1800000, // 30 minutes
      enabled: options?.enabled ?? true
    };
  }

  /**
   * Execute algorithm mutation config
   *
   * @param id Algorithm UUID
   * @param minimal Whether to use minimal context
   * @returns Mutation config for TanStack Query
   */
  useExecuteAlgorithmMutation(
    id: string,
    minimal: boolean = false
  ): CreateMutationOptions<AlgorithmExecutionResponse, Error, void> {
    return {
      mutationKey: ['execute-algorithm', id, minimal],
      mutationFn: this.executeAlgorithmFn(id, minimal),
      onSuccess: () => {
        // Invalidate algorithm detail to refresh metrics
        this.queryClient.invalidateQueries({ queryKey: ['algorithm-detail', id] });
        this.queryClient.invalidateQueries({ queryKey: ['algorithm-performance', id] });
      }
    };
  }

  /**
   * Prefetch algorithm detail data
   *
   * @param id Algorithm UUID to prefetch
   */
  prefetchAlgorithmDetail(id: string): Promise<void> {
    return this.queryClient.prefetchQuery({
      queryKey: ['algorithm-detail', id],
      queryFn: () => lastValueFrom(this.http.get<AlgorithmDetailResponse>(`/api/algorithm/${id}`)),
      staleTime: 60000
    });
  }

  /**
   * Invalidate all queries for a specific algorithm
   *
   * @param id Algorithm UUID to invalidate
   */
  invalidateAlgorithmQueries(id: string): Promise<void> {
    return Promise.all([
      this.queryClient.invalidateQueries({ queryKey: ['algorithm-detail', id] }),
      this.queryClient.invalidateQueries({ queryKey: ['algorithm-performance', id] }),
      this.queryClient.invalidateQueries({ queryKey: ['algorithm-performance-history', id] })
    ]).then(() => undefined);
  }
}
