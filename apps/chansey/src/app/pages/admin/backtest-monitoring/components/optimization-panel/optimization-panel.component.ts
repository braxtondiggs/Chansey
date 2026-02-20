import { CommonModule, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';

import { OptimizationAnalyticsDto, OptimizationStatus } from '@chansey/api-interfaces';

@Component({
  selector: 'app-optimization-panel',
  standalone: true,
  imports: [CommonModule, CardModule, DecimalPipe, TableModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Status Counts -->
      <p-card header="Optimization Status">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-500">{{ getStatusCount(OptimizationStatus.RUNNING) }}</div>
            <div class="text-sm text-gray-500">Running</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-green-500">{{ getStatusCount(OptimizationStatus.COMPLETED) }}</div>
            <div class="text-sm text-gray-500">Completed</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-red-500">{{ getStatusCount(OptimizationStatus.FAILED) }}</div>
            <div class="text-sm text-gray-500">Failed</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-yellow-500">{{ getStatusCount(OptimizationStatus.PENDING) }}</div>
            <div class="text-sm text-gray-500">Pending</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-gray-500">{{ getStatusCount(OptimizationStatus.CANCELLED) }}</div>
            <div class="text-sm text-gray-500">Cancelled</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold">{{ analytics?.totalRuns || 0 }}</div>
            <div class="text-sm text-gray-500">Total Runs</div>
          </div>
        </div>
      </p-card>

      <!-- Average Metrics -->
      <p-card header="Performance Metrics">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div class="text-center">
            <div class="text-2xl font-bold text-green-500">{{ analytics?.avgImprovement | number: '1.1-1' }}%</div>
            <div class="text-sm text-gray-500">Avg Improvement</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-purple-500">
              {{ analytics?.avgBestScore | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Avg Best Score</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-500">
              {{ analytics?.avgCombinationsTested | number: '1.0-0' }}
            </div>
            <div class="text-sm text-gray-500">Avg Combos Tested</div>
          </div>
        </div>
      </p-card>

      <!-- Result Quality -->
      <p-card header="Result Quality">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div class="text-center">
            <div class="text-2xl font-bold">
              {{ analytics?.resultSummary?.avgTrainScore | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Avg Train Score</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold">
              {{ analytics?.resultSummary?.avgTestScore | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Avg Test Score</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold" [class]="getDegradationClass()">
              {{ analytics?.resultSummary?.avgDegradation | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Avg Degradation</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-500">
              {{ analytics?.resultSummary?.avgConsistency | number: '1.0-0' }}
            </div>
            <div class="text-sm text-gray-500">Avg Consistency</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold" [class]="getOverfittingClass()">
              {{ (analytics?.resultSummary?.overfittingRate || 0) * 100 | number: '1.0-0' }}%
            </div>
            <div class="text-sm text-gray-500">Overfitting Rate</div>
          </div>
        </div>
      </p-card>

      <!-- Top Strategies -->
      <p-card header="Top Strategies">
        <p-table [value]="analytics?.topStrategies || []" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Algorithm</th>
              <th class="text-right">Runs</th>
              <th class="text-right">Avg Improvement</th>
              <th class="text-right">Avg Best Score</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td class="font-medium">{{ item.algorithmName }}</td>
              <td class="text-right">{{ item.runCount }}</td>
              <td class="text-right">
                <span [class]="item.avgImprovement >= 0 ? 'text-green-500' : 'text-red-500'">
                  {{ item.avgImprovement | number: '1.1-1' }}%
                </span>
              </td>
              <td class="text-right">{{ item.avgBestScore | number: '1.2-2' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4" class="py-4 text-center text-gray-500">No optimization data available</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `
})
export class OptimizationPanelComponent {
  @Input() analytics: OptimizationAnalyticsDto | undefined;

  protected readonly OptimizationStatus = OptimizationStatus;

  getStatusCount(status: OptimizationStatus): number {
    if (!this.analytics?.statusCounts) return 0;
    return this.analytics.statusCounts[status] || 0;
  }

  getDegradationClass(): string {
    const deg = this.analytics?.resultSummary?.avgDegradation || 0;
    return deg > 0.3 ? 'text-red-500' : deg > 0.15 ? 'text-yellow-500' : 'text-green-500';
  }

  getOverfittingClass(): string {
    const rate = this.analytics?.resultSummary?.overfittingRate || 0;
    return rate > 0.3 ? 'text-red-500' : rate > 0.15 ? 'text-yellow-500' : 'text-green-500';
  }
}
