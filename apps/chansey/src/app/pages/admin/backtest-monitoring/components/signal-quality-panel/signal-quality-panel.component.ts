import { CommonModule, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { ChartData, ChartOptions } from 'chart.js';
import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { SignalAnalyticsDto, SignalType } from '@chansey/api-interfaces';

@Component({
  selector: 'app-signal-quality-panel',
  standalone: true,
  imports: [CommonModule, CardModule, ChartModule, DecimalPipe, TableModule, TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Overall Stats -->
      <p-card header="Signal Overview">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div class="text-center">
            <div class="text-2xl font-bold">{{ analytics?.overall?.totalSignals || 0 }}</div>
            <div class="text-sm text-gray-500">Total Signals</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-green-500">{{ analytics?.overall?.entryCount || 0 }}</div>
            <div class="text-sm text-gray-500">Entry Signals</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-red-500">{{ analytics?.overall?.exitCount || 0 }}</div>
            <div class="text-sm text-gray-500">Exit Signals</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-yellow-500">{{ analytics?.overall?.adjustmentCount || 0 }}</div>
            <div class="text-sm text-gray-500">Adjustments</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-orange-500">{{ analytics?.overall?.riskControlCount || 0 }}</div>
            <div class="text-sm text-gray-500">Risk Control</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-purple-500">
              {{ (analytics?.overall?.avgConfidence || 0) * 100 | number: '1.0-0' }}%
            </div>
            <div class="text-sm text-gray-500">Avg Confidence</div>
          </div>
        </div>
      </p-card>

      <!-- Confidence vs Success Rate Chart -->
      <p-card header="Confidence vs Success Rate">
        @if (confidenceChartData) {
          <p-chart type="bar" [data]="confidenceChartData" [options]="chartOptions" />
        } @else {
          <div class="py-8 text-center text-gray-500">No data available</div>
        }
      </p-card>

      <!-- By Signal Type -->
      <p-card header="Performance by Signal Type">
        <p-table [value]="analytics?.bySignalType || []" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Type</th>
              <th class="text-right">Count</th>
              <th class="text-right">Success Rate</th>
              <th class="text-right">Avg Return</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td>
                <p-tag [severity]="getTypeSeverity(item.type)" [value]="formatType(item.type)" />
              </td>
              <td class="text-right">{{ item.count }}</td>
              <td class="text-right">
                <span [class]="item.successRate >= 0.5 ? 'text-green-500' : 'text-red-500'">
                  {{ item.successRate * 100 | number: '1.0-0' }}%
                </span>
              </td>
              <td class="text-right">
                <span [class]="item.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'">
                  {{ item.avgReturn | number: '1.2-2' }}%
                </span>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4" class="py-4 text-center text-gray-500">No data available</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- By Instrument -->
      <p-card header="Top Instruments by Signal Count">
        <p-table [value]="analytics?.byInstrument || []" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Instrument</th>
              <th class="text-right">Signals</th>
              <th class="text-right">Success Rate</th>
              <th class="text-right">Avg Return</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td class="font-medium">{{ item.instrument }}</td>
              <td class="text-right">{{ item.count }}</td>
              <td class="text-right">
                <span [class]="item.successRate >= 0.5 ? 'text-green-500' : 'text-red-500'">
                  {{ item.successRate * 100 | number: '1.0-0' }}%
                </span>
              </td>
              <td class="text-right">
                <span [class]="item.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'">
                  {{ item.avgReturn | number: '1.2-2' }}%
                </span>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4" class="py-4 text-center text-gray-500">No data available</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `
})
export class SignalQualityPanelComponent {
  @Input() set analytics(value: SignalAnalyticsDto | undefined) {
    this._analytics = value;
    this.updateChartData();
  }

  get analytics(): SignalAnalyticsDto | undefined {
    return this._analytics;
  }

  private _analytics: SignalAnalyticsDto | undefined;
  confidenceChartData: ChartData | null = null;

  chartOptions: ChartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        display: true,
        position: 'top'
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100
      }
    }
  };

  private updateChartData(): void {
    if (!this._analytics?.byConfidenceBucket?.length) {
      this.confidenceChartData = null;
      return;
    }

    const buckets = this._analytics.byConfidenceBucket;

    this.confidenceChartData = {
      labels: buckets.map((b) => b.bucket),
      datasets: [
        {
          label: 'Success Rate (%)',
          data: buckets.map((b) => parseFloat((b.successRate * 100).toFixed(1))),
          backgroundColor: 'rgba(34, 197, 94, 0.6)',
          borderColor: 'rgb(34, 197, 94)',
          borderWidth: 1
        },
        {
          label: 'Signal Count',
          data: buckets.map((b) => b.signalCount),
          backgroundColor: 'rgba(99, 102, 241, 0.6)',
          borderColor: 'rgb(99, 102, 241)',
          borderWidth: 1,
          yAxisID: 'y1'
        }
      ]
    };

    this.chartOptions = {
      ...this.chartOptions,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          position: 'left'
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          grid: {
            drawOnChartArea: false
          }
        }
      }
    };
  }

  getTypeSeverity(type: SignalType): 'success' | 'danger' | 'warn' | 'info' {
    switch (type) {
      case SignalType.ENTRY:
        return 'success';
      case SignalType.EXIT:
        return 'danger';
      case SignalType.ADJUSTMENT:
        return 'warn';
      case SignalType.RISK_CONTROL:
        return 'info';
      default:
        return 'info';
    }
  }

  formatType(type: SignalType): string {
    return type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}
