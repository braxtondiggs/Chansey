import { Component, computed, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { Coin, PortfolioType } from '@chansey/api-interfaces';

import { CryptoTableComponent, CryptoTableConfig } from '@chansey-web/app/shared/components';

import { PriceService } from './prices.service';

@Component({
  selector: 'app-prices',
  standalone: true,
  imports: [CryptoTableComponent, RouterModule, ToastModule],
  providers: [MessageService],
  templateUrl: './prices.component.html'
})
export class PricesComponent {
  processingCoinId = signal<string | null>(null);
  priceService = inject(PriceService);
  messageService = inject(MessageService);

  // Coin data and watchlist
  coinsQuery = this.priceService.useCoins();
  watchlistQuery = this.priceService.useWatchlist();
  addToWatchlistMutation = this.priceService.useAddToWatchlist();
  removeFromWatchlistMutation = this.priceService.useRemoveFromWatchlist();

  isLoading = computed(() => this.coinsQuery.isPending());
  coins = computed(() => this.coinsQuery.data() || []);

  // Create a set of watchlist coin IDs for quick lookup
  watchlistCoinIds = computed(() => {
    const watchlistItems = this.watchlistQuery.data() || [];
    return new Set(watchlistItems.map((item) => item.coin.id));
  });

  // Configuration for the crypto table
  tableConfig: CryptoTableConfig = {
    showWatchlistToggle: true,
    showRemoveAction: false,
    searchPlaceholder: 'Search coins...',
    emptyMessage: 'No coins available',
    cardTitle: 'Cryptocurrency Prices'
  };

  onToggleWatchlist(coin: Coin): void {
    const isInWatchlist = this.watchlistCoinIds().has(coin.id);
    if (isInWatchlist) {
      this.removeFromWatchlist(coin);
    } else {
      this.addToWatchlist(coin);
    }
  }

  private addToWatchlist(coin: Coin): void {
    this.processingCoinId.set(coin.id);
    this.addToWatchlistMutation.mutate(
      {
        coinId: coin.id,
        type: PortfolioType.MANUAL
      },
      {
        onSuccess: () => {
          this.processingCoinId.set(null);
          this.messageService.add({
            severity: 'success',
            summary: 'Added to Watchlist',
            detail: `${coin.name} has been added to your watchlist`
          });
        },
        onError: (error) => {
          this.processingCoinId.set(null);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error.message || 'Failed to add coin to watchlist'
          });
        }
      }
    );
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
