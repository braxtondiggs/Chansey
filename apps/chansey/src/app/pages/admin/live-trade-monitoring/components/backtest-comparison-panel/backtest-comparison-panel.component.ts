import { CommonModule, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { ComparisonDto } from '../../live-trade-monitoring.service';

interface MetricRow {
  name: string;
  live: number | string | undefined;
  backtest: number | string | undefined;
  deviation: number | undefined;
  format: 'percent' | 'number' | 'bps';
  invertDeviation?: boolean;
}

@Component({
  selector: 'app-backtest-comparison-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, CardModule, TableModule, TagModule, DecimalPipe],
  template: `
    <div class="mt-4">
      <!-- Summary Header -->
      <p-card styleClass="mb-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 class="m-0 text-lg font-semibold">{{ comparison?.comparison?.algorithmName }}</h3>
            <p class="mt-1 text-sm text-gray-500">
              {{ comparison?.comparison?.activeActivations }} active activations |
              {{ comparison?.comparison?.totalLiveOrders }} live orders
            </p>
          </div>
          <div class="flex items-center gap-4">
            @if (comparison?.comparison?.backtestName) {
              <div class="text-sm">
                <span class="text-gray-500">Comparing against:</span>
                <span class="ml-1 font-medium">{{ comparison?.comparison?.backtestName }}</span>
              </div>
            }
            @if (comparison?.comparison?.hasSignificantDeviation) {
              <p-tag severity="danger" value="Significant Deviation" />
            } @else {
              <p-tag severity="success" value="Within Tolerance" />
            }
          </div>
        </div>
      </p-card>

      <!-- Comparison Table -->
      <p-card>
        <ng-template #header>
          <div class="flex items-center gap-2 p-3">
            <i class="pi pi-chart-bar text-primary text-xl"></i>
            <span class="font-semibold">Performance Comparison</span>
          </div>
        </ng-template>

        <p-table [value]="metricsRows" [tableStyle]="{ 'min-width': '100%' }">
          <ng-template #header>
            <tr>
              <th>Metric</th>
              <th class="text-right">Live</th>
              <th class="text-right">Backtest</th>
              <th class="text-right">Deviation</th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr>
              <td class="font-medium">{{ row.name }}</td>
              <td class="text-right">{{ formatValue(row.live, row.format) }}</td>
              <td class="text-right">{{ formatValue(row.backtest, row.format) }}</td>
              <td class="text-right">
                @if (row.deviation !== undefined) {
                  <span [class]="getDeviationClass(row.deviation, row.invertDeviation)">
                    {{ row.deviation >= 0 ? '+' : '' }}{{ row.deviation | number: '1.1-1' }}%
                  </span>
                } @else {
                  <span class="text-gray-400">N/A</span>
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- Alerts -->
      @if (comparison?.comparison?.alerts?.length) {
        <p-card class="mt-4">
          <ng-template #header>
            <div class="flex items-center gap-2 p-3">
              <i class="pi pi-exclamation-triangle text-xl text-yellow-500"></i>
              <span class="font-semibold">Performance Alerts</span>
            </div>
          </ng-template>
          <ul class="m-0 list-none p-0">
            @for (alert of comparison?.comparison?.alerts; track alert) {
              <li class="flex items-center gap-2 border-b border-gray-200 py-2 last:border-0 dark:border-gray-700">
                <i class="pi pi-exclamation-circle text-yellow-500"></i>
                <span>{{ alert }}</span>
              </li>
            }
          </ul>
        </p-card>
      }
    </div>
  `
})
export class BacktestComparisonPanelComponent {
  @Input() comparison: ComparisonDto | undefined;

  get metricsRows(): MetricRow[] {
    const live = this.comparison?.comparison?.liveMetrics;
    const backtest = this.comparison?.comparison?.backtestMetrics;
    const deviations = this.comparison?.comparison?.deviations;

    return [
      {
        name: 'Total Return',
        live: live?.totalReturn,
        backtest: backtest?.totalReturn,
        deviation: deviations?.totalReturn,
        format: 'percent'
      },
      {
        name: 'Sharpe Ratio',
        live: live?.sharpeRatio,
        backtest: backtest?.sharpeRatio,
        deviation: deviations?.sharpeRatio,
        format: 'number'
      },
      {
        name: 'Win Rate',
        live: live?.winRate !== undefined ? live.winRate * 100 : undefined,
        backtest: backtest?.winRate !== undefined ? backtest.winRate * 100 : undefined,
        deviation: deviations?.winRate,
        format: 'percent'
      },
      {
        name: 'Max Drawdown',
        live: live?.maxDrawdown,
        backtest: backtest?.maxDrawdown,
        deviation: deviations?.maxDrawdown,
        format: 'percent',
        invertDeviation: true
      },
      {
        name: 'Total Trades',
        live: live?.totalTrades,
        backtest: backtest?.totalTrades,
        deviation: undefined,
        format: 'number'
      },
      {
        name: 'Avg Slippage',
        live: live?.avgSlippageBps,
        backtest: backtest?.avgSlippageBps,
        deviation: deviations?.avgSlippageBps,
        format: 'bps',
        invertDeviation: true
      }
    ];
  }

  formatValue(value: number | string | undefined, format: 'percent' | 'number' | 'bps'): string {
    if (value === undefined || value === null) return 'N/A';

    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(numValue)) return 'N/A';

    switch (format) {
      case 'percent':
        return `${numValue.toFixed(2)}%`;
      case 'bps':
        return `${numValue.toFixed(1)} bps`;
      default:
        return numValue.toFixed(2);
    }
  }

  getDeviationClass(deviation: number, invertDeviation?: boolean): string {
    const isGood = invertDeviation ? deviation <= 0 : deviation >= 0;
    return isGood ? 'text-green-500 font-medium' : 'text-red-500 font-medium';
  }
}
