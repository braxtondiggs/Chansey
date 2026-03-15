import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';

import { PortfolioType, TimePeriod, UserHoldingsDto } from '@chansey/api-interfaces';

import { CounterDirective } from '../../shared/directives/counter/counter.directive';
import { AuthService } from '../../shared/services/auth.service';
import { CoinDataService } from '../../shared/services/coin-data.service';
import { ExternalLinksComponent } from '../components/external-links/external-links.component';
import { HoldingsCardComponent } from '../components/holdings-card/holdings-card.component';
import { MarketStatsComponent } from '../components/market-stats/market-stats.component';
import { PriceChartComponent } from '../components/price-chart/price-chart.component';
import { CoinDetailQueries } from '../services/coin-detail.queries';

/**
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CardModule,
    SkeletonModule,
    ButtonModule,
    ToastModule,
    PriceChartComponent,
    MarketStatsComponent,
    HoldingsCardComponent,
    ExternalLinksComponent,
    CounterDirective
  ],
  providers: [CoinDetailQueries, MessageService],
  templateUrl: './coin-detail.component.html'
})
export class CoinDetailComponent {
  private router = inject(Router);
  private queries = inject(CoinDetailQueries);
  private authService = inject(AuthService);
  private coinDataService = inject(CoinDataService);
  private messageService = inject(MessageService);

  // Route param bound via withComponentInputBinding()
  slug = input.required<string>();

  // Component state
  selectedPeriod = signal<TimePeriod>('24h');
  descriptionExpanded = signal(false);
  private userQuery = this.authService.useUser();

  // Watchlist state
  watchlistQuery = this.coinDataService.useWatchlist();
  private addToWatchlistMutation = this.coinDataService.useAddToWatchlist();
  private removeFromWatchlistMutation = this.coinDataService.useRemoveFromWatchlist();
  processingWatchlist = signal(false);

  // Tighter card body padding on mobile for section cards
  sectionCardPt = { body: 'max-md:!py-3 max-md:!px-4' };

  // Computed signals
  isAuthenticated = computed(() => !!this.userQuery.data());

  // Initialize queries with the slug signal
  detailQuery = injectQuery(() => this.queries.useCoinDetailQuery(this.slug()));
  priceQuery = injectQuery(() => this.queries.useCoinPriceQuery(this.slug()));
  historyQuery = injectQuery(() => this.queries.useCoinHistoryQuery(this.slug(), this.selectedPeriod()));
  holdingsQuery = injectQuery(() => this.queries.useUserHoldingsQuery(this.slug(), this.isAuthenticated()));

  // Computed state from queries
  coinDetail = computed(() => this.detailQuery.data() ?? null);
  isLoading = computed(() => this.detailQuery.isLoading());
  error = computed(() => this.detailQuery.error()?.message);

  holdings = computed<UserHoldingsDto | null>(
    () => this.coinDetail()?.userHoldings ?? this.holdingsQuery.data() ?? null
  );

  periodHigh = computed(() => {
    const prices = this.historyQuery.data()?.prices;
    if (!prices?.length) return null;
    return Math.max(...prices.map((p) => p.price));
  });

  periodLow = computed(() => {
    const prices = this.historyQuery.data()?.prices;
    if (!prices?.length) return null;
    return Math.min(...prices.map((p) => p.price));
  });

  isInWatchlist = computed(() => {
    const items = this.watchlistQuery.data() || [];
    const detail = this.coinDetail();
    return items.some((item) => item.coin.id === detail?.id);
  });

  priceChangeClass = computed(() => {
    const detail = this.coinDetail();
    if (!detail?.priceChange24hPercent) return '';
    return detail.priceChange24hPercent >= 0 ? 'text-green-500' : 'text-red-500';
  });

  formattedPriceChange = computed(() => {
    const detail = this.coinDetail();
    const pct = Number(detail?.priceChange24hPercent);
    if (isNaN(pct)) return '0.00%';
    const value = Math.abs(pct);
    const sign = pct >= 0 ? '+' : '-';
    return `${sign}${value.toFixed(2)}%`;
  });

  athChangeText = computed(() => {
    const pct = Number(this.coinDetail()?.athChangePercent);
    if (isNaN(pct)) return '';
    return `${pct.toFixed(1)}%`;
  });

  is404 = computed(() => this.error()?.toLowerCase().includes('not found') ?? false);

  toggleWatchlist(): void {
    const detail = this.coinDetail();
    if (!detail || this.processingWatchlist()) return;

    if (this.isInWatchlist()) {
      const item = (this.watchlistQuery.data() || []).find((i) => i.coin.id === detail.id);
      if (!item) return;
      this.processingWatchlist.set(true);
      this.removeFromWatchlistMutation.mutate(item.id, {
        onSuccess: () => {
          this.processingWatchlist.set(false);
          this.messageService.add({
            severity: 'success',
            summary: 'Removed from Watchlist',
            detail: `${detail.name} removed from your watchlist`
          });
        },
        onError: () => {
          this.processingWatchlist.set(false);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update watchlist' });
        }
      });
    } else {
      this.processingWatchlist.set(true);
      this.addToWatchlistMutation.mutate(
        { coinId: detail.id, type: PortfolioType.MANUAL },
        {
          onSuccess: () => {
            this.processingWatchlist.set(false);
            this.messageService.add({
              severity: 'success',
              summary: 'Added to Watchlist',
              detail: `${detail.name} added to your watchlist`
            });
          },
          onError: () => {
            this.processingWatchlist.set(false);
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update watchlist' });
          }
        }
      );
    }
  }

  /**
   * Handle period change from chart component
   */
  onPeriodChange(period: TimePeriod): void {
    this.selectedPeriod.set(period);
  }

  /**
   * Toggle description expand/collapse
   */
  toggleDescription(): void {
    this.descriptionExpanded.update((v) => !v);
  }

  /**
   * Retry loading data after error
   */
  retry(): void {
    this.queries.invalidateCoinQueries(this.slug());
  }

  /**
   * T033: Navigate to prices page
   */
  goToPrices(): void {
    this.router.navigate(['/app/prices']);
  }

  formatPrice(value: number | null | undefined): string {
    if (value == null) return '—';
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
}
