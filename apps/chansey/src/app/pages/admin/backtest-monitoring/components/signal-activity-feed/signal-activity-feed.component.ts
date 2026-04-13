import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { SignalActivityFeedDto, SignalReasonCode } from '@chansey/api-interfaces';

import { TimeAgoPipe } from '../../../../../shared/pipes';

@Component({
  selector: 'app-signal-activity-feed',
  standalone: true,
  imports: [CardModule, TableModule, TagModule, TimeAgoPipe, TooltipModule, DatePipe, DecimalPipe, PercentPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Health Cards -->
    <div class="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
      <p-card>
        <div class="text-center">
          <div class="text-sm text-gray-500">Last Signal</div>
          @if (feed()?.health?.lastSignalTime) {
            <div class="text-xl font-bold" [class]="lastSignalColorClass">
              {{ feed()?.health?.lastSignalTime | timeAgo }}
            </div>
            <div class="mt-1 text-xs text-gray-400">{{ feed()?.health?.lastSignalTime | date: 'short' }}</div>
          } @else {
            <div class="text-xl font-bold text-gray-400">No signals</div>
          }
        </div>
      </p-card>

      <p-card>
        <div class="text-center">
          <div class="text-sm text-gray-500">Signals / Hour</div>
          <div class="text-2xl font-bold">{{ feed()?.health?.signalsLastHour ?? 0 }}</div>
        </div>
      </p-card>

      <p-card>
        <div class="text-center">
          <div class="text-sm text-gray-500">Signals / 24h</div>
          <div class="text-2xl font-bold">{{ feed()?.health?.signalsLast24h ?? 0 }}</div>
        </div>
      </p-card>

      <p-card>
        <div class="text-center">
          <div class="text-sm text-gray-500">Active Sources</div>
          <div class="text-2xl font-bold">{{ feed()?.health?.totalActiveSources ?? 0 }}</div>
          <div class="mt-1 text-xs text-gray-400">
            {{ feed()?.health?.activeBacktestSources ?? 0 }} backtest ·
            {{ feed()?.health?.activePaperTradingSources ?? 0 }} paper
          </div>
        </div>
      </p-card>
    </div>

    <!-- Signal Feed Table -->
    <p-card header="Recent Signals">
      <p-table
        [value]="feed()?.signals ?? []"
        [rows]="20"
        [paginator]="(feed()?.signals?.length ?? 0) > 20"
        [rowsPerPageOptions]="[20, 50, 100]"
        [scrollable]="true"
        scrollHeight="500px"
        styleClass="p-datatable-sm p-datatable-striped"
      >
        <ng-template #header>
          <tr>
            <th style="width: 140px">Time</th>
            <th style="width: 90px">Type</th>
            <th style="width: 80px">Direction</th>
            <th>Instrument</th>
            <th style="width: 100px" class="text-right">Price</th>
            <th style="width: 80px" class="text-right">Confidence</th>
            <th style="width: 100px">Source</th>
            <th>Algorithm</th>
            <th>User</th>
            <th style="width: 90px">Status</th>
            <th style="width: 140px">Reason Code</th>
            <th>Reason</th>
          </tr>
        </ng-template>
        <ng-template #body let-signal>
          <tr>
            <td>{{ signal.timestamp | date: 'short' }}</td>
            <td>
              <p-tag [value]="signal.signalType" [severity]="getSignalTypeSeverity(signal.signalType)" />
            </td>
            <td>
              <p-tag [value]="signal.direction" [severity]="getDirectionSeverity(signal.direction)" />
            </td>
            <td class="font-mono text-sm">{{ signal.instrument }}</td>
            <td class="text-right font-mono">
              @if (signal.price !== null && signal.price !== undefined) {
                {{ signal.price | number: '1.2-8' }}
              } @else {
                <span class="text-gray-400">-</span>
              }
            </td>
            <td class="text-right">
              @if (signal.confidence !== null && signal.confidence !== undefined) {
                {{ signal.confidence | percent: '1.0-0' }}
              } @else {
                <span class="text-gray-400">-</span>
              }
            </td>
            <td>
              <p-tag [value]="getSourceLabel(signal.source)" [severity]="getSourceSeverity(signal.source)" />
            </td>
            <td class="max-w-30 truncate" [pTooltip]="signal.algorithmName">
              {{ signal.algorithmName }}
            </td>
            <td class="max-w-30 truncate" [pTooltip]="signal.userEmail || ''">
              {{ signal.userEmail || '-' }}
            </td>
            <td>
              <p-tag [value]="signal.status" [severity]="getStatusSeverity(signal.status)" />
            </td>
            <td>
              @if (signal.reasonCode) {
                <p-tag
                  [value]="getReasonCodeLabel(signal.reasonCode)"
                  [severity]="getReasonCodeSeverity(signal.reasonCode)"
                  [pTooltip]="signal.reasonCode"
                />
              } @else {
                <span class="text-gray-400">-</span>
              }
            </td>
            <td class="max-w-50 truncate" [pTooltip]="signal.reason || ''">
              {{ signal.reason || '-' }}
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="12" class="py-8 text-center text-gray-500">No signals found</td>
          </tr>
        </ng-template>
      </p-table>
    </p-card>
  `
})
export class SignalActivityFeedComponent {
  feed = input<SignalActivityFeedDto>();

  get lastSignalColorClass(): string {
    const lastSignalTime = this.feed()?.health?.lastSignalTime;
    if (lastSignalTime == null) return 'text-gray-400';
    const ms = Date.now() - new Date(lastSignalTime).getTime();
    if (ms < 5 * 60 * 1000) return 'text-green-500'; // < 5 min
    if (ms < 30 * 60 * 1000) return 'text-yellow-500'; // < 30 min
    return 'text-red-500'; // > 30 min
  }

  getSignalTypeSeverity(type: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (type) {
      case 'ENTRY':
        return 'success';
      case 'EXIT':
        return 'info';
      case 'ADJUSTMENT':
        return 'warn';
      case 'RISK_CONTROL':
        return 'danger';
      default:
        return 'secondary';
    }
  }

  getDirectionSeverity(direction: string): 'success' | 'danger' | 'secondary' {
    switch (direction) {
      case 'LONG':
        return 'success';
      case 'SHORT':
        return 'danger';
      default:
        return 'secondary';
    }
  }

  getSourceLabel(source: string): string {
    switch (source) {
      case 'BACKTEST':
        return 'Backtest';
      case 'PAPER_TRADING':
        return 'Paper';
      case 'LIVE_TRADING':
        return 'Live';
      default:
        return source;
    }
  }

  getSourceSeverity(source: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (source) {
      case 'BACKTEST':
        return 'info';
      case 'PAPER_TRADING':
        return 'warn';
      case 'LIVE_TRADING':
        return 'success';
      default:
        return 'secondary';
    }
  }

  getReasonCodeLabel(code: string): string {
    const labels: Record<string, string> = {
      [SignalReasonCode.SIGNAL_VALIDATION_FAILED]: 'Validation Failed',
      [SignalReasonCode.DAILY_LOSS_LIMIT]: 'Daily Loss',
      [SignalReasonCode.REGIME_GATE]: 'Regime Gate',
      [SignalReasonCode.DRAWDOWN_GATE]: 'Drawdown Gate',
      [SignalReasonCode.CONCENTRATION_LIMIT]: 'Concentration',
      [SignalReasonCode.CONCENTRATION_REDUCED]: 'Conc. Reduced',
      [SignalReasonCode.OPPORTUNITY_SELLING_REJECTED]: 'Opp. Rejected',
      [SignalReasonCode.INSUFFICIENT_FUNDS]: 'Insufficient Funds',
      [SignalReasonCode.EXCHANGE_SELECTION_FAILED]: 'Exchange Failed',
      [SignalReasonCode.TRADE_COOLDOWN]: 'Cooldown',
      [SignalReasonCode.ORDER_EXECUTION_FAILED]: 'Execution Failed',
      [SignalReasonCode.SIGNAL_THROTTLED]: 'Throttled',
      [SignalReasonCode.SYMBOL_RESOLUTION_FAILED]: 'Symbol Failed'
    };
    return labels[code] ?? code;
  }

  getReasonCodeSeverity(code: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (code) {
      case SignalReasonCode.ORDER_EXECUTION_FAILED:
      case SignalReasonCode.INSUFFICIENT_FUNDS:
      case SignalReasonCode.SIGNAL_VALIDATION_FAILED:
      case SignalReasonCode.SYMBOL_RESOLUTION_FAILED:
        return 'danger';
      case SignalReasonCode.DAILY_LOSS_LIMIT:
      case SignalReasonCode.DRAWDOWN_GATE:
      case SignalReasonCode.CONCENTRATION_LIMIT:
      case SignalReasonCode.CONCENTRATION_REDUCED:
        return 'warn';
      case SignalReasonCode.SIGNAL_THROTTLED:
      case SignalReasonCode.TRADE_COOLDOWN:
        return 'info';
      default:
        return 'secondary';
    }
  }

  getStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'PLACED':
      case 'PROCESSED':
      case 'SIMULATED':
        return 'success';
      case 'PENDING':
      case 'RECORDED':
        return 'info';
      case 'BLOCKED':
      case 'REJECTED':
        return 'warn';
      case 'FAILED':
      case 'ERROR':
        return 'danger';
      default:
        return 'secondary';
    }
  }
}
