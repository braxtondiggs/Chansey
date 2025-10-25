import { Injectable } from '@angular/core';

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

import { backtestKeys, comparisonKeys } from '@chansey-web/app/core/query/query.keys';
import { useAuthMutation, useAuthQuery } from '@chansey-web/app/core/query/query.utils';

@Injectable({
  providedIn: 'root'
})
export class BacktestingService {
  private readonly apiUrl = '/api/backtests';
  private readonly gatewayUrl = '/backtests';

  useBacktests() {
    return useAuthQuery<BacktestRunCollection>(backtestKeys.all, this.apiUrl);
  }

  useBacktestSignals() {
    return useAuthQuery<BacktestSignalCollection, string>(
      (id: string) => backtestKeys.signals(id),
      (id: string) => `${this.apiUrl}/${id}/signals`
    );
  }

  useBacktestTrades() {
    return useAuthQuery<SimulatedOrderFillCollection, string>(
      (id: string) => backtestKeys.trades(id),
      (id: string) => `${this.apiUrl}/${id}/trades`
    );
  }

  useDatasets() {
    return useAuthQuery<MarketDataSet[]>(backtestKeys.datasets, `${this.apiUrl}/datasets`);
  }

  useCreateBacktest() {
    return useAuthMutation<BacktestRunDetail, CreateBacktestRequest>(this.apiUrl, 'POST', {
      invalidateQueries: [backtestKeys.all]
    });
  }

  useComparisonReport() {
    return useAuthQuery<ComparisonReportResponse, string>(
      (id: string) => comparisonKeys.detail(id),
      (id: string) => `/api/comparison-reports/${id}`
    );
  }

  useCreateComparisonReport() {
    return useAuthMutation<ComparisonReportResponse, CreateComparisonReportRequest>('/api/comparison-reports', 'POST');
  }

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
