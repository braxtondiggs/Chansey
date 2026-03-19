import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageModule } from 'primeng/message';
import { ToastModule } from 'primeng/toast';

import { Coin, CUSTOM_RISK_LEVEL, MIN_TRADING_COINS } from '@chansey/api-interfaces';

import { CryptoTableComponent, CryptoTableConfig } from '../../shared/components/crypto-table/crypto-table.component';
import { AuthService } from '../../shared/services/auth.service';
import { CoinDataService } from '../../shared/services/coin-data.service';
import { RisksService } from '../admin/risks/risks.service';
import { SettingsService } from '../user/settings/settings.service';

@Component({
  selector: 'app-trading-coins',
  imports: [ButtonModule, ConfirmDialogModule, CryptoTableComponent, MessageModule, RouterLink, ToastModule],
  providers: [ConfirmationService, MessageService],
  templateUrl: './trading-coins.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TradingCoinsComponent {
  readonly processingCoinId = signal<string | null>(null);
  private readonly coinDataService = inject(CoinDataService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly authService = inject(AuthService);
  private readonly risksService = inject(RisksService);
  private readonly settingsService = inject(SettingsService);

  readonly userQuery = this.authService.useUser();
  readonly risksQuery = this.risksService.useRisks();
  readonly updateProfileMutation = this.settingsService.useUpdateProfileMutation();

  // Trading coins (MANUAL type) for custom users
  readonly tradingCoinsQuery = this.coinDataService.useTradingCoins();
  readonly removeFromTradingMutation = this.coinDataService.useRemoveFromTradingCoins();

  // Auto-selected coins for auto users
  readonly autoSelectedCoinsQuery = this.coinDataService.useAutoSelectedCoins();

  readonly isCustomCoinSelection = computed(() => {
    const user = this.userQuery.data();
    return user?.coinRisk?.level === CUSTOM_RISK_LEVEL;
  });

  readonly userRiskLevel = computed(() => this.userQuery.data()?.coinRisk?.level ?? null);

  /** Level 3 (Moderate) risk for auto-demote fallback */
  readonly level3Risk = computed(() => this.risksQuery.data()?.find((r) => r.level === 3) ?? null);

  /** True until we know the user's mode AND the relevant coin query has resolved */
  readonly isLoading = computed(() => {
    if (this.userQuery.isPending()) return true;
    return this.isCustomCoinSelection() ? this.tradingCoinsQuery.isPending() : this.autoSelectedCoinsQuery.isPending();
  });

  readonly tradingCoins = computed(() => {
    if (this.userQuery.isPending()) return [];
    if (this.isCustomCoinSelection()) {
      return (this.tradingCoinsQuery.data() || []).map((item) => item.coin);
    }
    return (this.autoSelectedCoinsQuery.data() || []).map((item) => item.coin);
  });

  readonly tradingCoinCount = computed(() =>
    this.isCustomCoinSelection() ? (this.tradingCoinsQuery.data() ?? []).length : 0
  );

  readonly showInsufficientCoinsWarning = computed(
    () => this.isCustomCoinSelection() && this.tradingCoinCount() < MIN_TRADING_COINS
  );

  readonly coinsNeeded = computed(() => Math.max(0, MIN_TRADING_COINS - this.tradingCoinCount()));

  readonly MIN_TRADING_COINS = MIN_TRADING_COINS;

  readonly customTableConfig: CryptoTableConfig = {
    showWatchlistToggle: false,
    showRemoveAction: true,
    removeTooltip: 'Remove from trading coins',
    searchPlaceholder: 'Search trading coins...',
    emptyMessage: 'No trading coins selected. Add coins to start trading.',
    emptyActionLink: '/app/prices',
    emptyActionLabel: 'Browse Coins',
    cardTitle: 'My Trading Coins'
  };

  readonly autoTableConfig: CryptoTableConfig = {
    showWatchlistToggle: false,
    showRemoveAction: false,
    searchPlaceholder: 'Search trading coins...',
    emptyMessage: 'No coins auto-selected yet. Check your risk level in Settings.',
    emptyActionLink: '/app/settings',
    emptyActionLabel: 'Go to Settings',
    cardTitle: 'My Trading Coins'
  };

  onRemoveCoin(coin: Coin): void {
    const tradingData = this.tradingCoinsQuery.data() || [];
    const selectionItem = tradingData.find((item) => item.coin.id === coin.id);

    if (!selectionItem) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Coin not found in trading coins' });
      return;
    }

    if (this.tradingCoinCount() <= MIN_TRADING_COINS) {
      const remainingAfterRemoval = this.tradingCoinCount() - 1;
      this.confirmationService.confirm({
        message:
          remainingAfterRemoval < MIN_TRADING_COINS
            ? `Removing ${coin.name} will leave you with ${remainingAfterRemoval} coin(s). Custom coin selection requires at least ${MIN_TRADING_COINS} coins, so you'll be switched back to auto mode (Moderate).`
            : `Are you sure you want to remove ${coin.name} from your trading coins?`,
        header: `Remove ${coin.name}?`,
        icon: 'pi pi-exclamation-triangle',
        acceptButtonStyleClass: 'p-button-danger',
        rejectButtonStyleClass: 'p-button-secondary',
        accept: () => {
          if (remainingAfterRemoval < MIN_TRADING_COINS) {
            this.performRemovalWithDemote(coin, selectionItem.id);
          } else {
            this.performRemoval(coin, selectionItem.id);
          }
        }
      });
    } else {
      this.performRemoval(coin, selectionItem.id);
    }
  }

  private performRemoval(coin: Coin, selectionId: string): void {
    this.processingCoinId.set(coin.id);
    this.removeFromTradingMutation.mutate(selectionId, {
      onSuccess: () => {
        this.processingCoinId.set(null);
        this.messageService.add({
          severity: 'success',
          summary: 'Removed from Trading Coins',
          detail: `${coin.name} has been removed from your trading coins`
        });
      },
      onError: (error: Error) => {
        this.processingCoinId.set(null);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: error.message || 'Failed to remove coin from trading coins'
        });
      }
    });
  }

  /**
   * Remove coin AND switch user back to auto mode (level 3 - Moderate)
   * Used when removing would drop trading coins below MIN_TRADING_COINS
   */
  private performRemovalWithDemote(coin: Coin, selectionId: string): void {
    const level3 = this.level3Risk();
    if (!level3) {
      this.performRemoval(coin, selectionId);
      return;
    }

    this.processingCoinId.set(coin.id);

    this.removeFromTradingMutation.mutate(selectionId, {
      onSuccess: () => {
        this.updateProfileMutation.mutate(
          { coinRisk: level3.id },
          {
            onSuccess: () => {
              this.processingCoinId.set(null);
              this.messageService.add({
                severity: 'info',
                summary: 'Switched to Auto Mode',
                detail: `${coin.name} removed. You've been switched to auto coin selection (Moderate).`
              });
            },
            onError: () => {
              this.processingCoinId.set(null);
              this.messageService.add({
                severity: 'warn',
                summary: 'Coin Removed',
                detail: `${coin.name} removed, but couldn't switch modes. Please check settings.`
              });
            }
          }
        );
      },
      onError: (error: Error) => {
        this.processingCoinId.set(null);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: error.message || 'Failed to remove coin'
        });
      }
    });
  }
}
