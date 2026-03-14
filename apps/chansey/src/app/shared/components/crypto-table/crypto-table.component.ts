import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { Router } from '@angular/router';

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
import { TooltipModule } from 'primeng/tooltip';

import { Coin } from '@chansey/api-interfaces';

import { CounterDirective } from '../../directives/counter/counter.directive';
import { FormatLargeNumberPipe } from '../../pipes/format-large-number.pipe';
import { CoinDataService } from '../../services/coin-data.service';

export interface CryptoTableConfig {
  showWatchlistToggle?: boolean;
  showRemoveAction?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  cardTitle?: string;
}

@Component({
  selector: 'app-crypto-table',
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    CounterDirective,
    DecimalPipe,
    FormatLargeNumberPipe,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    ProgressBarModule,
    SkeletonModule,
    TableModule,
    TagModule,
    TooltipModule
  ],
  templateUrl: './crypto-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CryptoTableComponent {
  readonly dt = viewChild<Table>('dt');
  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly coins = input<Coin[]>([]);
  readonly isLoading = input(false);
  readonly config = input<CryptoTableConfig>({
    showWatchlistToggle: true,
    showRemoveAction: false,
    searchPlaceholder: 'Search coins...',
    emptyMessage: 'No coins found.',
    cardTitle: 'Cryptocurrency Prices'
  });
  readonly watchlistCoinIds = input<Set<string>>(new Set());
  readonly processingCoinId = input<string | null>(null);

  readonly toggleWatchlist = output<Coin>();
  readonly removeCoin = output<Coin>();

  readonly searchFilter = signal<string>('');
  readonly currentPage = signal<number>(0);
  readonly rowsPerPage = signal<number>(25);
  readonly sortField = signal<string>('');
  readonly sortOrder = signal<number>(0);

  private readonly coinDataService = inject(CoinDataService);
  private readonly router = inject(Router);

  protected readonly SKELETON_ROWS = Array.from({ length: 10 }, (_, i) => i);

  readonly sortedCoins = computed(() => {
    const coins = this.coins();
    const sortField = this.sortField();
    const sortOrder = this.sortOrder();

    if (sortField && sortOrder !== 0) {
      return this.applySorting([...coins], sortField, sortOrder);
    }

    return coins;
  });

  readonly coinIds = computed(() => {
    const sortedCoins = this.sortedCoins();
    const page = this.currentPage();
    const rows = this.rowsPerPage();

    const startIndex = page * rows;
    const endIndex = startIndex + rows;

    const visibleCoins = sortedCoins.slice(startIndex, endIndex);
    return visibleCoins
      .filter((coin) => coin.slug)
      .map((coin) => coin.slug)
      .join(',');
  });

  readonly priceQuery = this.coinDataService.usePrices(this.coinIds);

  readonly pricesMap = computed(() => {
    const query = this.priceQuery;
    const priceData = query?.data();

    if (!priceData || typeof priceData !== 'object' || Array.isArray(priceData)) {
      return new Map<string, number>();
    }

    const pricesMap = new Map<string, number>();
    const typedPriceData = priceData as Record<string, { usd?: number }>;

    Object.entries(typedPriceData).forEach(([coinId, data]) => {
      if (data.usd != null) {
        pricesMap.set(coinId, data.usd);
      }
    });

    return pricesMap;
  });

  private readonly coinsBySlug = computed(() => {
    const map = new Map<string, Coin>();
    for (const coin of this.coins()) {
      if (coin.slug) map.set(coin.slug, coin);
    }
    return map;
  });

  readonly getCoinPrice = computed(() => {
    const pricesMap = this.pricesMap();
    const coinsBySlug = this.coinsBySlug();

    return (coinSlug: string) => {
      const priceFromService = Number(pricesMap.get(coinSlug));
      if (priceFromService > 0) {
        return priceFromService;
      }

      const coin = coinsBySlug.get(coinSlug);
      if (coin?.currentPrice && Number(coin.currentPrice) > 0) {
        return +coin.currentPrice;
      }

      return 0;
    };
  });

  readonly isLoadingPrices = computed(() => {
    const query = this.priceQuery;
    const pricesMap = this.pricesMap();
    const isQueryPending = query?.isPending() || false;
    const coinsBySlug = this.coinsBySlug();

    return (coinSlug?: string) => {
      if (!coinSlug) return false;

      const coin = coinsBySlug.get(coinSlug);

      const hasCurrentPrice = coin?.currentPrice && Number(coin.currentPrice) > 0;
      const servicePrice = pricesMap.get(coinSlug);
      const hasServicePrice = servicePrice !== undefined && servicePrice > 0;

      return isQueryPending && !hasCurrentPrice && !hasServicePrice;
    };
  });

  private applySorting(coins: Coin[], field: string, order: number): Coin[] {
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
        const aValue = this.getNumericValue(a, field);
        const bValue = this.getNumericValue(b, field);

        if (aValue === null && bValue === null) return 0;
        if (aValue === null) return 1;
        if (bValue === null) return -1;

        const result = aValue - bValue;
        return order === 1 ? result : -result;
      } else {
        const aValue = this.getStringValue(a, field);
        const bValue = this.getStringValue(b, field);

        const result = aValue.localeCompare(bValue);
        return order === 1 ? result : -result;
      }
    });
  }

  customSort = (event: { field: string; order: number }) => {
    const { field, order } = event;
    this.sortField.set(field);
    this.sortOrder.set(order);
  };

  private getNumericValue(coin: Coin, field: string): number | null {
    const value = coin[field as keyof Coin];

    if (value === null || value === undefined) {
      return null;
    }

    const numValue = Number(value);
    return isNaN(numValue) ? null : numValue;
  }

  private getStringValue(coin: Coin, field: string): string {
    const value = coin[field as keyof Coin];
    return value ? String(value).toLowerCase() : '';
  }

  applyGlobalFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    const safeFilterValue = filterValue?.trim() ?? '';
    this.searchFilter.set(safeFilterValue);
    this.dt()?.filterGlobal(safeFilterValue, 'contains');
  }

  clearSearch(): void {
    this.searchFilter.set('');
    this.dt()?.filterGlobal('', 'contains');
    const input = this.searchInput()?.nativeElement;
    if (input) {
      input.value = '';
    }
  }

  isInWatchlist(coinId: string): boolean {
    return this.watchlistCoinIds().has(coinId);
  }

  isCoinProcessing(coinId: string): boolean {
    return this.processingCoinId() === coinId;
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

  onRowClick(coin: Coin): void {
    if (coin.slug) {
      this.router.navigate(['/app/coins', coin.slug]);
    }
  }

  getTag(change: number | undefined): 'success' | 'danger' {
    if (change === undefined) return 'success';
    return +change >= 0 ? 'success' : 'danger';
  }

  abs(value: number | undefined): number {
    return value != null ? Math.abs(value) : 0;
  }
}
