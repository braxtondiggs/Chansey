import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { TradeAnalyticsDto } from '@chansey/api-interfaces';

@Component({
  selector: 'app-trade-analytics-panel',
  standalone: true,
  imports: [CommonModule, CardModule, ChartModule, CurrencyPipe, DecimalPipe, TableModule, TagModule],
  template: `
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Trade Summary -->
      <p-card header="Trade Summary">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div class="text-center">
            <div class="text-2xl font-bold">{{ analytics?.summary?.totalTrades || 0 }}</div>
            <div class="text-sm text-gray-500">Total Trades</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-green-500">{{ analytics?.summary?.buyCount || 0 }}</div>
            <div class="text-sm text-gray-500">Buy Orders</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-red-500">{{ analytics?.summary?.sellCount || 0 }}</div>
            <div class="text-sm text-gray-500">Sell Orders</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-blue-500">
              {{ analytics?.summary?.totalVolume | currency: 'USD' : 'symbol' : '1.0-0' }}
            </div>
            <div class="text-sm text-gray-500">Total Volume</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-orange-500">
              {{ analytics?.summary?.totalFees | currency: 'USD' : 'symbol' : '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Total Fees</div>
          </div>
        </div>
      </p-card>

      <!-- Profitability Stats -->
      <p-card header="Profitability">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div class="text-center">
            <div class="text-2xl font-bold text-green-500">{{ analytics?.profitability?.winCount || 0 }}</div>
            <div class="text-sm text-gray-500">Winning Trades</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-red-500">{{ analytics?.profitability?.lossCount || 0 }}</div>
            <div class="text-sm text-gray-500">Losing Trades</div>
          </div>
          <div class="text-center">
            <div
              class="text-2xl font-bold"
              [class]="(analytics?.profitability?.winRate || 0) >= 0.5 ? 'text-green-500' : 'text-red-500'"
            >
              {{ (analytics?.profitability?.winRate || 0) * 100 | number: '1.0-0' }}%
            </div>
            <div class="text-sm text-gray-500">Win Rate</div>
          </div>
          <div class="text-center">
            <div
              class="text-2xl font-bold"
              [class]="(analytics?.profitability?.profitFactor || 0) >= 1 ? 'text-green-500' : 'text-red-500'"
            >
              {{ analytics?.profitability?.profitFactor | number: '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Profit Factor</div>
          </div>
          <div class="text-center">
            <div
              class="text-2xl font-bold"
              [class]="(analytics?.profitability?.expectancy || 0) >= 0 ? 'text-green-500' : 'text-red-500'"
            >
              {{ analytics?.profitability?.expectancy | currency: 'USD' : 'symbol' : '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Expectancy</div>
          </div>
          <div class="text-center">
            <div
              class="text-2xl font-bold"
              [class]="(analytics?.profitability?.totalRealizedPnL || 0) >= 0 ? 'text-green-500' : 'text-red-500'"
            >
              {{ analytics?.profitability?.totalRealizedPnL | currency: 'USD' : 'symbol' : '1.0-0' }}
            </div>
            <div class="text-sm text-gray-500">Total P&L</div>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-4 border-t pt-4 md:grid-cols-4">
          <div class="text-center">
            <div class="text-lg font-semibold text-green-500">
              {{ analytics?.profitability?.largestWin | currency: 'USD' : 'symbol' : '1.2-2' }}
            </div>
            <div class="text-xs text-gray-500">Largest Win</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-semibold text-red-500">
              {{ analytics?.profitability?.largestLoss | currency: 'USD' : 'symbol' : '1.2-2' }}
            </div>
            <div class="text-xs text-gray-500">Largest Loss</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-semibold text-green-500">
              {{ analytics?.profitability?.avgWin | currency: 'USD' : 'symbol' : '1.2-2' }}
            </div>
            <div class="text-xs text-gray-500">Avg Win</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-semibold text-red-500">
              {{ analytics?.profitability?.avgLoss | currency: 'USD' : 'symbol' : '1.2-2' }}
            </div>
            <div class="text-xs text-gray-500">Avg Loss</div>
          </div>
        </div>
      </p-card>

      <!-- Duration Stats -->
      <p-card header="Trade Duration">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div class="text-center">
            <div class="text-xl font-bold">{{ analytics?.duration?.avgHoldTime || 'N/A' }}</div>
            <div class="text-sm text-gray-500">Avg Hold Time</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold">{{ analytics?.duration?.medianHoldTime || 'N/A' }}</div>
            <div class="text-sm text-gray-500">Median Hold Time</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold">{{ analytics?.duration?.minHoldTime || 'N/A' }}</div>
            <div class="text-sm text-gray-500">Min Hold Time</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold">{{ analytics?.duration?.maxHoldTime || 'N/A' }}</div>
            <div class="text-sm text-gray-500">Max Hold Time</div>
          </div>
        </div>
      </p-card>

      <!-- Slippage Stats -->
      <p-card header="Slippage Analysis">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div class="text-center">
            <div class="text-xl font-bold">{{ analytics?.slippage?.avgBps | number: '1.1-1' }} bps</div>
            <div class="text-sm text-gray-500">Avg Slippage</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold">{{ analytics?.slippage?.p95Bps | number: '1.1-1' }} bps</div>
            <div class="text-sm text-gray-500">95th Percentile</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold">{{ analytics?.slippage?.maxBps | number: '1.1-1' }} bps</div>
            <div class="text-sm text-gray-500">Max Slippage</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold text-orange-500">
              {{ analytics?.slippage?.totalImpact | currency: 'USD' : 'symbol' : '1.2-2' }}
            </div>
            <div class="text-sm text-gray-500">Total Impact</div>
          </div>
        </div>
        <div class="mt-2 text-center text-sm text-gray-400">
          Based on {{ analytics?.slippage?.fillCount || 0 }} simulated fills
        </div>
      </p-card>

      <!-- By Instrument -->
      <p-card header="Performance by Instrument" class="lg:col-span-2">
        <p-table [value]="analytics?.byInstrument || []" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Instrument</th>
              <th class="text-right">Trades</th>
              <th class="text-right">Volume</th>
              <th class="text-right">Win Rate</th>
              <th class="text-right">Total Return</th>
              <th class="text-right">Total P&L</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td class="font-medium">{{ item.instrument }}</td>
              <td class="text-right">{{ item.tradeCount }}</td>
              <td class="text-right">{{ item.totalVolume | currency: 'USD' : 'symbol' : '1.0-0' }}</td>
              <td class="text-right">
                <span [class]="item.winRate >= 0.5 ? 'text-green-500' : 'text-red-500'">
                  {{ item.winRate * 100 | number: '1.0-0' }}%
                </span>
              </td>
              <td class="text-right">
                <span [class]="item.totalReturn >= 0 ? 'text-green-500' : 'text-red-500'">
                  {{ item.totalReturn | number: '1.1-1' }}%
                </span>
              </td>
              <td class="text-right">
                <span [class]="item.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'">
                  {{ item.totalPnL | currency: 'USD' : 'symbol' : '1.2-2' }}
                </span>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="6" class="py-4 text-center text-gray-500">No data available</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `
})
export class TradeAnalyticsPanelComponent {
  @Input() analytics: TradeAnalyticsDto | undefined;
}
