import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterModule } from '@angular/router';

import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { OrderSide, OrderStatus } from '@chansey/api-interfaces';

import { TransactionsService } from '../../../pages/transactions/transactions.service';

@Component({
  selector: 'app-recent-transactions',
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    RouterModule,
    SkeletonModule,
    TableModule,
    TagModule
  ],
  templateUrl: './recent-transactions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RecentTransactionsComponent {
  readonly limit = input(10);

  // Services
  private readonly transactionsService = inject(TransactionsService);

  // TanStack Query hooks
  transactionsQuery = this.transactionsService.useTransactions();

  // Computed properties
  transactions = computed(() => this.transactionsQuery.data()?.slice(0, this.limit()) || []);
  skeletonRows = computed(() => Array.from({ length: Math.min(this.limit(), 4) }, (_, i) => i));

  // Helper method to get appropriate severity for order status
  getStatusSeverity(status: OrderStatus): 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast' {
    switch (status) {
      case OrderStatus.FILLED:
        return 'success';
      case OrderStatus.PARTIALLY_FILLED:
        return 'info';
      case OrderStatus.NEW:
        return 'warn';
      case OrderStatus.CANCELED:
      case OrderStatus.EXPIRED:
      case OrderStatus.REJECTED:
        return 'danger';
      case OrderStatus.PENDING_CANCEL:
        return 'warn';
      default:
        return 'info';
    }
  }

  // Helper method to get appropriate severity for order side
  getSideSeverity(side: OrderSide): 'success' | 'danger' {
    return side === OrderSide.BUY ? 'success' : 'danger';
  }
}
