import { Injectable } from '@nestjs/common';

import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';

@Injectable()
export class InfraMetricsService {
  constructor(
    @InjectMetric('chansey_http_request_duration_seconds')
    private readonly httpRequestDuration: Histogram<string>,
    @InjectMetric('chansey_http_requests_total')
    private readonly httpRequestsTotal: Counter<string>,
    @InjectMetric('chansey_http_connections_active')
    private readonly httpConnectionsActive: Gauge<string>,

    // Queue
    @InjectMetric('chansey_queue_jobs_waiting')
    private readonly queueJobsWaiting: Gauge<string>,
    @InjectMetric('chansey_queue_jobs_active')
    private readonly queueJobsActive: Gauge<string>,
    @InjectMetric('chansey_queue_jobs_completed_total')
    private readonly queueJobsCompletedTotal: Counter<string>,
    @InjectMetric('chansey_queue_jobs_failed_total')
    private readonly queueJobsFailedTotal: Counter<string>,

    // Price
    @InjectMetric('chansey_price_updates_total')
    private readonly priceUpdatesTotal: Counter<string>,
    @InjectMetric('chansey_price_update_lag_seconds')
    private readonly priceUpdateLag: Gauge<string>
  ) {}

  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestDuration.observe(labels, durationMs / 1000);
    this.httpRequestsTotal.inc(labels);
  }

  setActiveConnections(count: number): void {
    this.httpConnectionsActive.set(count);
  }

  setQueueJobsWaiting(queue: string, count: number): void {
    this.queueJobsWaiting.set({ queue }, count);
  }

  setQueueJobsActive(queue: string, count: number): void {
    this.queueJobsActive.set({ queue }, count);
  }

  recordQueueJobCompleted(queue: string): void {
    this.queueJobsCompletedTotal.inc({ queue });
  }

  recordQueueJobFailed(queue: string, errorType = 'unknown'): void {
    this.queueJobsFailedTotal.inc({ queue, error_type: errorType });
  }

  recordPriceUpdate(source: string, count = 1): void {
    this.priceUpdatesTotal.inc({ source }, count);
  }

  setPriceUpdateLag(source: string, lagSeconds: number): void {
    this.priceUpdateLag.set({ source }, lagSeconds);
  }
}
