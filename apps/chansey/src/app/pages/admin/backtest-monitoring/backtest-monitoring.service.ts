import { Injectable, Signal, signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import {
  BacktestFiltersDto,
  BacktestListQueryDto,
  BacktestOverviewDto,
  ExportFormat,
  PaginatedBacktestListDto,
  SignalAnalyticsDto,
  TradeAnalyticsDto
} from '@chansey/api-interfaces';
import { FREQUENT_POLICY, authenticatedFetch, queryKeys } from '@chansey/shared';

/**
 * Builds URL with query parameters
 */
function buildUrl(base: string, params?: Record<string, unknown>): string {
  if (!params) return base;

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `${base}?${queryString}` : base;
}

/**
 * Service for backtest monitoring dashboard via TanStack Query
 *
 * Admin-only endpoints for monitoring backtest performance and analytics.
 */
@Injectable({
  providedIn: 'root'
})
export class BacktestMonitoringService {
  private readonly apiUrl = '/api/admin/backtest-monitoring';

  // Reactive filter state
  private readonly filtersSignal = signal<BacktestFiltersDto>({});

  /**
   * Get current filters
   */
  get filters(): BacktestFiltersDto {
    return this.filtersSignal();
  }

  /**
   * Update filters
   */
  setFilters(filters: BacktestFiltersDto): void {
    this.filtersSignal.set(filters);
  }

  /**
   * Query backtest overview with current filters
   *
   * Uses FREQUENT policy for dashboard refresh
   */
  useOverview(filters?: Signal<BacktestFiltersDto>) {
    return injectQuery(() => {
      const currentFilters = filters?.() ?? this.filtersSignal();
      return {
        queryKey: queryKeys.admin.backtestMonitoring.overview(currentFilters as Record<string, unknown>),
        queryFn: () =>
          authenticatedFetch<BacktestOverviewDto>(
            buildUrl(`${this.apiUrl}/overview`, currentFilters as Record<string, unknown>)
          ),
        ...FREQUENT_POLICY
      };
    });
  }

  /**
   * Query paginated backtest list
   */
  useBacktests(query?: Signal<BacktestListQueryDto>) {
    return injectQuery(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.backtests(currentQuery as Record<string, unknown>),
        queryFn: () =>
          authenticatedFetch<PaginatedBacktestListDto>(
            buildUrl(`${this.apiUrl}/backtests`, currentQuery as Record<string, unknown>)
          ),
        ...FREQUENT_POLICY
      };
    });
  }

  /**
   * Query signal analytics
   */
  useSignalAnalytics(filters?: Signal<BacktestFiltersDto>) {
    return injectQuery(() => {
      const currentFilters = filters?.() ?? this.filtersSignal();
      return {
        queryKey: queryKeys.admin.backtestMonitoring.signalAnalytics(currentFilters as Record<string, unknown>),
        queryFn: () =>
          authenticatedFetch<SignalAnalyticsDto>(
            buildUrl(`${this.apiUrl}/signal-analytics`, currentFilters as Record<string, unknown>)
          ),
        ...FREQUENT_POLICY
      };
    });
  }

  /**
   * Query trade analytics
   */
  useTradeAnalytics(filters?: Signal<BacktestFiltersDto>) {
    return injectQuery(() => {
      const currentFilters = filters?.() ?? this.filtersSignal();
      return {
        queryKey: queryKeys.admin.backtestMonitoring.tradeAnalytics(currentFilters as Record<string, unknown>),
        queryFn: () =>
          authenticatedFetch<TradeAnalyticsDto>(
            buildUrl(`${this.apiUrl}/trade-analytics`, currentFilters as Record<string, unknown>)
          ),
        ...FREQUENT_POLICY
      };
    });
  }

  /**
   * Download export file
   */
  async downloadExport(
    type: 'backtests' | 'signals' | 'trades',
    format: ExportFormat,
    backtestId?: string,
    filters?: BacktestFiltersDto
  ): Promise<void> {
    let url: string;

    if (type === 'backtests') {
      url = buildUrl(`${this.apiUrl}/export/backtests`, { ...filters, format });
    } else if (type === 'signals' && backtestId) {
      url = buildUrl(`${this.apiUrl}/export/signals/${backtestId}`, { format });
    } else if (type === 'trades' && backtestId) {
      url = buildUrl(`${this.apiUrl}/export/trades/${backtestId}`, { format });
    } else {
      throw new Error('Invalid export parameters');
    }

    const response = await fetch(url, { credentials: 'include' });

    if (!response.ok) {
      // Try to extract detailed error message from response
      let errorDetail = response.statusText;
      try {
        const errorBody = await response.json();
        errorDetail = errorBody.message || errorBody.error || errorDetail;
      } catch {
        // Ignore JSON parse errors, use statusText
      }
      throw new Error(`Export failed: ${errorDetail}`);
    }

    const blob = await response.blob();
    const filename =
      type === 'backtests'
        ? `backtests.${format}`
        : type === 'signals'
          ? `signals-${backtestId}.${format}`
          : `trades-${backtestId}.${format}`;

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
