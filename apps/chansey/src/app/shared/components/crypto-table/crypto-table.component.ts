import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, inject, Input, Output, signal, ViewChild } from '@angular/core';
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

  @Input() coins: Coin[] = [];
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

  searchFilter = signal<string>('');
  messageService = inject(MessageService);

  /**
   * Custom sort function to handle numeric fields properly
   * This prevents PrimeNG from sorting by formatted display values
   */
  customSort = (event: { field: string; order: number }) => {
    const { field, order } = event;

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

    if (numericFields.includes(field)) {
      this.coins.sort((a: Coin, b: Coin) => {
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
      });
    } else {
      // For non-numeric fields, use default string sorting
      this.coins.sort((a: Coin, b: Coin) => {
        const aValue = this.getStringValue(a, field);
        const bValue = this.getStringValue(b, field);

        const result = aValue.localeCompare(bValue);
        return order === 1 ? result : -result;
      });
    }
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

  getTag(change: number | undefined): string {
    if (change === undefined) return 'success';
    return +change >= 0 ? 'success' : 'danger';
  }
}
