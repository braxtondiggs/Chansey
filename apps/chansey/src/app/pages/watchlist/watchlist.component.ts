import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { Coin } from '@chansey/api-interfaces';

import { CryptoTableComponent, CryptoTableConfig } from '../../shared/components/crypto-table/crypto-table.component';
import { CoinDataService } from '../../shared/services/coin-data.service';

@Component({
  selector: 'app-watchlist',
  imports: [CryptoTableComponent, ToastModule],
  providers: [MessageService],
  templateUrl: './watchlist.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WatchlistComponent {
  readonly processingCoinId = signal<string | null>(null);
  private readonly coinDataService = inject(CoinDataService);
  private readonly messageService = inject(MessageService);

  readonly watchlistQuery = this.coinDataService.useWatchlist();
  readonly removeFromWatchlistMutation = this.coinDataService.useRemoveFromWatchlist();

  readonly isLoading = computed(() => this.watchlistQuery.isPending());

  readonly watchlistCoins = computed(() => {
    const watchlistItems = this.watchlistQuery.data() || [];
    return watchlistItems.map((item) => item.coin);
  });

  readonly tableConfig: CryptoTableConfig = {
    showWatchlistToggle: false,
    showRemoveAction: true,
    searchPlaceholder: 'Search watchlist...',
    emptyMessage: 'Your watchlist is empty. Add coins from the prices page.',
    cardTitle: 'My Watchlist'
  };

  onRemoveCoin(coin: Coin): void {
    const watchlistData = this.watchlistQuery.data() || [];
    const portfolioItem = watchlistData.find((item) => item.coin.id === coin.id);

    if (!portfolioItem) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Coin not found in watchlist' });
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
