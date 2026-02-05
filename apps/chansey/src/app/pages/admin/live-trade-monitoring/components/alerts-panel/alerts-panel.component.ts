import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { AlertsDto, AlertSeverity } from '../../live-trade-monitoring.service';

@Component({
  selector: 'app-alerts-panel',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule, TagModule, DecimalPipe, DatePipe],
  template: `
    <div class="mt-4">
      <!-- Summary Cards -->
      <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-4">
        <p-card styleClass="text-center">
          <div class="flex flex-col items-center">
            <span class="text-3xl font-bold">{{ alerts?.total || 0 }}</span>
            <span class="mt-1 text-sm text-gray-500">Total Alerts</span>
          </div>
        </p-card>

        <p-card styleClass="text-center">
          <div class="flex flex-col items-center">
            <span class="text-3xl font-bold text-red-500">{{ alerts?.criticalCount || 0 }}</span>
            <span class="mt-1 text-sm text-gray-500">Critical</span>
          </div>
        </p-card>

        <p-card styleClass="text-center">
          <div class="flex flex-col items-center">
            <span class="text-3xl font-bold text-yellow-500">{{ alerts?.warningCount || 0 }}</span>
            <span class="mt-1 text-sm text-gray-500">Warning</span>
          </div>
        </p-card>

        <p-card styleClass="text-center">
          <div class="flex flex-col items-center">
            <span class="text-3xl font-bold text-blue-500">{{ alerts?.infoCount || 0 }}</span>
            <span class="mt-1 text-sm text-gray-500">Info</span>
          </div>
        </p-card>
      </div>

      <!-- Alerts Table -->
      <p-card>
        <ng-template #header>
          <div class="flex items-center gap-2 p-3">
            <i class="pi pi-exclamation-triangle text-xl text-yellow-500"></i>
            <span class="font-semibold">Performance Alerts</span>
          </div>
        </ng-template>

        <p-table
          [value]="alerts?.alerts || []"
          [tableStyle]="{ 'min-width': '100%' }"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Showing {first} to {last} of {totalRecords} alerts"
        >
          <ng-template #header>
            <tr>
              <th style="width: 100px">Severity</th>
              <th>Title</th>
              <th>Algorithm</th>
              <th>User</th>
              <th class="text-right">Live</th>
              <th class="text-right">Backtest</th>
              <th class="text-right">Deviation</th>
              <th>Time</th>
            </tr>
          </ng-template>
          <ng-template #body let-alert>
            <tr>
              <td>
                <p-tag [severity]="getSeverityColor(alert.severity)" [value]="alert.severity" />
              </td>
              <td>
                <div class="flex flex-col">
                  <span class="font-medium">{{ alert.title }}</span>
                  <span class="text-xs text-gray-500">{{ alert.message }}</span>
                </div>
              </td>
              <td>{{ alert.algorithmName }}</td>
              <td>{{ alert.userEmail || 'N/A' }}</td>
              <td class="text-right">{{ alert.liveValue | number: '1.2-2' }}</td>
              <td class="text-right">
                @if (alert.backtestValue !== undefined) {
                  {{ alert.backtestValue | number: '1.2-2' }}
                } @else {
                  <span class="text-gray-400">N/A</span>
                }
              </td>
              <td class="text-right" [class]="getDeviationClass(alert.deviationPercent)">
                {{ alert.deviationPercent >= 0 ? '+' : '' }}{{ alert.deviationPercent | number: '1.1-1' }}%
              </td>
              <td>{{ alert.createdAt | date: 'short' }}</td>
            </tr>
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="8" class="py-8 text-center">
                <div class="flex flex-col items-center text-gray-500">
                  <i class="pi pi-check-circle mb-2 text-4xl text-green-500"></i>
                  <span>No performance alerts - all algorithms are within tolerance!</span>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- Thresholds Reference -->
      <p-card class="mt-4">
        <ng-template #header>
          <div class="flex items-center gap-2 p-3">
            <i class="pi pi-info-circle text-primary text-xl"></i>
            <span class="font-semibold">Alert Thresholds Reference</span>
          </div>
        </ng-template>
        <div class="grid grid-cols-2 gap-4 md:grid-cols-5">
          <div class="flex flex-col">
            <span class="text-sm font-medium">Sharpe Ratio</span>
            <span class="text-xs text-yellow-500">Warning: -{{ alerts?.thresholds?.sharpeRatioWarning }}%</span>
            <span class="text-xs text-red-500">Critical: -{{ alerts?.thresholds?.sharpeRatioCritical }}%</span>
          </div>
          <div class="flex flex-col">
            <span class="text-sm font-medium">Win Rate</span>
            <span class="text-xs text-yellow-500">Warning: -{{ alerts?.thresholds?.winRateWarning }}%</span>
            <span class="text-xs text-red-500">Critical: -{{ alerts?.thresholds?.winRateCritical }}%</span>
          </div>
          <div class="flex flex-col">
            <span class="text-sm font-medium">Max Drawdown</span>
            <span class="text-xs text-yellow-500">Warning: +{{ alerts?.thresholds?.maxDrawdownWarning }}%</span>
            <span class="text-xs text-red-500">Critical: +{{ alerts?.thresholds?.maxDrawdownCritical }}%</span>
          </div>
          <div class="flex flex-col">
            <span class="text-sm font-medium">Total Return</span>
            <span class="text-xs text-yellow-500">Warning: -{{ alerts?.thresholds?.totalReturnWarning }}%</span>
            <span class="text-xs text-red-500">Critical: -{{ alerts?.thresholds?.totalReturnCritical }}%</span>
          </div>
          <div class="flex flex-col">
            <span class="text-sm font-medium">Slippage</span>
            <span class="text-xs text-yellow-500">Warning: +{{ alerts?.thresholds?.slippageWarningBps }} bps</span>
            <span class="text-xs text-red-500">Critical: +{{ alerts?.thresholds?.slippageCriticalBps }} bps</span>
          </div>
        </div>
      </p-card>
    </div>
  `
})
export class AlertsPanelComponent {
  @Input() alerts: AlertsDto | undefined;

  getSeverityColor(severity: AlertSeverity): 'danger' | 'warn' | 'info' {
    switch (severity) {
      case 'critical':
        return 'danger';
      case 'warning':
        return 'warn';
      default:
        return 'info';
    }
  }

  getDeviationClass(deviation: number): string {
    if (Math.abs(deviation) >= 50) return 'text-red-500 font-bold';
    if (Math.abs(deviation) >= 25) return 'text-yellow-500 font-medium';
    return '';
  }
}
