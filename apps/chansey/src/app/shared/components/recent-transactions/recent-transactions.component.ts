import { CommonModule } from '@angular/common';
import { Component, Input, computed, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { OrderSide, OrderStatus, TransactionsService } from '@chansey-web/app/pages/transactions/transactions.service';

@Component({
  selector: 'app-recent-transactions',
  standalone: true,
  imports: [AvatarModule, ButtonModule, CardModule, CommonModule, RouterModule, SkeletonModule, TableModule, TagModule],
  templateUrl: './recent-transactions.component.html'
})
export class RecentTransactionsComponent {
  @Input() limit = 10;

  // Services
  private readonly transactionsService = inject(TransactionsService);
  private readonly router = inject(Router);

  // TanStack Query hooks
  transactionsQuery = this.transactionsService.useTransactions();

  // Computed properties
  transactions = computed(() => this.transactionsQuery.data()?.slice(0, this.limit) || []);

  viewAllTransactions(): void {
    this.router.navigate(['/app/transactions']);
  }

  // Helper method to get appropriate severity for order status
  getStatusSeverity(status: OrderStatus): 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast' | 'info' {
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
  getSideSeverity(side: OrderSide): 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast' | 'info' {
    return side === OrderSide.BUY ? 'success' : 'danger';
  }
}
