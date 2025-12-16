import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { io, Socket } from 'socket.io-client';

import {
  BacktestRunCollection,
  BacktestSignalCollection,
  SimulatedOrderFillCollection,
  MarketDataSet,
  CreateBacktestRequest,
  BacktestRunDetail,
  ComparisonReportResponse,
  CreateComparisonReportRequest
} from '@chansey/api-interfaces';
import {
  queryKeys,
  useAuthMutation,
  useAuthQuery,
  authenticatedFetch,
  STANDARD_POLICY,
  STATIC_POLICY
} from '@chansey/shared';

/**
 * Service for backtesting operations via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class BacktestingService {
  private readonly apiUrl = '/api/backtests';
  private readonly gatewayUrl = '/backtests';

  /**
   * Query all backtests
   */
  useBacktests() {
    return useAuthQuery<BacktestRunCollection>(queryKeys.backtests.lists(), this.apiUrl, {
      cachePolicy: STANDARD_POLICY
    });
  }

  /**
   * Query backtest signals for a specific backtest (dynamic query)
   *
   * @param backtestId - Signal containing the backtest ID
   */
  useBacktestSignals(backtestId: Signal<string | null>) {
    return injectQuery(() => {
      const id = backtestId();
      return {
        queryKey: queryKeys.backtests.signals(id || ''),
        queryFn: () => authenticatedFetch<BacktestSignalCollection>(`${this.apiUrl}/${id}/signals`),
        ...STANDARD_POLICY,
        enabled: !!id
      };
    });
  }

  /**
   * Query backtest trades for a specific backtest (dynamic query)
   *
   * @param backtestId - Signal containing the backtest ID
   */
  useBacktestTrades(backtestId: Signal<string | null>) {
    return injectQuery(() => {
      const id = backtestId();
      return {
        queryKey: queryKeys.backtests.trades(id || ''),
        queryFn: () => authenticatedFetch<SimulatedOrderFillCollection>(`${this.apiUrl}/${id}/trades`),
        ...STANDARD_POLICY,
        enabled: !!id
      };
    });
  }

  /**
   * Query available datasets
   *
   * Uses STATIC policy since datasets rarely change
   */
  useDatasets() {
    return useAuthQuery<MarketDataSet[]>(queryKeys.backtests.datasets(), `${this.apiUrl}/datasets`, {
      cachePolicy: STATIC_POLICY
    });
  }

  /**
   * Create a new backtest
   */
  useCreateBacktest() {
    return useAuthMutation<BacktestRunDetail, CreateBacktestRequest>(this.apiUrl, 'POST', {
      invalidateQueries: [queryKeys.backtests.all]
    });
  }

  /**
   * Query a comparison report (dynamic query)
   *
   * @param reportId - Signal containing the report ID
   */
  useComparisonReport(reportId: Signal<string | null>) {
    return injectQuery(() => {
      const id = reportId();
      return {
        queryKey: queryKeys.comparisonReports.detail(id || ''),
        queryFn: () => authenticatedFetch<ComparisonReportResponse>(`/api/comparison-reports/${id}`),
        ...STANDARD_POLICY,
        enabled: !!id
      };
    });
  }

  /**
   * Create a comparison report
   */
  useCreateComparisonReport() {
    return useAuthMutation<ComparisonReportResponse, CreateComparisonReportRequest>('/api/comparison-reports', 'POST');
  }

  /**
   * Subscribe to real-time backtest telemetry via WebSocket
   */
  subscribeToTelemetry(backtestId: string) {
    const socket: Socket = io(this.gatewayUrl, {
      withCredentials: true,
      transports: ['websocket']
    });

    socket.emit('subscribe', { backtestId });

    return {
      on<T>(event: string, handler: (payload: T) => void) {
        socket.on(event, handler);
      },
      disconnect() {
        socket.emit('unsubscribe', { backtestId });
        socket.disconnect();
      }
    };
  }
}
