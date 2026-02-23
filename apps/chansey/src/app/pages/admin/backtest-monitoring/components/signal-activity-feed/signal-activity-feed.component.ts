import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { SignalActivityFeedDto } from '@chansey/api-interfaces';

@Component({
  selector: 'app-signal-activity-feed',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule, TagModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Health Cards -->
    <div class="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
      <p-card>
        <div class="text-center">
          <div class="text-sm text-gray-500">Last Signal</div>
          @if (feed?.health?.lastSignalTime) {
            <div class="text-xl font-bold" [class]="lastSignalColorClass">
              {{ formatTimeAgo(feed?.health?.lastSignalTime) }}
            </div>
            <div class="mt-1 text-xs text-gray-400">{{ feed?.health?.lastSignalTime | date: 'short' }}</div>
          } @else {
            <div class="text-xl font-bold text-gray-400">No signals</div>
          }
        </div>
      </p-card>

      <p-card>
        <div class="text-center">
          <div class="text-sm text-gray-500">Signals / Hour</div>
          <div class="text-2xl font-bold">{{ feed?.health?.signalsLastHour ?? 0 }}</div>
        </div>
      </p-card>

      <p-card>
        <div class="text-center">
          <div class="text-sm text-gray-500">Signals / 24h</div>
          <div class="text-2xl font-bold">{{ feed?.health?.signalsLast24h ?? 0 }}</div>
        </div>
      </p-card>

      <p-card>
        <div class="text-center">
          <div class="text-sm text-gray-500">Active Sources</div>
          <div class="text-2xl font-bold">{{ feed?.health?.totalActiveSources ?? 0 }}</div>
          <div class="mt-1 text-xs text-gray-400">
            {{ feed?.health?.activeBacktestSources ?? 0 }} backtest ·
            {{ feed?.health?.activePaperTradingSources ?? 0 }} paper
          </div>
        </div>
      </p-card>
    </div>

    <!-- Signal Feed Table -->
    <p-card header="Recent Signals">
      <p-table
        [value]="feed?.signals ?? []"
        [rows]="20"
        [paginator]="(feed?.signals?.length ?? 0) > 20"
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
              <p-tag
                [value]="signal.source === 'BACKTEST' ? 'Backtest' : 'Paper'"
                [severity]="signal.source === 'BACKTEST' ? 'info' : 'warn'"
              />
            </td>
            <td class="max-w-[120px] truncate" [pTooltip]="signal.algorithmName">
              {{ signal.algorithmName }}
            </td>
            <td class="max-w-[120px] truncate" [pTooltip]="signal.userEmail || ''">
              {{ signal.userEmail || '-' }}
            </td>
            <td class="max-w-[200px] truncate" [pTooltip]="signal.reason || ''">
              {{ signal.reason || '-' }}
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="10" class="py-8 text-center text-gray-500">No signals found</td>
          </tr>
        </ng-template>
      </p-table>
    </p-card>
  `
})
export class SignalActivityFeedComponent {
  @Input() feed?: SignalActivityFeedDto;

  get lastSignalColorClass(): string {
    const lastSignalTime = this.feed?.health?.lastSignalTime;
    if (lastSignalTime == null) return 'text-gray-400';
    const ms = Date.now() - new Date(lastSignalTime).getTime();
    if (ms < 5 * 60 * 1000) return 'text-green-500'; // < 5 min
    if (ms < 30 * 60 * 1000) return 'text-yellow-500'; // < 30 min
    return 'text-red-500'; // > 30 min
  }

  formatTimeAgo(lastSignalTime?: string): string {
    if (lastSignalTime == null) return 'Never';
    const ms = Date.now() - new Date(lastSignalTime).getTime();
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
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
}
