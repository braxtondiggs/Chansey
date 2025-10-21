import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, EventEmitter, inject, Input, Output, signal, ViewChild } from '@angular/core';
import { RouterModule } from '@angular/router';

import { MessageService } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { SkeletonModule } from 'primeng/skeleton';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';

import { Coin } from '@chansey/api-interfaces';

import { PriceService } from '@chansey-web/app/pages/prices/prices.service';
import { CounterDirective } from '@chansey-web/app/shared/directives/counter/counter.directive';
import { FormatLargeNumberPipe } from '@chansey-web/app/shared/pipes/format-large-number.pipe';

export interface CryptoTableConfig {
  showWatchlistToggle?: boolean;
  showRemoveAction?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  cardTitle?: string;
}

@Component({
  selector: 'app-crypto-table',
  standalone: true,
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    CommonModule,
    CounterDirective,
    FormatLargeNumberPipe,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    ProgressBarModule,
    RouterModule,
    SkeletonModule,
    TableModule,
    TagModule,
    ToastModule,
    TooltipModule
  ],
  providers: [MessageService],
  templateUrl: './crypto-table.component.html'
})
export class CryptoTableComponent {
  @ViewChild('dt') dt!: Table;
  @ViewChild('searchInput') searchInput: ElementRef<HTMLInputElement> | undefined;

  @Input() set coins(value: Coin[]) {
    this.coinsSignal.set(value);
  }
  get coins(): Coin[] {
    return this.coinsSignal();
  }

  @Input() isLoading = false;
  @Input() config: CryptoTableConfig = {
    showWatchlistToggle: true,
    showRemoveAction: false,
    searchPlaceholder: 'Search coins...',
    emptyMessage: 'No coins found.',
    cardTitle: 'Cryptocurrency Prices'
  };
  @Input() watchlistCoinIds: Set<string> = new Set();
  @Input() processingCoinId: string | null = null;

  @Output() toggleWatchlist = new EventEmitter<Coin>();
  @Output() removeCoin = new EventEmitter<Coin>();

  // Internal signal to track coins array changes
  coinsSignal = signal<Coin[]>([]);
  searchFilter = signal<string>('');
  currentPage = signal<number>(0);
  rowsPerPage = signal<number>(25);
  // Sorting state signals
  sortField = signal<string>('');
  sortOrder = signal<number>(0); // 0 = no sort, 1 = asc, -1 = desc
  messageService = inject(MessageService);
  priceService = inject(PriceService);

  // Computed signal for sorted coins that the table displays
  sortedCoins = computed(() => {
    const coins = this.coinsSignal();
    const sortField = this.sortField();
    const sortOrder = this.sortOrder();

    // Apply sorting if we have sort criteria
    if (sortField && sortOrder !== 0) {
      return this.applySorting([...coins], sortField, sortOrder);
    }

    return coins;
  });

  // Computed signal to get sorted and paginated coin IDs for price query
  coinIds = computed(() => {
    const sortedCoins = this.sortedCoins();
    const page = this.currentPage();
    const rows = this.rowsPerPage();

    const startIndex = page * rows;
    const endIndex = startIndex + rows;

    // Get coins for the current page only
    const visibleCoins = sortedCoins.slice(startIndex, endIndex);
    const coinIds = visibleCoins
      .filter((coin) => coin.slug) // Filter out coins without slugs
      .map((coin) => coin.slug)
      .join(',');
    return coinIds;
  });
  priceQuery = this.priceService.usePrices(this.coinIds);

  // Computed signal that provides a price lookup map
  pricesMap = computed(() => {
    const query = this.priceQuery;
    const priceData = query?.data();

    if (!priceData || typeof priceData !== 'object' || Array.isArray(priceData)) {
      return new Map<string, number>();
    }

    const pricesMap = new Map<string, number>();
    const typedPriceData = priceData as Record<string, { usd?: number }>;

    Object.entries(typedPriceData).forEach(([coinId, data]) => {
      if (data.usd) {
        pricesMap.set(coinId, data.usd);
      }
    });

    return pricesMap;
  });

  // Helper method to get price for a specific coin
  getCoinPrice = computed(() => {
    const pricesMap = this.pricesMap();
    const sortedCoins = this.sortedCoins();

    return (coinSlug: string) => {
      const priceFromService = Number(pricesMap.get(coinSlug));
      if (priceFromService > 0) {
        return priceFromService;
      }

      // Fall back to coin's currentPrice if price service doesn't have data
      const coin = sortedCoins.find((c) => c.slug === coinSlug);
      if (coin?.currentPrice && Number(coin.currentPrice) > 0) {
        return +coin.currentPrice;
      }

      return 0;
    };
  });

