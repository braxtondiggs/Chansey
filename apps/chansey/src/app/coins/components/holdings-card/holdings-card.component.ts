import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';

import { UserHoldingsDto } from '@chansey/api-interfaces';

/**
 * T027: HoldingsCardComponent
 *
 * Displays user's holdings for a specific cryptocurrency.
 * Features:
 * - Total amount, average buy price, current value
 * - Profit/Loss with color coding (green/red)
 * - Per-exchange breakdown
 */
@Component({
  selector: 'app-holdings-card',
  standalone: true,
  imports: [CommonModule, CardModule],
  template: `
    <p-card [header]="'Your ' + (holdings?.coinSymbol || 'Holdings')" data-testid="holdings-card">
      <div class="holdings-content">
        <!-- Total Amount -->
        <div class="holding-row" data-testid="holdings-total-amount">
          <span class="label">Total Amount</span>
          <span class="value">{{ holdings?.totalAmount?.toFixed(8) }} {{ holdings?.coinSymbol }}</span>
        </div>

        <!-- Current Value -->
        <div class="holding-row" data-testid="holdings-current-value">
          <span class="label">Current Value</span>
          <span class="value">{{ formatCurrency(holdings?.currentValue) }}</span>
        </div>

        <!-- Average Buy Price -->
        <div class="holding-row" data-testid="holdings-avg-price">
          <span class="label">Avg Buy Price</span>
          <span class="value">{{ formatCurrency(holdings?.averageBuyPrice) }}</span>
        </div>

        <!-- Profit/Loss -->
        <div class="holding-row" data-testid="holdings-profit-loss" [ngClass]="getProfitLossClasses()">
          <span class="label">Profit/Loss</span>
          <span class="value" [ngClass]="getProfitLossClasses()">
            {{ formatCurrency(holdings?.profitLoss) }}
            <span class="ml-2" data-testid="holdings-profit-loss-percent">
              ({{ holdings?.profitLossPercent?.toFixed(2) }}%)
            </span>
          </span>
        </div>

        <!-- Exchange Breakdown -->
        @if (holdings?.exchanges && holdings!.exchanges.length > 0) {
          <div class="exchanges-section mt-4">
            <h4>Exchange Breakdown</h4>
            @for (exchange of holdings!.exchanges; track exchange.exchangeName) {
              <div class="exchange-item" data-testid="holdings-exchange-item">
                <span class="exchange-name">{{ exchange.exchangeName }}</span>
                <span class="exchange-amount">{{ exchange.amount.toFixed(8) }} {{ holdings?.coinSymbol }}</span>
              </div>
            }
          </div>
        }
      </div>
    </p-card>
  `,
  styles: [
    `
      .holdings-content {
        .holding-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 0;
          border-bottom: 1px solid var(--surface-border);

          &:last-of-type {
            border-bottom: none;
          }

          .label {
            font-size: 0.875rem;
            color: var(--text-color-secondary);
          }

          .value {
            font-size: 1rem;
            font-weight: 600;
            color: var(--text-color);

            &.text-green-500 {
              color: rgb(34, 197, 94);
            }

            &.text-red-500 {
              color: rgb(239, 68, 68);
            }
          }
        }

        .exchanges-section {
          h4 {
            font-size: 0.875rem;
            color: var(--text-color-secondary);
            margin-bottom: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .exchange-item {
            display: flex;
            justify-content: space-between;
            padding: 0.5rem 0;
            font-size: 0.875rem;

            .exchange-name {
              color: var(--text-color);
            }

            .exchange-amount {
              font-weight: 500;
              color: var(--text-color-secondary);
            }
          }
        }
      }
    `
  ]
})
export class HoldingsCardComponent {
  @Input() holdings?: UserHoldingsDto | null;

  formatCurrency(value?: number): string {
    if (!value && value !== 0) return '$0.00';
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  getProfitLossClasses(): Record<string, boolean> {
    const profit = this.holdings?.profitLoss;
    if (typeof profit !== 'number') {
      return {};
    }
    return {
      'text-green-500': profit >= 0,
      'text-red-500': profit < 0
    };
  }

}
