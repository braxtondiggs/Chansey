import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { CoinDetailResponseDto } from '@chansey/api-interfaces';

import { CounterDirective } from '../../../shared/directives/counter/counter.directive';
import { LayoutService } from '../../../shared/services/layout.service';

/**
 * T026: MarketStatsComponent
 *
 * Displays key market statistics for a cryptocurrency.
 * Features:
 * - Market Cap, 24h Volume, consolidated Supply card
 * - Supply progress bar showing circulating vs max supply
 * - Large number formatting (B/M/K)
 * - Responsive 3-column grid layout
 */
@Component({
  selector: 'app-market-stats',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, CounterDirective],
  template: `
    <div class="market-stats-grid grid grid-cols-1 gap-3 py-2 md:grid-cols-3 md:gap-4 md:py-4">
      <!-- Market Cap -->
      <div class="stat-card rounded-lg p-4 transition-transform duration-200 md:p-6" data-testid="market-cap">
        <div class="stat-label mb-2 text-sm font-medium">Market Cap</div>
        <div class="stat-value flex items-baseline gap-1 text-xl font-bold md:text-2xl">
          <span [appCounter]="coinDetail()?.marketCap ?? 0" [formatter]="currencyFormatter"> </span>
        </div>
        @if (coinDetail()?.marketCapRank) {
          <div class="stat-rank mt-2 text-xs font-semibold" data-testid="market-cap-rank">
            Rank #{{ coinDetail()!.marketCapRank }}
          </div>
        }
      </div>

      <!-- 24h Volume -->
      <div class="stat-card rounded-lg p-4 transition-transform duration-200 md:p-6" data-testid="volume-24h">
        <div class="stat-label mb-2 text-sm font-medium">24h Volume</div>
        <div class="stat-value flex items-baseline gap-1 text-xl font-bold md:text-2xl">
          <span [appCounter]="coinDetail()?.volume24h ?? 0" [formatter]="currencyFormatter"> </span>
        </div>
      </div>

      <!-- Supply (consolidated) -->
      <div class="stat-card rounded-lg p-4 transition-transform duration-200 md:p-6" data-testid="supply">
        <div class="stat-label mb-2 text-sm font-medium">Circulating Supply</div>
        <div class="stat-value flex items-baseline gap-1 text-xl font-bold md:text-2xl">
          <span [appCounter]="coinDetail()?.circulatingSupply ?? 0" [formatter]="supplyFormatter"> </span>
          @if (coinDetail()?.symbol) {
            <span class="stat-suffix text-sm font-semibold tracking-wide">{{
              coinDetail()!.symbol!.toUpperCase()
            }}</span>
          }
        </div>

        @if (coinDetail()?.maxSupply) {
          <div class="supply-progress-section mt-3">
            <div class="supply-progress-bar h-1.5 overflow-hidden rounded-sm">
              <div
                class="supply-progress-fill h-full rounded-sm transition-all duration-[600ms]"
                [style.width.%]="supplyPercentage()"
              ></div>
            </div>
            <div class="supply-progress-label mt-1 text-xs font-medium">
              {{ supplyPercentage() | number: '1.1-1' }}% of {{ formatSupplyNumber(coinDetail()!.maxSupply) }} max
              supply
            </div>
          </div>
        } @else {
          <div class="supply-progress-label mt-1 text-xs font-medium">Max Supply: Unlimited</div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .stat-card {
        background: var(--surface-card);
        border: 1px solid var(--surface-border);

        &:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
      }

      .stat-label {
        color: var(--text-color-secondary);
      }

      .stat-value {
        color: var(--text-color);
      }

      .stat-suffix {
        color: var(--text-color-secondary);
      }

      .stat-rank {
        color: var(--primary-color);
      }

      .supply-progress-bar {
        background: var(--surface-border);
      }

      .supply-progress-fill {
        background: var(--primary-color);
      }

      .supply-progress-label {
        color: var(--text-color-secondary);
      }
    `
  ]
})
export class MarketStatsComponent {
  private layoutService = inject(LayoutService);

  coinDetail = input<CoinDetailResponseDto | null>(null);
  readonly currencyFormatter = (value: number) => this.formatLargeNumber(value);
  readonly supplyFormatter = (value: number) => this.formatSupplyNumber(value);

  supplyPercentage = computed(() => {
    const detail = this.coinDetail();
    if (!detail?.circulatingSupply || !detail?.maxSupply) return 0;
    return Math.min((detail.circulatingSupply / detail.maxSupply) * 100, 100);
  });

  /**
   * Format large numbers with B/M/K suffixes
   */
  formatLargeNumber(value?: number): string {
    if (value == null) return '$0';

    const absValue = Math.abs(value);
    if (absValue >= 1e12) {
      return '$' + (value / 1e12).toFixed(2) + 'T';
    } else if (absValue >= 1e9) {
      return '$' + (value / 1e9).toFixed(2) + 'B';
    } else if (absValue >= 1e6) {
      return '$' + (value / 1e6).toFixed(2) + 'M';
    } else if (absValue >= 1e3) {
      return '$' + (value / 1e3).toFixed(2) + 'K';
    } else {
      return '$' + value.toFixed(2);
    }
  }

  /**
   * Format supply values — abbreviated on mobile, full precision on desktop
   */
  formatSupplyNumber(value?: number): string {
    if (value == null) return '0';
    if (this.layoutService.isMobile()) {
      return this.abbreviateNumber(value);
    }
    return Math.round(value).toLocaleString('en-US');
  }

  private abbreviateNumber(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1e12) return (value / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (value / 1e3).toFixed(1) + 'K';
    return Math.round(value).toLocaleString('en-US');
  }
}
