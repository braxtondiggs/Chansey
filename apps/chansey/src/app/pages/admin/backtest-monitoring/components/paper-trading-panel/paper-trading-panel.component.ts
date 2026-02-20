import { CommonModule, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';

import { PaperTradingMonitoringDto, PaperTradingStatus } from '@chansey/api-interfaces';

@Component({
  selector: 'app-paper-trading-panel',
  standalone: true,
  imports: [CommonModule, CardModule, DecimalPipe, TableModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Status Counts -->
      <p-card header="Session Status">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div class="text-center">
            <div class="text-2xl font-bold text-green-500">{{ getStatusCount(PaperTradingStatus.ACTIVE) }}</div>
            <div class="text-sm text-gray-500">Active</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-yellow-500">{{ getStatusCount(PaperTradingStatus.PAUSED) }}</div>
            <div class="text-sm text-gray-500">Paused</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-500">{{ getStatusCount(PaperTradingStatus.COMPLETED) }}</div>
            <div class="text-sm text-gray-500">Completed</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-red-500">{{ getStatusCount(PaperTradingStatus.FAILED) }}</div>
            <div class="text-sm text-gray-500">Failed</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-gray-500">{{ getStatusCount(PaperTradingStatus.STOPPED) }}</div>
            <div class="text-sm text-gray-500">Stopped</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold">{{ analytics?.totalSessions || 0 }}</div>
            <div class="text-sm text-gray-500">Total Sessions</div>
          </div>
        </div>
      </p-card>

      <!-- Average Metrics -->
      <p-card header="Average Performance">
        <div class="grid grid-cols-2 gap-4">
          <div class="text-center">
            <div class="text-2xl font-bold" [class]="getReturnClass()">
              {{ analytics?.avgMetrics?.totalReturn | number: '1.1-1' }}%
            </div>
            <div class="text-sm text-gray-500">Avg Return</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-red-400">
              {{ analytics?.avgMetrics?.maxDrawdown | number: '1.1-1' }}%
            </div>
            <div class="text-sm text-gray-500">Avg Drawdown</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-purple-500">
              {{ analytics?.avgMetrics?.sharpeRatio | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Avg Sharpe</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-500">
              {{ (analytics?.avgMetrics?.winRate || 0) * 100 | number: '1.0-0' }}%
            </div>
            <div class="text-sm text-gray-500">Avg Win Rate</div>
          </div>
        </div>
      </p-card>

      <!-- Order Analytics -->
      <p-card header="Order Analytics">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div class="text-center">
            <div class="text-2xl font-bold">{{ analytics?.orderAnalytics?.totalOrders || 0 }}</div>
            <div class="text-sm text-gray-500">Total Orders</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-green-500">{{ analytics?.orderAnalytics?.buyCount || 0 }}</div>
            <div class="text-sm text-gray-500">Buys</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-red-500">{{ analytics?.orderAnalytics?.sellCount || 0 }}</div>
            <div class="text-sm text-gray-500">Sells</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold" [class]="getPnLClass()">
              {{ analytics?.orderAnalytics?.totalPnL | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Total P&L</div>
          </div>
        </div>
        <div class="mt-4 grid grid-cols-3 gap-4">
          <div class="text-center">
            <div class="text-lg font-semibold">{{ analytics?.orderAnalytics?.totalVolume | number: '1.0-0' }}</div>
            <div class="text-xs text-gray-500">Total Volume</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-semibold">{{ analytics?.orderAnalytics?.totalFees | number: '1.2-2' }}</div>
            <div class="text-xs text-gray-500">Total Fees</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-semibold">
              {{ analytics?.orderAnalytics?.avgSlippageBps | number: '1.1-1' }} bps
            </div>
            <div class="text-xs text-gray-500">Avg Slippage</div>
          </div>
        </div>
      </p-card>

      <!-- Signal Analytics -->
      <p-card header="Signal Analytics">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div class="text-center">
            <div class="text-2xl font-bold">{{ analytics?.signalAnalytics?.totalSignals || 0 }}</div>
            <div class="text-sm text-gray-500">Total Signals</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-green-500">
              {{ (analytics?.signalAnalytics?.processedRate || 0) * 100 | number: '1.0-0' }}%
            </div>
            <div class="text-sm text-gray-500">Processed Rate</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-purple-500">
              {{ (analytics?.signalAnalytics?.avgConfidence || 0) * 100 | number: '1.0-0' }}%
            </div>
            <div class="text-sm text-gray-500">Avg Confidence</div>
          </div>
        </div>
      </p-card>

      <!-- Top Algorithms -->
      <p-card header="Top Algorithms">
        <p-table [value]="analytics?.topAlgorithms || []" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Algorithm</th>
              <th class="text-right">Sessions</th>
              <th class="text-right">Avg Return</th>
              <th class="text-right">Avg Sharpe</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td class="font-medium">{{ item.algorithmName }}</td>
              <td class="text-right">{{ item.sessionCount }}</td>
              <td class="text-right">
                <span [class]="item.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'">
                  {{ item.avgReturn | number: '1.1-1' }}%
                </span>
              </td>
              <td class="text-right">{{ item.avgSharpe | number: '1.2-2' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4" class="py-4 text-center text-gray-500">No paper trading data available</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- By Symbol Breakdown -->
      <p-card header="Volume by Symbol">
        <p-table [value]="analytics?.orderAnalytics?.bySymbol || []" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Symbol</th>
              <th class="text-right">Orders</th>
              <th class="text-right">Volume</th>
              <th class="text-right">P&L</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td class="font-medium">{{ item.symbol }}</td>
              <td class="text-right">{{ item.orderCount }}</td>
              <td class="text-right">{{ item.totalVolume | number: '1.0-0' }}</td>
              <td class="text-right">
                <span [class]="item.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'">
                  {{ item.totalPnL | number: '1.2-2' }}
                </span>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4" class="py-4 text-center text-gray-500">No order data available</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `
})
export class PaperTradingPanelComponent {
  @Input() analytics: PaperTradingMonitoringDto | undefined;

  protected readonly PaperTradingStatus = PaperTradingStatus;

  getStatusCount(status: PaperTradingStatus): number {
    if (!this.analytics?.statusCounts) return 0;
    return this.analytics.statusCounts[status] || 0;
  }

  getReturnClass(): string {
    return (this.analytics?.avgMetrics?.totalReturn || 0) >= 0 ? 'text-green-500' : 'text-red-500';
  }

  getPnLClass(): string {
    return (this.analytics?.orderAnalytics?.totalPnL || 0) >= 0 ? 'text-green-500' : 'text-red-500';
  }
}
