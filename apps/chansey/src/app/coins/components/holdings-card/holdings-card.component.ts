import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CardModule } from 'primeng/card';

import { UserHoldingsDto } from '@chansey/api-interfaces';

/**
 * Displays user's holdings for a specific cryptocurrency.
 * Features:
 * - Total amount, average buy price, current value
 * - Profit/Loss with color coding (green/red)
 * - Per-exchange breakdown
 */
@Component({
  selector: 'app-holdings-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardModule],
  template: `
    <p-card data-testid="holdings-card" [pt]="{ body: 'max-md:!py-3 max-md:!px-4' }">
      <div>
        <!-- Total Amount -->
        <div
          class="border-surface flex items-center justify-between border-b py-3 last:border-b-0"
          data-testid="holdings-total-amount"
        >
          <span class="text-color-secondary text-sm">Total Amount</span>
          <span class="text-base font-semibold"
            >{{ holdings()?.totalAmount?.toFixed(8) }} {{ holdings()?.coinSymbol?.toUpperCase() }}</span
          >
        </div>

        <!-- Current Value -->
        <div
          class="border-surface flex items-center justify-between border-b py-3 last:border-b-0"
          data-testid="holdings-current-value"
        >
          <span class="text-color-secondary text-sm">Current Value</span>
          <span class="text-base font-semibold">{{ formatCurrency(holdings()?.currentValue) }}</span>
        </div>

        <!-- Average Buy Price -->
        <div
          class="border-surface flex items-center justify-between border-b py-3 last:border-b-0"
          data-testid="holdings-avg-price"
        >
          <span class="text-color-secondary text-sm">Avg Buy Price</span>
          <span class="text-base font-semibold" [class.text-color-secondary]="!hasCostBasis()">
            {{ hasCostBasis() ? formatCurrency(holdings()?.averageBuyPrice) : 'N/A' }}
          </span>
        </div>

        <!-- Profit/Loss -->
        <div
          class="border-surface flex items-center justify-between border-b py-3 last:border-b-0"
          data-testid="holdings-profit-loss"
          [class.text-green-500]="hasCostBasis() && (holdings()?.profitLoss ?? 0) >= 0"
          [class.text-red-500]="hasCostBasis() && (holdings()?.profitLoss ?? 0) < 0"
        >
          <span class="text-color-secondary text-sm">Profit/Loss</span>
          <span
            class="text-base font-semibold"
            [class.text-green-500]="hasCostBasis() && (holdings()?.profitLoss ?? 0) >= 0"
            [class.text-red-500]="hasCostBasis() && (holdings()?.profitLoss ?? 0) < 0"
            [class.text-color-secondary]="!hasCostBasis()"
          >
            @if (hasCostBasis()) {
              {{ formatCurrency(holdings()?.profitLoss) }}
              <span class="ml-2" data-testid="holdings-profit-loss-percent">
                ({{ holdings()?.profitLossPercent?.toFixed(2) }}%)
              </span>
            } @else {
              N/A
            }
          </span>
        </div>

        <!-- Exchange Breakdown -->
        @if (holdings()?.exchanges?.length) {
          <div class="mt-4">
            <h4 class="text-color-secondary mb-3 text-sm tracking-wide uppercase">Exchange Breakdown</h4>
            @for (exchange of holdings()?.exchanges ?? []; track exchange.exchangeName) {
              <div class="flex justify-between py-2 text-sm" data-testid="holdings-exchange-item">
                <span>{{ exchange.exchangeName }}</span>
                <span class="text-color-secondary font-medium"
                  >{{ exchange.amount.toFixed(8) }} {{ holdings()?.coinSymbol?.toUpperCase() }}</span
                >
              </div>
            }
          </div>
        }
      </div>
    </p-card>
  `
})
export class HoldingsCardComponent {
  holdings = input<UserHoldingsDto | null>(null);

  hasCostBasis = computed(() => {
    const h = this.holdings();
    return !!h && h.averageBuyPrice > 0;
  });

  formatCurrency(value?: number): string {
    if (!value && value !== 0) return '$0.00';
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
