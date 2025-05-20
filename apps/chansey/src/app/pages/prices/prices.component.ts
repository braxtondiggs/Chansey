import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';

import { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';

import { Coin } from '@chansey/api-interfaces';

import { FormatCurrencyPipe } from '../../components/format-currency.pipe';
import { FormatPercentPipe } from '../../components/format-percent.pipe';
import { CoinService } from '../../services';

@Component({
  selector: 'app-prices',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    CardModule,
    TabsModule,
    TableModule,
    TooltipModule,
    FormatCurrencyPipe,
    FormatPercentPipe
  ],
  templateUrl: './prices.component.html'
})
export class PricesComponent implements OnInit {
  activeTabIndex: number = 0;
  tabs: MenuItem[] = [];
  coinService = inject(CoinService);

  // Coin data
  coinsQuery = this.coinService.useCoins();
  watchlistQuery = this.coinService.useWatchlist();

  ngOnInit(): void {
    this.tabs = [
      { label: 'All Coins', icon: 'pi pi-fw pi-money-bill' },
      { label: 'Watchlist', icon: 'pi pi-fw pi-star' }
    ];
  }

  getTabContent() {
    return this.activeTabIndex === 0 ? this.coinsQuery.data() : this.watchlistQuery.data();
  }

  isLoading() {
    return this.activeTabIndex === 0 ? this.coinsQuery.isPending() : this.watchlistQuery.isPending();
  }

  onTabChange(event: any) {
    this.activeTabIndex = event.index;
  }

  getChangeColorClass(change: number | undefined): string {
    if (change === undefined) return '';
    return change >= 0 ? 'text-green-500' : 'text-red-500';
  }

  getChangeIcon(change: number | undefined): string {
    if (change === undefined) return '';
    return change >= 0 ? 'pi pi-arrow-up' : 'pi pi-arrow-down';
  }
}
