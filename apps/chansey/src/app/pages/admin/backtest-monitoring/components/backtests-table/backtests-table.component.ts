import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ProgressBarModule } from 'primeng/progressbar';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { BacktestStatus, PaginatedBacktestListDto } from '@chansey/api-interfaces';

@Component({
  selector: 'app-backtests-table',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    CardModule,
    DatePipe,
    DecimalPipe,
    ProgressBarModule,
    TableModule,
    TagModule,
    TooltipModule
  ],
  template: `
    <p-card header="Recent Backtests">
      <p-table
        [value]="backtests?.data || []"
        [rows]="10"
        [totalRecords]="backtests?.total || 0"
        [lazy]="true"
        (onLazyLoad)="onLazyLoad($event)"
        [paginator]="true"
        [showCurrentPageReport]="true"
        currentPageReportTemplate="{first} to {last} of {totalRecords}"
        styleClass="p-datatable-sm"
      >
        <ng-template pTemplate="header">
          <tr>
            <th>Name</th>
            <th>Algorithm</th>
            <th>Status</th>
            <th class="text-right">Return</th>
            <th class="text-right">Sharpe</th>
            <th>Created</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-backtest>
          <tr>
            <td>
              <span [pTooltip]="backtest.description" tooltipPosition="top">
                {{ backtest.name | slice: 0 : 25 }}{{ backtest.name.length > 25 ? '...' : '' }}
              </span>
            </td>
            <td>{{ backtest.algorithmName }}</td>
            <td>
              <p-tag [severity]="getStatusSeverity(backtest.status)" [value]="backtest.status" />
              @if (backtest.status === BacktestStatus.RUNNING) {
                <p-progressBar [value]="backtest.progressPercent" [showValue]="false" styleClass="h-1 mt-1" />
              }
            </td>
            <td class="text-right">
              @if (backtest.totalReturn !== null && backtest.totalReturn !== undefined) {
                <span [class]="backtest.totalReturn >= 0 ? 'text-green-500' : 'text-red-500'">
                  {{ backtest.totalReturn | number: '1.1-1' }}%
                </span>
              } @else {
                <span class="text-gray-400">-</span>
              }
            </td>
            <td class="text-right">
              @if (backtest.sharpeRatio !== null && backtest.sharpeRatio !== undefined) {
                {{ backtest.sharpeRatio | number: '1.2-2' }}
              } @else {
                <span class="text-gray-400">-</span>
              }
            </td>
            <td>{{ backtest.createdAt | date: 'short' }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="py-4 text-center text-gray-500">No backtests found</td>
          </tr>
        </ng-template>
      </p-table>
    </p-card>
  `
})
export class BacktestsTableComponent {
  @Input() backtests: PaginatedBacktestListDto | undefined;
  @Output() pageChange = new EventEmitter<number>();

  // Expose enum to template
  protected readonly BacktestStatus = BacktestStatus;

  onLazyLoad(event: any): void {
    const page = Math.floor(event.first / event.rows) + 1;
    this.pageChange.emit(page);
  }

  getStatusSeverity(status: BacktestStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) {
      case BacktestStatus.COMPLETED:
        return 'success';
      case BacktestStatus.RUNNING:
        return 'info';
      case BacktestStatus.PENDING:
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