  // Check if we're loading price data - returns a function to check individual coins
  isLoadingPrices = computed(() => {
    const query = this.priceQuery;
    const pricesMap = this.pricesMap();
    const isQueryPending = query?.isPending() || false;

    // Return a function that can check if a specific coin is loading
    return (coinSlug?: string) => {
      // If no coin slug provided, return false (don't show loading for global checks)
      if (!coinSlug) return false;

      // Find the coin to check its currentPrice
      const coin = this.sortedCoins().find((c) => c.slug === coinSlug);

      // Show loading if:
      // 1. The query is pending (we're fetching new data)
      // 2. AND we don't have reliable price data (no currentPrice AND no service price)
      const hasCurrentPrice = coin?.currentPrice && Number(coin.currentPrice) > 0;
      const hasServicePrice = pricesMap.get(coinSlug) && Number(pricesMap.get(coinSlug) || 0) > 0;

      // Only show loading when query is pending AND we don't have any price data
      return isQueryPending && !hasCurrentPrice && !hasServicePrice;
    };
  });

  /**
   * Apply sorting to coins array without mutating the original
   */
  private applySorting(coins: Coin[], field: string, order: number): Coin[] {
    // Define numeric fields that need custom sorting
    const numericFields = [
      'currentPrice',
      'marketCap',
      'totalVolume',
      'circulatingSupply',
      'maxSupply',
      'priceChangePercentage24h',
      'marketRank'
    ];

    return coins.sort((a: Coin, b: Coin) => {
      if (numericFields.includes(field)) {
        // Get the raw numeric values for comparison
        const aValue = this.getNumericValue(a, field);
        const bValue = this.getNumericValue(b, field);

        // Handle null/undefined values - put them at the end
        if (aValue === null && bValue === null) return 0;
        if (aValue === null) return 1;
        if (bValue === null) return -1;

        // Perform numeric comparison
        const result = aValue - bValue;
        return order === 1 ? result : -result;
      } else {
        // For non-numeric fields, use default string sorting
        const aValue = this.getStringValue(a, field);
        const bValue = this.getStringValue(b, field);

        const result = aValue.localeCompare(bValue);
        return order === 1 ? result : -result;
      }
    });
  }

  /**
   * Custom sort function to handle numeric fields properly
   * This prevents PrimeNG from sorting by formatted display values
   */
  customSort = (event: { field: string; order: number }) => {
    const { field, order } = event;
    this.sortField.set(field);
    this.sortOrder.set(order);
  };

  /**
   * Get numeric value from coin object for sorting
   */
  private getNumericValue(coin: Coin, field: string): number | null {
    const value = coin[field as keyof Coin];

    if (value === null || value === undefined) {
      return null;
    }

    // Convert to number and handle edge cases
    const numValue = Number(value);
    return isNaN(numValue) ? null : numValue;
  }

  /**
   * Get string value from coin object for sorting
   */
  private getStringValue(coin: Coin, field: string): string {
    const value = coin[field as keyof Coin];
    return value ? String(value).toLowerCase() : '';
  }

  applyGlobalFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    // Handle empty search better by using empty string instead of null/undefined
    const safeFilterValue = filterValue?.trim() ?? '';
    this.searchFilter.set(safeFilterValue);
    this.dt?.filterGlobal(safeFilterValue, 'contains');
  }

  clearSearch(): void {
    this.searchFilter.set('');
    this.dt?.filterGlobal('', 'contains');
    // Also clear the input field
    if (this.searchInput?.nativeElement) {
      this.searchInput.nativeElement.value = '';
    }
  }

  isInWatchlist(coinId: string): boolean {
    return this.watchlistCoinIds.has(coinId);
  }

  isCoinProcessing(coinId: string): boolean {
    return this.processingCoinId === coinId;
  }

  onToggleWatchlist(coin: Coin): void {
    this.toggleWatchlist.emit(coin);
  }

  onRemoveCoin(coin: Coin): void {
    this.removeCoin.emit(coin);
  }

  onPageChange(event: { first?: number; rows?: number; page?: number }): void {
    const rows = event.rows || 25;
    const page = event.first ? Math.floor(event.first / rows) : 0;

    this.currentPage.set(page);
    this.rowsPerPage.set(rows);
  }

  getTag(change: number | undefined): 'success' | 'danger' {
    if (change === undefined) return 'success';
    return +change >= 0 ? 'success' : 'danger';
  }
}
