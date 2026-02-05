import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { LiveTradeOverviewDto } from '../../live-trade-monitoring.service';

@Component({
  selector: 'app-overview-cards',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule, TagModule, DecimalPipe, CurrencyPipe],
  template: `
    <div class="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
      <!-- Summary Cards -->
      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold text-blue-500">{{ overview?.summary?.activeAlgorithms || 0 }}</span>
          <span class="mt-1 text-sm text-gray-500">Active Algorithms</span>
        </div>
      </p-card>

      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold text-green-500">{{ overview?.summary?.totalOrders || 0 }}</span>
          <span class="mt-1 text-sm text-gray-500">Total Orders</span>
        </div>
      </p-card>

      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold text-purple-500">{{ overview?.summary?.activeUsers || 0 }}</span>
          <span class="mt-1 text-sm text-gray-500">Active Users</span>
        </div>
      </p-card>

      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold text-yellow-500">
            {{ overview?.summary?.totalVolume || 0 | currency: 'USD' : 'symbol' : '1.0-0' }}
          </span>
          <span class="mt-1 text-sm text-gray-500">Total Volume</span>
        </div>
      </p-card>

      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold" [class]="getPnLClass()">
            {{ overview?.summary?.totalPnL || 0 | currency: 'USD' : 'symbol' : '1.0-0' }}
          </span>
          <span class="mt-1 text-sm text-gray-500">Total P&L</span>
        </div>
      </p-card>

      <p-card styleClass="text-center">
        <div class="flex flex-col items-center">
          <span class="text-3xl font-bold text-indigo-500">
            {{ overview?.summary?.avgSlippageBps | number: '1.1-1' }} bps
          </span>
          <span class="mt-1 text-sm text-gray-500">Avg Slippage</span>
        </div>
      </p-card>
    </div>

    <!-- Recent Activity & Alerts Summary -->
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <p-card styleClass="!rounded-b-none bg-surface-50 dark:bg-surface-800">
        <div class="mb-4 flex items-center gap-2">
          <i class="pi pi-history text-primary text-xl"></i>
          <span class="font-semibold">Recent Activity</span>
        </div>
        <div class="flex items-center justify-around">
          <div class="flex flex-col items-center">
            <span class="text-primary text-2xl font-bold">{{ overview?.summary?.orders24h || 0 }}</span>
            <span class="text-surface-500 text-xs">Last 24h</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-2xl font-bold text-blue-400">{{ overview?.summary?.orders7d || 0 }}</span>
            <span class="text-surface-500 text-xs">Last 7 days</span>
          </div>
        </div>
      </p-card>

      <p-card styleClass="!rounded-b-none bg-surface-50 dark:bg-surface-800">
        <div class="mb-4 flex items-center gap-2">
          <i class="pi pi-exclamation-triangle text-xl text-yellow-500"></i>
          <span class="font-semibold">Alerts Summary</span>
        </div>
        <div class="flex items-center justify-around">
          <div class="flex flex-col items-center">
            <span class="text-2xl font-bold text-red-500">{{ overview?.alertsSummary?.critical || 0 }}</span>
            <span class="text-surface-500 text-xs">Critical</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-2xl font-bold text-yellow-500">{{ overview?.alertsSummary?.warning || 0 }}</span>
            <span class="text-surface-500 text-xs">Warning</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-2xl font-bold text-blue-500">{{ overview?.alertsSummary?.info || 0 }}</span>
            <span class="text-surface-500 text-xs">Info</span>
          </div>
        </div>
      </p-card>
    </div>

    <!-- Top Algorithms & Recent Orders -->
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Top Algorithms -->
      <p-card>
        <ng-template #header>
          <div class="flex items-center gap-2 p-3">
            <i class="pi pi-star text-xl text-yellow-500"></i>
            <span class="font-semibold">Top Performing Algorithms</span>
          </div>
        </ng-template>
        <p-table [value]="overview?.topAlgorithms || []" [tableStyle]="{ 'min-width': '100%' }">
          <ng-template #header>
            <tr>
              <th>Algorithm</th>
              <th class="text-right">Activations</th>
              <th class="text-right">ROI</th>
              <th class="text-right">Win Rate</th>
            </tr>
          </ng-template>
          <ng-template #body let-algo>
            <tr>
              <td>{{ algo.algorithmName }}</td>
              <td class="text-right">{{ algo.activeActivations }}</td>
              <td class="text-right" [class]="algo.avgRoi >= 0 ? 'text-green-500' : 'text-red-500'">
                {{ algo.avgRoi | number: '1.2-2' }}%
              </td>
              <td class="text-right">{{ algo.avgWinRate * 100 | number: '1.1-1' }}%</td>
            </tr>
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="4" class="text-center text-gray-500">No algorithms data available</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- Recent Orders -->
      <p-card>
        <ng-template #header>
          <div class="flex items-center gap-2 p-3">
            <i class="pi pi-list text-primary text-xl"></i>
            <span class="font-semibold">Recent Orders</span>
          </div>
        </ng-template>
        <p-table [value]="overview?.recentOrders || []" [tableStyle]="{ 'min-width': '100%' }">
          <ng-template #header>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th class="text-right">Cost</th>
              <th class="text-right">Slippage</th>
            </tr>
          </ng-template>
          <ng-template #body let-order>
            <tr>
              <td>{{ order.symbol }}</td>
              <td>
                <p-tag [severity]="order.side === 'BUY' ? 'success' : 'danger'" [value]="order.side" />
              </td>
              <td class="text-right">{{ order.cost | currency: 'USD' : 'symbol' : '1.2-2' }}</td>
              <td class="text-right">{{ order.actualSlippageBps | number: '1.1-1' }} bps</td>
            </tr>
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="4" class="text-center text-gray-500">No recent orders</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `
})
export class OverviewCardsComponent {
  @Input() overview: LiveTradeOverviewDto | undefined;

  getPnLClass(): string {
    const pnl = this.overview?.summary?.totalPnL || 0;
    return pnl >= 0 ? 'text-green-500' : 'text-red-500';
  }
}
