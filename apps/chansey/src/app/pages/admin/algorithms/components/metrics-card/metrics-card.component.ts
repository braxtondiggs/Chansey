import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { ProgressBarModule } from 'primeng/progressbar';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { AlgorithmMetrics } from '@chansey/api-interfaces';

@Component({
  selector: 'app-metrics-card',
  standalone: true,
  imports: [CommonModule, CardModule, TagModule, TooltipModule, ProgressBarModule],
  template: `
    <p-card>
      <ng-template #header>
        <div class="flex items-center justify-between p-4 pb-0">
          <h3 class="m-0 text-lg font-semibold">Execution Metrics</h3>
          @if (needsMaintenance()) {
            <p-tag value="Needs Attention" severity="warn" icon="pi pi-exclamation-triangle"></p-tag>
          }
        </div>
      </ng-template>

      @if (metrics) {
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1 block text-sm text-gray-500">Total Executions</label>
              <span class="text-2xl font-bold">{{ metrics.totalExecutions ?? 0 }}</span>
            </div>

            <div>
              <label class="mb-1 block text-sm text-gray-500">Success Rate</label>
              <div class="flex items-center gap-2">
                <span class="text-2xl font-bold" [class]="getSuccessRateClass()">
                  {{ formatPercent(metrics.successRate) }}
                </span>
              </div>
            </div>

            <div>
              <label class="mb-1 block text-sm text-gray-500">Successful</label>
              <span class="text-lg font-medium text-green-600">{{ metrics.successfulExecutions ?? 0 }}</span>
            </div>

            <div>
              <label class="mb-1 block text-sm text-gray-500">Failed</label>
              <span class="text-lg font-medium text-red-600">{{ metrics.failedExecutions ?? 0 }}</span>
            </div>
          </div>

          @if (metrics.totalExecutions && metrics.totalExecutions > 0) {
            <div>
              <label class="mb-2 block text-sm text-gray-500">Success/Failure Ratio</label>
              <p-progressBar
                [value]="metrics.successRate ?? 0"
                [showValue]="false"
                styleClass="h-2"
                [style]="{ height: '8px' }"
              ></p-progressBar>
            </div>
          }

          <div class="grid grid-cols-2 gap-4 border-t pt-4 dark:border-gray-700">
            <div>
              <label class="mb-1 block text-sm text-gray-500">Avg Execution Time</label>
              <span class="font-medium">{{ formatExecutionTime(metrics.averageExecutionTime) }}</span>
            </div>

            <div>
              <label class="mb-1 block text-sm text-gray-500">Error Count</label>
              <span class="font-medium" [class.text-red-600]="(metrics.errorCount ?? 0) > 0">
                {{ metrics.errorCount ?? 0 }}
              </span>
            </div>
          </div>

          @if (metrics.lastExecuted) {
            <div class="border-t pt-4 dark:border-gray-700">
              <label class="mb-1 block text-sm text-gray-500">Last Executed</label>
              <span class="font-medium">{{ formatDate(metrics.lastExecuted) }}</span>
            </div>
          }

          @if (metrics.lastError) {
            <div class="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <label class="mb-1 block text-sm font-medium text-red-600">Last Error</label>
              <p class="m-0 text-sm text-red-700 dark:text-red-400">{{ metrics.lastError }}</p>
            </div>
          }
        </div>
      } @else {
        <div class="py-8 text-center">
          <i class="pi pi-chart-bar mb-3 text-4xl text-gray-400"></i>
          <p class="m-0 text-gray-500">No execution metrics available yet.</p>
          <p class="mt-1 text-sm text-gray-400">Execute the algorithm to start collecting metrics.</p>
        </div>
      }
    </p-card>
  `
})
export class MetricsCardComponent {
  @Input() metrics?: AlgorithmMetrics | null;

  needsMaintenance(): boolean {
    if (!this.metrics?.totalExecutions || this.metrics.totalExecutions < 10) {
      return false;
    }
    const errorRate = ((this.metrics.failedExecutions || 0) / this.metrics.totalExecutions) * 100;
    return errorRate > 20;
  }

  getSuccessRateClass(): string {
    const rate = this.metrics?.successRate ?? 0;
    if (rate >= 90) return 'text-green-600';
    if (rate >= 70) return 'text-yellow-600';
    return 'text-red-600';
  }

  formatPercent(value?: number): string {
    if (value === undefined || value === null) return '0%';
    return `${value.toFixed(1)}%`;
  }

  formatExecutionTime(ms?: number): string {
    if (ms === undefined || ms === null) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  formatDate(dateStr?: string): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString();
  }
}
