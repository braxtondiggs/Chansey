import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';

import { CoinDetailResponseDto } from '@chansey/api-interfaces';

import { CounterDirective } from '@chansey-web/app/shared/directives/counter/counter.directive';

/**
 * T026: MarketStatsComponent
 *
 * Displays key market statistics for a cryptocurrency.
 * Features:
 * - Market Cap, 24h Volume, Circulating Supply
 * - Optional: Total Supply, Max Supply, Market Cap Rank
 * - Large number formatting (B/M/K)
 * - Responsive grid layout
 */
@Component({
  selector: 'app-market-stats',
  standalone: true,
  imports: [CommonModule, CardModule, CounterDirective],
  template: `
    <div class="market-stats-grid">
      <!-- Market Cap -->
      <div class="stat-card" data-testid="market-cap">
        <div class="stat-label">Market Cap</div>
        <div class="stat-value">
          <span [appCounter]="coinDetail?.marketCap ?? 0" [formatter]="currencyFormatter"> </span>
        </div>
        @if (coinDetail?.marketCapRank) {
          <div class="stat-rank" data-testid="market-cap-rank">Rank #{{ coinDetail!.marketCapRank }}</div>
        }
      </div>

      <!-- 24h Volume -->
      <div class="stat-card" data-testid="volume-24h">
        <div class="stat-label">24h Volume</div>
        <div class="stat-value">
          <span [appCounter]="coinDetail?.volume24h ?? 0" [formatter]="currencyFormatter"> </span>
        </div>
      </div>

      <!-- Circulating Supply -->
      <div class="stat-card" data-testid="circulating-supply">
        <div class="stat-label">Circulating Supply</div>
        <div class="stat-value">
          <span [appCounter]="coinDetail?.circulatingSupply ?? 0" [formatter]="supplyFormatter"> </span>
          <span class="stat-suffix" *ngIf="coinDetail?.symbol">{{ coinDetail?.symbol?.toUpperCase() }}</span>
        </div>
      </div>

      <!-- Total Supply -->
      @if (coinDetail?.totalSupply) {
        <div class="stat-card" data-testid="total-supply">
          <div class="stat-label">Total Supply</div>
          <div class="stat-value">
            <span [appCounter]="coinDetail!.totalSupply ?? 0" [formatter]="supplyFormatter"> </span>
            <span class="stat-suffix" *ngIf="coinDetail?.symbol">{{ coinDetail?.symbol?.toUpperCase() }}</span>
          </div>
        </div>
      }

      <!-- Max Supply -->
      <div class="stat-card" data-testid="max-supply">
        <div class="stat-label">Max Supply</div>
        @if (coinDetail?.maxSupply) {
          <div class="stat-value">
            <span [appCounter]="coinDetail!.maxSupply ?? 0" [formatter]="supplyFormatter" [duration]="700">
              {{ formatSupplyNumber(coinDetail!.maxSupply) }}
            </span>
            <span class="stat-suffix" *ngIf="coinDetail?.symbol">{{ coinDetail?.symbol?.toUpperCase() }}</span>
          </div>
        } @else {
          <div class="stat-value">Unlimited</div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .market-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        padding: 1rem 0;
      }

      .stat-card {
        padding: 1.5rem;
        background: var(--surface-card);
        border: 1px solid var(--surface-border);
        border-radius: 8px;
        transition:
          transform 0.2s,
          box-shadow 0.2s;

        &:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
      }

      .stat-label {
        font-size: 0.875rem;
        color: var(--text-color-secondary);
        margin-bottom: 0.5rem;
        font-weight: 500;
      }

      .stat-value {
        display: flex;
        align-items: baseline;
        gap: 0.35rem;
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--text-color);
      }

      .stat-value .stat-suffix {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-color-secondary);
        letter-spacing: 0.05em;
      }

      .stat-rank {
        margin-top: 0.5rem;
        font-size: 0.75rem;
        color: var(--primary-color);
        font-weight: 600;
      }

      @media (max-width: 768px) {
        .market-stats-grid {
          grid-template-columns: 1fr;
        }

        .stat-value {
          font-size: 1.25rem;
        }
      }
    `
  ]
})
export class MarketStatsComponent {
  @Input() coinDetail?: CoinDetailResponseDto | null;
  readonly currencyFormatter = (value: number) => this.formatLargeNumber(value);
  readonly supplyFormatter = (value: number) => this.formatSupplyNumber(value);

  /**
   * Format large numbers with B/M/K suffixes
   */
  formatLargeNumber(value?: number): string {
    if (!value) return '$0';

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
   * Format supply values with thousands separators
   */
  formatSupplyNumber(value?: number): string {
    if (!value) return '0';
    const rounded = Math.round(value);
    return rounded.toLocaleString('en-US');
  }
}
