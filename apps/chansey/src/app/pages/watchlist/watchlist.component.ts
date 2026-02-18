
import { Component, computed, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { Coin } from '@chansey/api-interfaces';

import { CryptoTableComponent, CryptoTableConfig } from '../../shared/components/crypto-table/crypto-table.component';
import { PriceService } from '../prices/prices.service';

@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [CryptoTableComponent, RouterModule, ToastModule],
  providers: [MessageService],
  templateUrl: './watchlist.component.html'
})
export class WatchlistComponent {
  processingCoinId = signal<string | null>(null);
  priceService = inject(PriceService);
  messageService = inject(MessageService);

  // Watchlist data - this is the main difference from prices component
  watchlistQuery = this.priceService.useWatchlist();
  removeFromWatchlistMutation = this.priceService.useRemoveFromWatchlist();

  isLoading = computed(() => this.watchlistQuery.isPending());

  // Extract coins from watchlist items for display
  watchlistCoins = computed(() => {
    const watchlistItems = this.watchlistQuery.data() || [];
    return watchlistItems.map((item) => item.coin);
  });

  // Configuration for the crypto table
  tableConfig: CryptoTableConfig = {
    showWatchlistToggle: false,
    showRemoveAction: true,
    searchPlaceholder: 'Search watchlist...',
    emptyMessage: 'Your watchlist is empty. Add coins from the prices page.',
    cardTitle: 'My Watchlist'
  };

  onRemoveCoin(coin: Coin): void {
    this.removeFromWatchlist(coin);
  }

  private removeFromWatchlist(coin: Coin): void {
    // Find the portfolio item to get its ID for deletion
    const watchlistItems = this.watchlistQuery.data() || [];
    const portfolioItem = watchlistItems.find((item) => item.coin.id === coin.id);

    if (!portfolioItem) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Coin not found in watchlist'
      });
      return;
    }

    this.processingCoinId.set(coin.id);

    this.removeFromWatchlistMutation.mutate(portfolioItem.id, {
      onSuccess: () => {
        this.processingCoinId.set(null);
        this.messageService.add({
          severity: 'success',
          summary: 'Removed from Watchlist',
          detail: `${coin.name} has been removed from your watchlist`
        });
      },
      onError: (error) => {
        this.processingCoinId.set(null);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: error.message || 'Failed to remove coin from watchlist'
        });
      }
    });
  }
}
