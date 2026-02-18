import { CommonModule, Location } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';

import { CoinDetailResponseDto, TimePeriod, UserHoldingsDto } from '@chansey/api-interfaces';

import { CounterDirective } from '../../shared/directives/counter/counter.directive';
import { ExternalLinksComponent } from '../components/external-links/external-links.component';
import { HoldingsCardComponent } from '../components/holdings-card/holdings-card.component';
import { MarketStatsComponent } from '../components/market-stats/market-stats.component';
import { PriceChartComponent } from '../components/price-chart/price-chart.component';
import { CoinDetailQueries } from '../services/coin-detail.queries';

/**
 * T029-T031: CoinDetailComponent
 *
 * Main component for the dedicated coin detail page.
 * Features:
 * - Displays comprehensive coin information
 * - Auto-refreshing price data
 * - Interactive price chart with period selection
 * - User holdings (if authenticated)
 * - External resource links
 * - Loading and error states
 */
@Component({
  selector: 'app-coin-detail',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    SkeletonModule,
    ButtonModule,
    PriceChartComponent,
    MarketStatsComponent,
    HoldingsCardComponent,
    ExternalLinksComponent,
    CounterDirective
  ],
  providers: [CoinDetailQueries],
  templateUrl: './coin-detail.component.html',
  styleUrls: ['./coin-detail.component.scss']
})
export class CoinDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private queries = inject(CoinDetailQueries);
  private coinDetailOverride?: CoinDetailResponseDto | null;
  private isLoadingOverride?: boolean;
  private errorOverride?: string | null;

  // Extract slug from route snapshot (available immediately in constructor)
  public slug = this.route.snapshot?.params?.['slug'] || '';

  // Component state
  selectedPeriod = signal<TimePeriod>('24h');
  isAuthenticated = false;

  // Initialize queries with the slug from route snapshot
  detailQuery = injectQuery(() => this.queries.useCoinDetailQuery(this.slug));
  priceQuery = injectQuery(() => this.queries.useCoinPriceQuery(this.slug));

  historyQuery = injectQuery(() => this.queries.useCoinHistoryQuery(this.slug, this.selectedPeriod()));

  holdingsQuery = injectQuery(() => this.queries.useUserHoldingsQuery(this.slug, this.isAuthenticated));

  // Computed state from queries
  get coinDetail() {
    if (this.coinDetailOverride !== undefined) {
      return this.coinDetailOverride;
    }
    return this.detailQuery.data() ?? null;
  }

  set coinDetail(value: CoinDetailResponseDto | null | undefined) {
    if (value === undefined) {
      this.coinDetailOverride = undefined;
    } else {
      this.coinDetailOverride = value;
    }
  }

  get isLoading() {
    if (this.isLoadingOverride !== undefined) {
      return this.isLoadingOverride;
    }
    return this.detailQuery.isLoading();
  }

  set isLoading(value: boolean | undefined) {
    this.isLoadingOverride = value;
  }

  get error() {
    if (this.errorOverride !== undefined) {
      return this.errorOverride ?? undefined;
    }
    return this.detailQuery.error()?.message;
  }

  set error(value: string | null | undefined) {
    if (value === undefined) {
      this.errorOverride = undefined;
    } else {
      this.errorOverride = value;
    }
  }

  get holdings(): UserHoldingsDto | null {
    if (this.coinDetail?.userHoldings) {
      return this.coinDetail.userHoldings;
    }
    return this.holdingsQuery.data() ?? null;
  }

  /**
   * Handle period change from chart component
   */
  onPeriodChange(period: TimePeriod): void {
    this.selectedPeriod.set(period);
    // The history query will automatically refetch for the selected period
  }

  /**
   * Retry loading data after error
   */
  retry(): void {
    this.queries.invalidateCoinQueries(this.slug);
  }

  /**
   * Get price change class for styling
   */
  getPriceChangeClass(): string {
    if (!this.coinDetail?.priceChange24hPercent) return '';
    return this.coinDetail.priceChange24hPercent >= 0 ? 'text-green-500' : 'text-red-500';
  }

  /**
   * Format price change percentage
   */
  formatPriceChange(): string {
    if (!this.coinDetail?.priceChange24hPercent) return '0.00%';
    const value = Math.abs(this.coinDetail.priceChange24hPercent);
    const sign = this.coinDetail.priceChange24hPercent >= 0 ? '+' : '-';
    return `${sign}${value.toFixed(2)}%`;
  }

  /**
   * T033: Check if error is a 404 (coin not found)
   */
  is404Error(): boolean {
    return this.error?.toLowerCase().includes('not found') ?? false;
  }

  /**
   * T033: Navigate to prices page
   */
  goToPrices(): void {
    this.router.navigate(['/app/prices']);
  }

  /**
   * Navigate back to previous page
   */
  goBack(): void {
    this.location.back();
  }
}
