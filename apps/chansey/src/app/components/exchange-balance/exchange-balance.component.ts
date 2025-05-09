import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, OnDestroy, inject, signal } from '@angular/core';

import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { Subscription } from 'rxjs';

import { ExchangeKey } from '@chansey/api-interfaces';

import { ExchangeBalanceService } from './exchange-balance.service';

@Component({
  selector: 'app-exchange-balance',
  standalone: true,
  imports: [CommonModule, CardModule, ProgressSpinnerModule, TagModule],
  templateUrl: './exchange-balance.component.html'
})
export class ExchangeBalanceComponent {
  @Input() exchange!: ExchangeKey;
  @Input() refreshInterval: number = 60000; // Default refresh every minute

  // Services
  private balanceService = inject(ExchangeBalanceService);
  readonly balanceQuery = this.balanceService.useExchangeBalance(this.exchange?.id);
  lastUpdated = signal<Date | null>(null);

  // Format number with appropriate decimal places based on asset type
  formatBalance(balance: number, asset: string): string {
    if (['BTC', 'ETH'].includes(asset)) {
      return balance.toFixed(6);
    } else {
      return balance.toFixed(2);
    }
  }
}
