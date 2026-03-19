import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { Coin, CoinSelectionType } from '@chansey/api-interfaces';

import { CryptoTableComponent, CryptoTableConfig } from '../../shared/components/crypto-table/crypto-table.component';
import { CoinDataService } from '../../shared/services/coin-data.service';

@Component({
  selector: 'app-prices',
  imports: [CryptoTableComponent, ToastModule],
  providers: [MessageService],
  templateUrl: './prices.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PricesComponent {
  readonly processingCoinId = signal<string | null>(null);
  private readonly coinDataService = inject(CoinDataService);
  private readonly messageService = inject(MessageService);

  readonly coinsQuery = this.coinDataService.useCoins();
  readonly watchedCoinsQuery = this.coinDataService.useWatchedCoins();
  readonly addToWatchedMutation = this.coinDataService.useAddToWatchedCoins();
  readonly removeFromWatchedMutation = this.coinDataService.useRemoveFromWatchedCoins();

  readonly isLoading = computed(() => this.coinsQuery.isPending());
  readonly coins = computed(() => this.coinsQuery.data() || []);

  readonly watchlistCoinIds = computed(() => {
    const watchedItems = this.watchedCoinsQuery.data() || [];
    return new Set(watchedItems.map((item) => item.coin.id));
  });

  readonly tableConfig: CryptoTableConfig = {
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
    this.addToWatchedMutation.mutate(
      { coinId: coin.id, type: CoinSelectionType.WATCHED },
      {
        onSuccess: () => {
          this.processingCoinId.set(null);
          this.messageService.add({
            severity: 'success',
            summary: 'Added to Watchlist',
            detail: `${coin.name} has been added to your watchlist`
          });
        },
        onError: (error: Error) => {
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
    const watchedData = this.watchedCoinsQuery.data() || [];
    const watchedItem = watchedData.find((item) => item.coin.id === coin.id);

    if (!watchedItem) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Coin not found in watchlist' });
      return;
    }

    this.processingCoinId.set(coin.id);
    this.removeFromWatchedMutation.mutate(watchedItem.id, {
      onSuccess: () => {
        this.processingCoinId.set(null);
        this.messageService.add({
          severity: 'success',
          summary: 'Removed from Watchlist',
          detail: `${coin.name} has been removed from your watchlist`
        });
      },
      onError: (error: Error) => {
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
