import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { CardModule } from 'primeng/card';
import { ProgressBarModule } from 'primeng/progressbar';
import type { TableLazyLoadEvent } from 'primeng/table';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { OptimizationAnalyticsDto, OptimizationStatus, PaginatedOptimizationRunsDto } from '@chansey/api-interfaces';

@Component({
  selector: 'app-optimization-panel',
  standalone: true,
  imports: [CardModule, DatePipe, DecimalPipe, ProgressBarModule, TableModule, TagModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Average Metrics -->
      <p-card header="Performance Metrics">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div class="text-center">
            <div class="text-2xl font-bold text-green-500">{{ analytics()?.avgImprovement | number: '1.1-1' }}%</div>
            <div class="text-sm text-gray-500">Avg Improvement</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-purple-500">
              {{ analytics()?.avgBestScore | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Avg Best Score</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-500">
              {{ analytics()?.avgCombinationsTested | number: '1.0-0' }}
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
              {{ analytics()?.resultSummary?.avgTrainScore | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Avg Train Score</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold">
              {{ analytics()?.resultSummary?.avgTestScore | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Avg Test Score</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold" [class]="getDegradationClass()">
              {{ analytics()?.resultSummary?.avgDegradation | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Avg Degradation</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-500">
              {{ analytics()?.resultSummary?.avgConsistency | number: '1.0-0' }}
            </div>
            <div class="text-sm text-gray-500">Avg Consistency</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold" [class]="getOverfittingClass()">
              {{ (analytics()?.resultSummary?.overfittingRate || 0) * 100 | number: '1.0-0' }}%
            </div>
            <div class="text-sm text-gray-500">Overfitting Rate</div>
          </div>
        </div>
      </p-card>

      <!-- Top Strategies -->
      <p-card header="Top Strategies">
        <p-table [value]="analytics()?.topStrategies || []" styleClass="p-datatable-sm">
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

    <!-- Recent Runs -->
    <div class="mt-4">
      <p-card header="Recent Runs">
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
          <ng-template pTemplate="header">
            <tr>
              <th>Strategy</th>
              <th>Status</th>
              <th class="text-right">Combos Tested</th>
              <th class="text-right">Improvement</th>
              <th class="text-right">Best Score</th>
              <th>Created</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-run>
            <tr>
              <td>
                <span [pTooltip]="run.algorithmName" tooltipPosition="top">{{ run.strategyName }}</span>
              </td>
              <td>
                <p-tag [severity]="getRunStatusSeverity(run.status)" [value]="run.status" />
                @if (run.status === OptimizationStatus.RUNNING) {
                  <p-progressBar [value]="run.progressPercent" [showValue]="false" styleClass="h-1 mt-1" />
                }
              </td>
              <td class="text-right">{{ run.combinationsTested }} / {{ run.totalCombinations }}</td>
              <td class="text-right">
                @if (run.improvement !== null) {
                  <span [class]="run.improvement >= 0 ? 'text-green-500' : 'text-red-500'">
                    {{ run.improvement | number: '1.1-1' }}%
                  </span>
                } @else {
                  <span class="text-gray-400">-</span>
                }
              </td>
              <td class="text-right">
                @if (run.bestScore !== null) {
                  {{ run.bestScore | number: '1.2-2' }}
                } @else {
                  <span class="text-gray-400">-</span>
                }
              </td>
              <td>{{ run.createdAt | date: 'short' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="6" class="py-4 text-center text-gray-500">No optimization runs found</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `
})
export class OptimizationPanelComponent {
  analytics = input<OptimizationAnalyticsDto>();
  runs = input<PaginatedOptimizationRunsDto>();
  pageChange = output<number>();

  protected readonly OptimizationStatus = OptimizationStatus;

  getDegradationClass(): string {
    const deg = this.analytics()?.resultSummary?.avgDegradation || 0;
    return deg > 0.3 ? 'text-red-500' : deg > 0.15 ? 'text-yellow-500' : 'text-green-500';
  }

  getOverfittingClass(): string {
    const rate = this.analytics()?.resultSummary?.overfittingRate || 0;
    return rate > 0.3 ? 'text-red-500' : rate > 0.15 ? 'text-yellow-500' : 'text-green-500';
  }

  onLazyLoad(event: TableLazyLoadEvent): void {
    const page = Math.floor((event.first ?? 0) / (event.rows ?? 10)) + 1;
    this.pageChange.emit(page);
  }

  getRunStatusSeverity(status: OptimizationStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) {
      case OptimizationStatus.COMPLETED:
        return 'success';
      case OptimizationStatus.RUNNING:
        return 'info';
      case OptimizationStatus.PENDING:
        return 'warn';
      case OptimizationStatus.FAILED:
        return 'danger';
      case OptimizationStatus.CANCELLED:
        return 'secondary';
      default:
        return 'secondary';
    }
  }
}
