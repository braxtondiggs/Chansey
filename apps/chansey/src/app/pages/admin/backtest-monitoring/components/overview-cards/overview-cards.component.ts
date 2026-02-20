import { CommonModule, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';

import { BacktestOverviewDto, BacktestStatus, PipelineStageCountsDto } from '@chansey/api-interfaces';

@Component({
  selector: 'app-overview-cards',
  standalone: true,
  imports: [CommonModule, CardModule, DecimalPipe],
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Pipeline Flow -->
    @if (pipelineStageCounts) {
      <!-- Mobile: compact strip -->
      <div
        class="bg-surface-0 dark:bg-surface-900 border-surface-200 dark:border-surface-700 mb-3 rounded-lg border p-3 md:hidden"
      >
        <div class="divide-surface-200 dark:divide-surface-700 grid grid-cols-4 divide-x">
          <div class="flex flex-col items-center">
            <span class="text-lg font-bold text-orange-500">{{ pipelineStageCounts.optimizationRuns }}</span>
            <span class="text-surface-500 text-[10px]">Optimize</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-lg font-bold text-blue-500">{{ pipelineStageCounts.historicalBacktests }}</span>
            <span class="text-surface-500 text-[10px]">Historical</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-lg font-bold text-teal-500">{{ pipelineStageCounts.liveReplayBacktests }}</span>
            <span class="text-surface-500 text-[10px]">Live Replay</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-lg font-bold text-purple-500">{{ pipelineStageCounts.paperTradingSessions }}</span>
            <span class="text-surface-500 text-[10px]">Paper Trade</span>
          </div>
        </div>
      </div>

      <!-- Desktop: cards with arrows -->
      <div class="mb-4 hidden items-center gap-2 md:flex">
        <div class="min-w-0 flex-1">
          <p-card styleClass="pipeline-stage border-l-3 border-orange-500">
            <div class="flex items-center gap-3">
              <span class="text-2xl font-bold text-orange-500">{{ pipelineStageCounts.optimizationRuns }}</span>
              <span class="text-surface-500 text-sm">Optimization</span>
            </div>
          </p-card>
        </div>
        <i class="pi pi-arrow-right text-surface-400 shrink-0 text-xs"></i>
        <div class="min-w-0 flex-1">
          <p-card styleClass="pipeline-stage border-l-3 border-blue-500">
            <div class="flex items-center gap-3">
              <span class="text-2xl font-bold text-blue-500">{{ pipelineStageCounts.historicalBacktests }}</span>
              <span class="text-surface-500 text-sm">Historical</span>
            </div>
          </p-card>
        </div>
        <i class="pi pi-arrow-right text-surface-400 shrink-0 text-xs"></i>
        <div class="min-w-0 flex-1">
          <p-card styleClass="pipeline-stage border-l-3 border-teal-500">
            <div class="flex items-center gap-3">
              <span class="text-2xl font-bold text-teal-500">{{ pipelineStageCounts.liveReplayBacktests }}</span>
              <span class="text-surface-500 text-sm">Live Replay</span>
            </div>
          </p-card>
        </div>
        <i class="pi pi-arrow-right text-surface-400 shrink-0 text-xs"></i>
        <div class="min-w-0 flex-1">
          <p-card styleClass="pipeline-stage border-l-3 border-purple-500">
            <div class="flex items-center gap-3">
              <span class="text-2xl font-bold text-purple-500">{{ pipelineStageCounts.paperTradingSessions }}</span>
              <span class="text-surface-500 text-sm">Paper Trading</span>
            </div>
          </p-card>
        </div>
      </div>
    }

    <!-- Summary Card -->
    <p-card>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
        <!-- Status Breakdown -->
        <div>
          <h4 class="text-surface-400 mb-2 text-xs font-semibold tracking-wider uppercase md:mb-3">Status</h4>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 md:flex md:flex-col md:gap-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span class="inline-block h-2 w-2 rounded-full bg-blue-500"></span>
                <span class="text-sm">Running</span>
              </div>
              <span class="font-semibold">{{ getStatusCount(BacktestStatus.RUNNING) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
                <span class="text-sm">Completed</span>
              </div>
              <span class="font-semibold">{{ getStatusCount(BacktestStatus.COMPLETED) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span class="inline-block h-2 w-2 rounded-full bg-red-500"></span>
                <span class="text-sm">Failed</span>
              </div>
              <span class="font-semibold">{{ getStatusCount(BacktestStatus.FAILED) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span class="inline-block h-2 w-2 rounded-full bg-yellow-500"></span>
                <span class="text-sm">Pending</span>
              </div>
              <span class="font-semibold">{{ getStatusCount(BacktestStatus.PENDING) }}</span>
            </div>
          </div>
        </div>

        <!-- Performance Metrics -->
        <div class="border-surface-200 dark:border-surface-700 border-t pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-6">
          <h4 class="text-surface-400 mb-2 text-xs font-semibold tracking-wider uppercase md:mb-3">Performance</h4>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 md:flex md:flex-col md:gap-2">
            <div class="flex items-center justify-between">
              <span class="text-surface-500 text-sm">Sharpe</span>
              <span class="font-semibold text-purple-500">
                {{ overview?.averageMetrics?.sharpeRatio | number: '1.2-2' }}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-surface-500 text-sm">Return</span>
              <span class="font-semibold" [class]="getReturnClass()">
                {{ overview?.averageMetrics?.totalReturn | number: '1.1-1' }}%
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-surface-500 text-sm">Drawdown</span>
              <span class="font-semibold text-red-400">
                {{ overview?.averageMetrics?.maxDrawdown | number: '1.1-1' }}%
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-surface-500 text-sm">Win Rate</span>
              <span class="font-semibold text-blue-400">
                {{ overview?.averageMetrics?.winRate | number: '1.1-1' }}%
              </span>
            </div>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="border-surface-200 dark:border-surface-700 border-t pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-6">
          <h4 class="text-surface-400 mb-2 text-xs font-semibold tracking-wider uppercase md:mb-3">Activity</h4>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 md:flex md:flex-col md:gap-2">
            <div class="flex items-center justify-between">
              <span class="text-surface-500 text-sm">24h</span>
              <span class="text-primary font-semibold">{{ overview?.recentActivity?.last24h || 0 }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-surface-500 text-sm">7 days</span>
              <span class="font-semibold text-blue-400">{{ overview?.recentActivity?.last7d || 0 }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-surface-500 text-sm">30 days</span>
              <span class="font-semibold text-indigo-400">{{ overview?.recentActivity?.last30d || 0 }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">Total</span>
              <span class="font-bold">{{ overview?.totalBacktests || 0 }}</span>
            </div>
          </div>
        </div>
      </div>
    </p-card>
  `,
  styles: `
    :host ::ng-deep .pipeline-stage .p-card-body {
      padding: 0.75rem 1rem;
    }
  `
})
export class OverviewCardsComponent {
  @Input() overview: BacktestOverviewDto | undefined;
  @Input() pipelineStageCounts: PipelineStageCountsDto | undefined;

  protected readonly BacktestStatus = BacktestStatus;

  getStatusCount(status: BacktestStatus): number {
    if (!this.overview?.statusCounts) return 0;
    return this.overview.statusCounts[status] || 0;
  }

  getReturnClass(): string {
    const returnValue = this.overview?.averageMetrics?.totalReturn || 0;
    return returnValue >= 0 ? 'text-green-500' : 'text-red-500';
  }
}
