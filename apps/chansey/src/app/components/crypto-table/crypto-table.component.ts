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

import { FormatLargeNumberPipe } from '@chansey-web/app/components/format-large-number.pipe';

import { CounterDirective } from '../../shared/directives';

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
