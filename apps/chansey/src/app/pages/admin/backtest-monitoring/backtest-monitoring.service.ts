import { Injectable, Signal } from '@angular/core';

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
import {
  authenticatedBlobFetch,
  buildUrl,
  FREQUENT_POLICY,
  queryKeys,
  REALTIME_POLICY,
  type UrlParamValue,
  useAuthQuery
} from '@chansey/shared';

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
    return useAuthQuery<BacktestOverviewDto>(() => {
      const currentFilters = filters?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.overview(currentFilters as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/overview`, currentFilters),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query paginated backtest list
   */
  useBacktests(query?: Signal<BacktestListQueryDto>) {
    return useAuthQuery<PaginatedBacktestListDto>(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.backtests(currentQuery as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/backtests`, currentQuery),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query signal analytics
   */
  useSignalAnalytics(filters?: Signal<BacktestFiltersDto>) {
    return useAuthQuery<SignalAnalyticsDto>(() => {
      const currentFilters = filters?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.signalAnalytics(currentFilters as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/signal-analytics`, currentFilters),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query trade analytics
   */
  useTradeAnalytics(filters?: Signal<BacktestFiltersDto>) {
    return useAuthQuery<TradeAnalyticsDto>(() => {
      const currentFilters = filters?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.tradeAnalytics(currentFilters as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/trade-analytics`, currentFilters),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query optimization analytics
   */
  useOptimizationAnalytics(filters?: Signal<OptimizationFiltersDto>) {
    return useAuthQuery<OptimizationAnalyticsDto>(() => {
      const currentFilters = filters?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.optimizationAnalytics(currentFilters as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/optimization-analytics`, currentFilters),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query paper trading analytics
   */
  usePaperTradingAnalytics(filters?: Signal<PaperTradingFiltersDto>) {
    return useAuthQuery<PaperTradingMonitoringDto>(() => {
      const currentFilters = filters?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.paperTradingAnalytics(currentFilters as Record<string, unknown>),
        url: buildUrl(`${this.apiUrl}/paper-trading-analytics`, currentFilters),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query paginated optimization runs with progress
   */
  useOptimizationRuns(query?: Signal<Record<string, UrlParamValue>>) {
    return useAuthQuery<PaginatedOptimizationRunsDto>(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.optimizationRuns(currentQuery),
        url: buildUrl(`${this.apiUrl}/optimization/runs`, currentQuery),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query paginated live replay runs with progress
   */
  useLiveReplayRuns(query?: Signal<Record<string, UrlParamValue>>) {
    return useAuthQuery<PaginatedLiveReplayRunsDto>(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.liveReplayRuns(currentQuery),
        url: buildUrl(`${this.apiUrl}/live-replay/runs`, currentQuery),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query paginated paper trading sessions with progress
   */
  usePaperTradingSessions(query?: Signal<Record<string, UrlParamValue>>) {
    return useAuthQuery<PaginatedPaperTradingSessionsDto>(() => {
      const currentQuery = query?.() ?? {};
      return {
        queryKey: queryKeys.admin.backtestMonitoring.paperTradingSessions(currentQuery),
        url: buildUrl(`${this.apiUrl}/paper-trading/sessions`, currentQuery),
        options: { cachePolicy: FREQUENT_POLICY }
      };
    });
  }

  /**
   * Query pipeline stage counts
   */
  usePipelineStageCounts() {
    return useAuthQuery<PipelineStageCountsDto>(() => ({
      queryKey: queryKeys.admin.backtestMonitoring.pipelineStageCounts(),
      url: `${this.apiUrl}/pipeline-stage-counts`,
      options: { cachePolicy: FREQUENT_POLICY }
    }));
  }

  /**
   * Query signal activity feed with auto-refresh
   *
   * Uses REALTIME policy for ~45s auto-refresh
   */
  useSignalActivityFeed(limit?: Signal<number>, enabled?: Signal<boolean>) {
    return useAuthQuery<SignalActivityFeedDto>(() => {
      const currentLimit = limit?.() ?? 100;
      return {
        queryKey: queryKeys.admin.backtestMonitoring.signalActivityFeed(currentLimit),
        url: buildUrl(`${this.apiUrl}/signal-activity-feed`, { limit: currentLimit }),
        options: {
          cachePolicy: REALTIME_POLICY,
          enabled: enabled?.() ?? true
        }
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

    const response = await authenticatedBlobFetch(url);
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
