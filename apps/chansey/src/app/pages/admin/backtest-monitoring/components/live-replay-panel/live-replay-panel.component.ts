import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { CardModule } from 'primeng/card';
import { ProgressBarModule } from 'primeng/progressbar';
import type { TableLazyLoadEvent } from 'primeng/table';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { BacktestOverviewDto, BacktestStatus, PaginatedLiveReplayRunsDto, ReplaySpeed } from '@chansey/api-interfaces';

@Component({
  selector: 'app-live-replay-panel',
  standalone: true,
  imports: [CardModule, DatePipe, DecimalPipe, ProgressBarModule, TableModule, TagModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Status Counts -->
      <p-card header="Status Counts">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-500">{{ overview()?.statusCounts?.RUNNING || 0 }}</div>
            <div class="text-sm text-gray-500">Running</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-yellow-500">{{ overview()?.statusCounts?.PAUSED || 0 }}</div>
            <div class="text-sm text-gray-500">Paused</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-green-500">{{ overview()?.statusCounts?.COMPLETED || 0 }}</div>
            <div class="text-sm text-gray-500">Completed</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-red-500">{{ overview()?.statusCounts?.FAILED || 0 }}</div>
            <div class="text-sm text-gray-500">Failed</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-gray-500">{{ overview()?.statusCounts?.PENDING || 0 }}</div>
            <div class="text-sm text-gray-500">Pending</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-gray-400">{{ overview()?.statusCounts?.CANCELLED || 0 }}</div>
            <div class="text-sm text-gray-500">Cancelled</div>
          </div>
        </div>
      </p-card>

      <!-- Average Performance -->
      <p-card header="Average Performance">
        <div class="grid grid-cols-2 gap-4">
          <div class="text-center">
            <div class="text-2xl font-bold" [class]="getReturnClass()">
              {{ overview()?.averageMetrics?.totalReturn | number: '1.1-1' }}%
            </div>
            <div class="text-sm text-gray-500">Avg Return</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-red-400">
              {{ overview()?.averageMetrics?.maxDrawdown | number: '1.1-1' }}%
            </div>
            <div class="text-sm text-gray-500">Avg Drawdown</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-purple-500">
              {{ overview()?.averageMetrics?.sharpeRatio | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Avg Sharpe</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-500">
              {{ (overview()?.averageMetrics?.winRate || 0) * 100 | number: '1.0-0' }}%
            </div>
            <div class="text-sm text-gray-500">Avg Win Rate</div>
          </div>
        </div>
      </p-card>
    </div>

    <!-- Recent Live Replay Runs -->
    <div class="mt-4">
      <p-card header="Recent Live Replay Runs">
        <p-table
          [value]="runs()?.data || []"
          [rows]="10"
          [totalRecords]="runs()?.total || 0"
          [lazy]="true"
          (onLazyLoad)="onLazyLoad($event)"
          [paginator]="true"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="{first} to {last} of {totalRecords}"
          styleClass="p-datatable-sm"
        >
          <ng-template #header>
            <tr>
              <th>Name</th>
              <th>Algorithm</th>
              <th>Status</th>
              <th class="text-right">Speed</th>
              <th class="text-right">Progress</th>
              <th class="text-right">Return</th>
              <th class="text-right">Sharpe</th>
              <th>Created</th>
            </tr>
          </ng-template>
          <ng-template #body let-run>
            <tr>
              <td>{{ run.name }}</td>
              <td>{{ run.algorithmName }}</td>
              <td>
                <p-tag [severity]="getRunStatusSeverity(run.status)" [value]="getStatusLabel(run)" />
                @if (run.status === BacktestStatus.RUNNING) {
                  <p-progressBar [value]="run.progressPercent" [showValue]="false" styleClass="h-1 mt-1" />
                }
              </td>
              <td class="text-right">
                @if (run.replaySpeed !== null) {
                  {{ getSpeedLabel(run.replaySpeed) }}
                } @else {
                  <span class="text-gray-400">-</span>
                }
              </td>
              <td class="text-right">
                <span [pTooltip]="run.processedTimestamps + ' / ' + run.totalTimestamps" tooltipPosition="top">
                  {{ run.progressPercent }}%
                </span>
              </td>
              <td class="text-right">
                @if (run.totalReturn !== null) {
                  <span [class]="run.totalReturn >= 0 ? 'text-green-500' : 'text-red-500'">
                    {{ run.totalReturn | number: '1.1-1' }}%
                  </span>
                } @else {
                  <span class="text-gray-400">-</span>
                }
              </td>
              <td class="text-right">
                @if (run.sharpeRatio !== null) {
                  {{ run.sharpeRatio | number: '1.2-2' }}
                } @else {
                  <span class="text-gray-400">-</span>
                }
              </td>
              <td>{{ run.createdAt | date: 'short' }}</td>
            </tr>
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="8" class="py-4 text-center text-gray-500">No live replay runs found</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `
})
export class LiveReplayPanelComponent {
  overview = input<BacktestOverviewDto>();
  runs = input<PaginatedLiveReplayRunsDto>();
  pageChange = output<number>();

  protected readonly BacktestStatus = BacktestStatus;

  getReturnClass(): string {
    return (this.overview()?.averageMetrics?.totalReturn || 0) >= 0 ? 'text-green-500' : 'text-red-500';
  }

  getStatusLabel(run: { status: BacktestStatus; isPaused: boolean | null }): string {
    if (run.status === BacktestStatus.RUNNING && run.isPaused) {
      return 'PAUSED';
    }
    return run.status;
  }

  getSpeedLabel(speed: ReplaySpeed): string {
    switch (speed) {
      case ReplaySpeed.REAL_TIME:
        return '1x';
      case ReplaySpeed.FAST_2X:
        return '2x';
      case ReplaySpeed.FAST_5X:
        return '5x';
      case ReplaySpeed.FAST_10X:
        return '10x';
      case ReplaySpeed.MAX_SPEED:
        return 'Max';
      default:
        return `${speed}x`;
    }
  }

  onLazyLoad(event: TableLazyLoadEvent): void {
    const page = Math.floor((event.first ?? 0) / (event.rows ?? 10)) + 1;
    this.pageChange.emit(page);
  }

  getRunStatusSeverity(status: BacktestStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) {
      case BacktestStatus.COMPLETED:
        return 'success';
      case BacktestStatus.RUNNING:
        return 'info';
      case BacktestStatus.PENDING:
        return 'warn';
      case BacktestStatus.PAUSED:
        return 'warn';
      case BacktestStatus.FAILED:
        return 'danger';
      case BacktestStatus.CANCELLED:
        return 'secondary';
      default:
        return 'secondary';
    }
  }
}
