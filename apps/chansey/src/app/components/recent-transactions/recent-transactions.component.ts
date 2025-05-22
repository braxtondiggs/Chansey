import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { shapes } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import {
  OrderSide,
  OrderStatus,
  Transaction,
  TransactionsService
} from '../../pages/transactions/transactions.service';

@Component({
  selector: 'app-recent-transactions',
  standalone: true,
  imports: [AvatarModule, ButtonModule, CardModule, CommonModule, RouterModule, SkeletonModule, TableModule, TagModule],
  templateUrl: './recent-transactions.component.html'
})
export class RecentTransactionsComponent implements OnInit {
  @Input() limit = 10;

  // Services
  private readonly transactionsService = inject(TransactionsService);
  private readonly router = inject(Router);

  // TanStack Query hooks
  transactionsQuery = this.transactionsService.useTransactions();

  // State signals
  recentTransactions = signal<Transaction[]>([]);

  // Computed states
  isLoading = computed(() => this.transactionsQuery.isPending() || this.transactionsQuery.isFetching());
  transactions = computed(() => {
    const data = this.transactionsQuery.data() || [];
    // Sort by transaction time (newest first) and limit to the specified number
    return data
      .sort((a, b) => new Date(b.transactTime).getTime() - new Date(a.transactTime).getTime())
      .slice(0, this.limit);
  });

  ngOnInit(): void {
    // Initial data load if not already loaded
    if (!this.transactionsQuery.data()) {
      this.refreshData();
    }
  }

  refreshData(): void {
    this.transactionsQuery.refetch();
  }

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

  // Calculate total value (price * quantity)
  calculateTotalValue(price: number, quantity: number): number {
    return price * quantity;
  }

  getImage(slug: string): string {
    return createAvatar(shapes, {
      seed: slug,
      size: 64,
      radius: 64
    }).toDataUri();
  }
}
