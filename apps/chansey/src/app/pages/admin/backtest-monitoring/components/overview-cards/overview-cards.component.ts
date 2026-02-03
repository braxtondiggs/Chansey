import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';

import { BacktestOverviewDto, BacktestStatus } from '@chansey/api-interfaces';

@Component({
  selector: 'app-overview-cards',
  standalone: true,
  imports: [CommonModule, CardModule, DecimalPipe],
  template: `
    <div class="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
      <!-- Status Cards -->
      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold text-blue-500">{{ getStatusCount('RUNNING') }}</span>
          <span class="mt-1 text-sm text-gray-500">Running</span>
        </div>
      </p-card>

      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold text-green-500">{{ getStatusCount('COMPLETED') }}</span>
          <span class="mt-1 text-sm text-gray-500">Completed</span>
        </div>
      </p-card>

      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold text-red-500">{{ getStatusCount('FAILED') }}</span>
          <span class="mt-1 text-sm text-gray-500">Failed</span>
        </div>
      </p-card>

      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold text-yellow-500">{{ getStatusCount('PENDING') }}</span>
          <span class="mt-1 text-sm text-gray-500">Pending</span>
        </div>
      </p-card>

      <!-- Metrics Cards -->
      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold text-purple-500">
            {{ overview?.averageMetrics?.sharpeRatio | number: '1.2-2' }}
          </span>
          <span class="mt-1 text-sm text-gray-500">Avg Sharpe</span>
        </div>
      </p-card>

      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold" [class]="getReturnClass()">
            {{ overview?.averageMetrics?.totalReturn | number: '1.1-1' }}%
          </span>
          <span class="mt-1 text-sm text-gray-500">Avg Return</span>
        </div>
      </p-card>
    </div>

    <!-- Recent Activity -->
    <p-card class="mt-4" styleClass="!rounded-b-none bg-surface-50 dark:bg-surface-800">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <i class="pi pi-history text-primary text-xl"></i>
          <span class="font-semibold">Recent Activity</span>
        </div>
        <div class="grid grid-cols-2 gap-6 sm:flex sm:gap-8">
          <div class="flex flex-col items-center">
            <span class="text-primary text-2xl font-bold">{{ overview?.recentActivity?.last24h || 0 }}</span>
            <span class="text-surface-500 text-xs">Last 24h</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-2xl font-bold text-blue-400">{{ overview?.recentActivity?.last7d || 0 }}</span>
            <span class="text-surface-500 text-xs">Last 7 days</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-2xl font-bold text-indigo-400">{{ overview?.recentActivity?.last30d || 0 }}</span>
            <span class="text-surface-500 text-xs">Last 30 days</span>
          </div>
          <div class="border-surface-200 dark:border-surface-600 flex flex-col items-center border-l pl-6">
            <span class="text-2xl font-bold">{{ overview?.totalBacktests || 0 }}</span>
            <span class="text-surface-500 text-xs">Total</span>
          </div>
        </div>
      </div>
    </p-card>
  `
})
export class OverviewCardsComponent {
  @Input() overview: BacktestOverviewDto | undefined;

  getStatusCount(status: string): number {
    if (!this.overview?.statusCounts) return 0;
    return this.overview.statusCounts[status as BacktestStatus] || 0;
  }

  getReturnClass(): string {
    const returnValue = this.overview?.averageMetrics?.totalReturn || 0;
    return returnValue >= 0 ? 'text-green-500' : 'text-red-500';
  }
}
