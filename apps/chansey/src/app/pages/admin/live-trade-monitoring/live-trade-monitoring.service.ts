import { Injectable, Signal, signal } from '@angular/core';

import { authenticatedBlobFetch, buildUrl, FREQUENT_POLICY, queryKeys, useAuthQuery } from '@chansey/shared';

import {
  AlertsDto,
  AlgorithmListQueryDto,
  ComparisonDto,
  ExportFormat,
  LiveTradeFiltersDto,
  LiveTradeOverviewDto,
  OrderListQueryDto,
  PaginatedAlgorithmListDto,
  PaginatedOrderListDto,
  PaginatedUserActivityDto,
  SlippageAnalysisDto,
  UserActivityQueryDto
} from './live-trade-monitoring.types';

/**
 * Service for live trade monitoring dashboard via TanStack Query
 *
 * Admin-only endpoints for monitoring live trading activity and
 * comparing against backtest predictions.
 */
@Injectable({
  providedIn: 'root'
})
export class LiveTradeMonitoringService {
  private readonly apiUrl = '/api/admin/live-trade-monitoring';

  // Reactive filter state
  private readonly filtersSignal = signal<LiveTradeFiltersDto>({});

  /**
   * Get current filters
   */
  get filters(): LiveTradeFiltersDto {
    return this.filtersSignal();
  }

  /**
   * Update filters
   */
  setFilters(filters: LiveTradeFiltersDto): void {
    this.filtersSignal.set(filters);
  }

  /**
   * Query live trade overview with current filters
   */
  useOverview(filters?: Signal<LiveTradeFiltersDto>) {
    return useAuthQuery<LiveTradeOverviewDto>(() => {
      const currentFilters = filters?.() ?? this.filtersSignal();
      return {
        queryKey: queryKeys.admin.liveTradeMonitoring.overview(currentFilters as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/overview`, currentFilters),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query paginated algorithm activations
   */
  useAlgorithms(query?: Signal<AlgorithmListQueryDto>) {
    return useAuthQuery<PaginatedAlgorithmListDto>(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.liveTradeMonitoring.algorithms(currentQuery as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/algorithms`, currentQuery),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query paginated algorithmic orders
   */
  useOrders(query?: Signal<OrderListQueryDto>) {
    return useAuthQuery<PaginatedOrderListDto>(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.liveTradeMonitoring.orders(currentQuery as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/orders`, currentQuery),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query backtest vs live comparison for a specific algorithm
   */
  useComparison(algorithmId: Signal<string | null>) {
    return useAuthQuery<ComparisonDto>(() => {
      const id = algorithmId();
      return {
        queryKey: queryKeys.admin.liveTradeMonitoring.comparison(id || ''),
        url: `${this.apiUrl}/comparison/${id}`,
        options: { cachePolicy: FREQUENT_POLICY, enabled: !!id }
      };
    });
  }

  /**
   * Query slippage analysis
   */
  useSlippageAnalysis(filters?: Signal<LiveTradeFiltersDto>, enabled?: Signal<boolean>) {
    return useAuthQuery<SlippageAnalysisDto>(() => {
      const currentFilters = filters?.() ?? this.filtersSignal();
      return {
        queryKey: queryKeys.admin.liveTradeMonitoring.slippageAnalysis(currentFilters as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/slippage-analysis`, currentFilters),
        options: { cachePolicy: FREQUENT_POLICY, enabled: enabled?.() ?? true }
      };
    });
  }

  /**
   * Query user activity
   */
  useUserActivity(query?: Signal<UserActivityQueryDto>, enabled?: Signal<boolean>) {
    return useAuthQuery<PaginatedUserActivityDto>(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.liveTradeMonitoring.userActivity(currentQuery as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/user-activity`, currentQuery),
        options: { cachePolicy: FREQUENT_POLICY, enabled: enabled?.() ?? true }
      };
    });
  }

  /**
   * Query performance alerts
   */
  useAlerts(filters?: Signal<LiveTradeFiltersDto>, enabled?: Signal<boolean>) {
    return useAuthQuery<AlertsDto>(() => {
      const currentFilters = filters?.() ?? this.filtersSignal();
      return {
        queryKey: queryKeys.admin.liveTradeMonitoring.alerts(currentFilters as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/alerts`, currentFilters),
        options: { cachePolicy: FREQUENT_POLICY, enabled: enabled?.() ?? true }
      };
    });
  }

  /**
   * Download export file
   */
  async downloadExport(format: ExportFormat, filters?: LiveTradeFiltersDto): Promise<void> {
    const url = buildUrl(`${this.apiUrl}/export/orders`, { ...filters, format });

    const response = await authenticatedBlobFetch(url);
    const blob = await response.blob();
    const filename = `algorithmic-orders.${format}`;

    // Create download link
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }
}
