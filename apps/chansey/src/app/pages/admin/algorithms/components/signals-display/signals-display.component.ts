import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { TradingSignalType, TradingSignal } from '@chansey/api-interfaces';

@Component({
  selector: 'app-signals-display',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule, TagModule, TooltipModule],
  template: `
    <p-card>
      <ng-template #header>
        <div class="flex items-center justify-between p-4 pb-0">
          <h3 class="m-0 text-lg font-semibold">Trading Signals</h3>
          @if (signals && signals.length > 0) {
            <span class="text-sm text-gray-500">{{ signals.length }} signal(s) generated</span>
          }
        </div>
      </ng-template>

      @if (signals && signals.length > 0) {
        <p-table [value]="signals" [paginator]="signals.length > 10" [rows]="10" size="small" stripedRows>
          <ng-template #header>
            <tr>
              <th>Coin</th>
              <th>Signal</th>
              <th>Strength</th>
              <th>Confidence</th>
              <th>Price</th>
              <th style="min-width: 200px">Reason</th>
            </tr>
          </ng-template>

          <ng-template #body let-signal>
            <tr>
              <td>
                <span class="font-medium">{{ signal.coinId }}</span>
              </td>
              <td>
                <p-tag [value]="signal.type" [severity]="getSignalSeverity(signal.type)"></p-tag>
              </td>
              <td>
                <div class="flex items-center gap-2">
                  <div class="h-2 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      class="h-full rounded-full"
                      [class]="getStrengthBarClass(signal.strength)"
                      [style.width.%]="signal.strength * 100"
                    ></div>
                  </div>
                  <span class="text-sm">{{ formatPercent(signal.strength) }}</span>
                </div>
              </td>
              <td>
                <span [class]="getConfidenceClass(signal.confidence)">
                  {{ formatPercent(signal.confidence) }}
                </span>
              </td>
              <td>
                <span class="font-mono text-sm">{{ formatPrice(signal.price) }}</span>
              </td>
              <td>
                <span class="text-sm" [pTooltip]="signal.reason" tooltipPosition="top">
                  {{ truncateReason(signal.reason) }}
                </span>
              </td>
            </tr>
          </ng-template>

          <ng-template #emptymessage>
            <tr>
              <td colspan="6" class="text-center text-gray-500">No signals generated</td>
            </tr>
          </ng-template>
        </p-table>
      } @else {
        <div class="py-8 text-center">
          <i class="pi pi-bolt mb-3 text-4xl text-gray-400"></i>
          <p class="m-0 text-gray-500">No trading signals to display.</p>
          <p class="mt-1 text-sm text-gray-400">Execute the algorithm to generate signals.</p>
        </div>
      }
    </p-card>
  `
})
export class SignalsDisplayComponent {
  @Input() signals?: TradingSignal[] | null;

  getSignalSeverity(type: TradingSignalType): 'success' | 'danger' | 'secondary' | 'info' | 'warn' | 'contrast' {
    switch (type) {
      case TradingSignalType.BUY:
        return 'success';
      case TradingSignalType.SELL:
        return 'danger';
      case TradingSignalType.HOLD:
      default:
        return 'secondary';
    }
  }

  getStrengthBarClass(strength: number): string {
    if (strength >= 0.7) return 'bg-green-500';
    if (strength >= 0.4) return 'bg-yellow-500';
    return 'bg-red-500';
  }

  getConfidenceClass(confidence: number): string {
    if (confidence >= 0.8) return 'text-green-600 font-medium';
    if (confidence >= 0.6) return 'text-yellow-600';
    return 'text-red-600';
  }

  formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  formatPrice(price: number): string {
    if (price >= 1000) {
      return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${price.toFixed(price < 1 ? 6 : 2)}`;
  }

  truncateReason(reason: string, maxLength: number = 50): string {
    if (reason.length <= maxLength) return reason;
    return `${reason.substring(0, maxLength)}...`;
  }
}
