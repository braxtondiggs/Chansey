import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import {
  BacktestFiltersDto,
  BacktestListQueryDto,
  BacktestOverviewDto,
  ExportFormat,
  OptimizationAnalyticsDto,
  OptimizationFiltersDto,
  PaginatedBacktestListDto,
  PaginatedLiveReplayRunsDto,
  PaginatedOptimizationRunsDto,
  PaginatedPaperTradingSessionsDto,
  PaperTradingFiltersDto,
  PaperTradingMonitoringDto,
  PipelineStageCountsDto,
  SignalActivityFeedDto,
  SignalAnalyticsDto,
  TradeAnalyticsDto
} from '@chansey/api-interfaces';
import { FREQUENT_POLICY, REALTIME_POLICY, authenticatedFetch, queryKeys } from '@chansey/shared';

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

  /**
   * Query backtest overview with current filters
   *
   * Uses FREQUENT policy for dashboard refresh
   */
  useOverview(filters?: Signal<BacktestFiltersDto>) {
    return injectQuery(() => {
      const currentFilters = filters?.() ?? {};
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
      const currentFilters = filters?.() ?? {};
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
      const currentFilters = filters?.() ?? {};
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
   * Query optimization analytics
   */
  useOptimizationAnalytics(filters?: Signal<OptimizationFiltersDto>) {
    return injectQuery(() => {
      const currentFilters = filters?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.optimizationAnalytics(currentFilters as Record<string, unknown>),
        queryFn: () =>
          authenticatedFetch<OptimizationAnalyticsDto>(
            buildUrl(`${this.apiUrl}/optimization-analytics`, currentFilters as Record<string, unknown>)
          ),
        ...FREQUENT_POLICY
      };
    });
  }

  /**
   * Query paper trading analytics
   */
  usePaperTradingAnalytics(filters?: Signal<PaperTradingFiltersDto>) {
    return injectQuery(() => {
      const currentFilters = filters?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.paperTradingAnalytics(currentFilters as Record<string, unknown>),
        queryFn: () =>
          authenticatedFetch<PaperTradingMonitoringDto>(
            buildUrl(`${this.apiUrl}/paper-trading-analytics`, currentFilters as Record<string, unknown>)
          ),
        ...FREQUENT_POLICY
      };
    });
  }

  /**
   * Query paginated optimization runs with progress
   */
  useOptimizationRuns(query?: Signal<Record<string, unknown>>) {
    return injectQuery(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.optimizationRuns(currentQuery),
        queryFn: () =>
          authenticatedFetch<PaginatedOptimizationRunsDto>(buildUrl(`${this.apiUrl}/optimization/runs`, currentQuery)),
        ...FREQUENT_POLICY
      };
    });
  }

  /**
   * Query paginated live replay runs with progress
   */
  useLiveReplayRuns(query?: Signal<Record<string, unknown>>) {
    return injectQuery(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.liveReplayRuns(currentQuery),
        queryFn: () =>
          authenticatedFetch<PaginatedLiveReplayRunsDto>(buildUrl(`${this.apiUrl}/live-replay/runs`, currentQuery)),
        ...FREQUENT_POLICY
      };
    });
  }

  /**
   * Query paginated paper trading sessions with progress
   */
  usePaperTradingSessions(query?: Signal<Record<string, unknown>>) {
    return injectQuery(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.paperTradingSessions(currentQuery),
        queryFn: () =>
          authenticatedFetch<PaginatedPaperTradingSessionsDto>(
            buildUrl(`${this.apiUrl}/paper-trading/sessions`, currentQuery)
          ),
        ...FREQUENT_POLICY
      };
    });
  }

  /**
   * Query pipeline stage counts
   */
  usePipelineStageCounts() {
    return injectQuery(() => ({
      queryKey: queryKeys.admin.backtestMonitoring.pipelineStageCounts(),
      queryFn: () => authenticatedFetch<PipelineStageCountsDto>(`${this.apiUrl}/pipeline-stage-counts`),
      ...FREQUENT_POLICY
    }));
  }

  /**
   * Query signal activity feed with auto-refresh
   *
   * Uses REALTIME policy for ~45s auto-refresh
   */
  useSignalActivityFeed(limit?: Signal<number>, enabled?: Signal<boolean>) {
    return injectQuery(() => {
      const currentLimit = limit?.() ?? 100;
      return {
        queryKey: queryKeys.admin.backtestMonitoring.signalActivityFeed(currentLimit),
        queryFn: () =>
          authenticatedFetch<SignalActivityFeedDto>(
            buildUrl(`${this.apiUrl}/signal-activity-feed`, { limit: currentLimit })
          ),
        enabled: enabled?.() ?? true,
        ...REALTIME_POLICY
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
