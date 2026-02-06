import { CommonModule, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';

import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';

import { SlippageAnalysisDto } from '../../live-trade-monitoring.service';

@Component({
  selector: 'app-slippage-comparison-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, CardModule, ChartModule, TableModule, DecimalPipe],
  template: `
    <div class="mt-4">
      <!-- Overall Stats -->
      <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <p-card styleClass="text-center">
          <div class="flex flex-col items-center">
            <span class="text-3xl font-bold text-blue-500">
              {{ slippageAnalysis?.overallLive?.avgBps | number: '1.1-1' }} bps
            </span>
            <span class="mt-1 text-sm text-gray-500">Live Avg Slippage</span>
          </div>
        </p-card>

        <p-card styleClass="text-center">
          <div class="flex flex-col items-center">
            <span class="text-3xl font-bold text-green-500">
              {{ slippageAnalysis?.overallBacktest?.avgBps | number: '1.1-1' }} bps
            </span>
            <span class="mt-1 text-sm text-gray-500">Backtest Avg Slippage</span>
          </div>
        </p-card>

        <p-card styleClass="text-center">
          <div class="flex flex-col items-center">
            <span class="text-3xl font-bold" [class]="getDifferenceClass()">
              {{ (slippageAnalysis?.overallDifferenceBps ?? 0) >= 0 ? '+' : ''
              }}{{ slippageAnalysis?.overallDifferenceBps | number: '1.1-1' }} bps
            </span>
            <span class="mt-1 text-sm text-gray-500">Difference</span>
          </div>
        </p-card>
      </div>

      <!-- Charts Row -->
      <div class="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <!-- Slippage by Time of Day -->
        <p-card>
          <ng-template #header>
            <div class="flex items-center gap-2 p-3">
              <i class="pi pi-clock text-primary text-xl"></i>
              <span class="font-semibold">Slippage by Time of Day</span>
            </div>
          </ng-template>
          @if (timeOfDayChartData) {
            <p-chart type="bar" [data]="timeOfDayChartData" [options]="chartOptions" height="250px" />
          } @else {
            <div class="flex h-64 items-center justify-center text-gray-500">No data available</div>
          }
        </p-card>

        <!-- Slippage by Order Size -->
        <p-card>
          <ng-template #header>
            <div class="flex items-center gap-2 p-3">
              <i class="pi pi-dollar text-primary text-xl"></i>
              <span class="font-semibold">Slippage by Order Size</span>
            </div>
          </ng-template>
          @if (orderSizeChartData) {
            <p-chart type="bar" [data]="orderSizeChartData" [options]="chartOptions" height="250px" />
          } @else {
            <div class="flex h-64 items-center justify-center text-gray-500">No data available</div>
          }
        </p-card>
      </div>

      <!-- Tables Row -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <!-- By Algorithm -->
        <p-card>
          <ng-template #header>
            <div class="flex items-center gap-2 p-3">
              <i class="pi pi-cog text-primary text-xl"></i>
              <span class="font-semibold">Slippage by Algorithm</span>
            </div>
          </ng-template>
          <p-table
            [value]="slippageAnalysis?.byAlgorithm || []"
            [tableStyle]="{ 'min-width': '100%' }"
            [scrollable]="true"
            scrollHeight="300px"
          >
            <ng-template #header>
              <tr>
                <th>Algorithm</th>
                <th class="text-right">Live</th>
                <th class="text-right">Backtest</th>
                <th class="text-right">Diff</th>
              </tr>
            </ng-template>
            <ng-template #body let-row>
              <tr>
                <td>{{ row.algorithmName }}</td>
                <td class="text-right">{{ row.liveSlippage?.avgBps | number: '1.1-1' }} bps</td>
                <td class="text-right">
                  @if (row.backtestSlippage) {
                    {{ row.backtestSlippage.avgBps | number: '1.1-1' }} bps
                  } @else {
                    <span class="text-gray-400">N/A</span>
                  }
                </td>
                <td class="text-right" [class]="row.slippageDifferenceBps > 0 ? 'text-red-500' : 'text-green-500'">
                  {{ row.slippageDifferenceBps >= 0 ? '+' : '' }}{{ row.slippageDifferenceBps | number: '1.1-1' }} bps
                </td>
              </tr>
            </ng-template>
            <ng-template #emptymessage>
              <tr>
                <td colspan="4" class="text-center text-gray-500">No algorithm data available</td>
              </tr>
            </ng-template>
          </p-table>
        </p-card>

        <!-- By Symbol -->
        <p-card>
          <ng-template #header>
            <div class="flex items-center gap-2 p-3">
              <i class="pi pi-bitcoin text-primary text-xl"></i>
              <span class="font-semibold">Slippage by Symbol</span>
            </div>
          </ng-template>
          <p-table
            [value]="slippageAnalysis?.bySymbol || []"
            [tableStyle]="{ 'min-width': '100%' }"
            [scrollable]="true"
            scrollHeight="300px"
          >
            <ng-template #header>
              <tr>
                <th>Symbol</th>
                <th class="text-right">Avg Slippage</th>
                <th class="text-right">Orders</th>
                <th class="text-right">Volume</th>
              </tr>
            </ng-template>
            <ng-template #body let-row>
              <tr>
                <td class="font-medium">{{ row.symbol }}</td>
                <td class="text-right">{{ row.avgBps | number: '1.1-1' }} bps</td>
                <td class="text-right">{{ row.orderCount }}</td>
                <td class="text-right">{{ row.totalVolume | number: '1.0-0' }}</td>
              </tr>
            </ng-template>
            <ng-template #emptymessage>
              <tr>
                <td colspan="4" class="text-center text-gray-500">No symbol data available</td>
              </tr>
            </ng-template>
          </p-table>
        </p-card>
      </div>
    </div>
  `
})
export class SlippageComparisonPanelComponent implements OnChanges {
  @Input() slippageAnalysis: SlippageAnalysisDto | undefined;

  timeOfDayChartData: unknown;
  orderSizeChartData: unknown;

  chartOptions = {
    plugins: {
      legend: { display: false }
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Slippage (bps)'
        }
      }
    }
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['slippageAnalysis']) {
      this.updateCharts();
    }
  }

  private updateCharts(): void {
    if (!this.slippageAnalysis) {
      this.timeOfDayChartData = null;
      this.orderSizeChartData = null;
      return;
    }

    // Time of day chart
    const timeData = this.slippageAnalysis.byTimeOfDay || [];
    if (timeData.length > 0) {
      this.timeOfDayChartData = {
        labels: timeData.map((t) => `${t.hour}:00`),
        datasets: [
          {
            label: 'Avg Slippage (bps)',
            data: timeData.map((t) => t.avgBps),
            backgroundColor: 'rgba(59, 130, 246, 0.6)',
            borderColor: 'rgba(59, 130, 246, 1)',
            borderWidth: 1
          }
        ]
      };
    } else {
      this.timeOfDayChartData = null;
    }

    // Order size chart
    const sizeData = this.slippageAnalysis.byOrderSize || [];
    if (sizeData.length > 0) {
      this.orderSizeChartData = {
        labels: sizeData.map((s) => s.bucket),
        datasets: [
          {
            label: 'Avg Slippage (bps)',
            data: sizeData.map((s) => s.avgBps),
            backgroundColor: 'rgba(34, 197, 94, 0.6)',
            borderColor: 'rgba(34, 197, 94, 1)',
            borderWidth: 1
          }
        ]
      };
    } else {
      this.orderSizeChartData = null;
    }
  }

  getDifferenceClass(): string {
    const diff = this.slippageAnalysis?.overallDifferenceBps || 0;
    return diff > 0 ? 'text-red-500' : 'text-green-500';
  }
}
