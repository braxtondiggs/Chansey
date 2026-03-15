import { DatePipe, DecimalPipe, UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterModule } from '@angular/router';

import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { TransactionsService } from '../../../pages/transactions/transactions.service';
import { formatType, isUsdQuote } from '../../utils/order-format.util';
import { getSideSeverity, getStatusSeverity } from '../../utils/order-severity.util';
import { EmptyStateComponent } from '../empty-state/empty-state.component';

@Component({
  selector: 'app-recent-transactions',
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    DatePipe,
    DecimalPipe,
    EmptyStateComponent,
    RouterModule,
    SkeletonModule,
    TableModule,
    TagModule,
    UpperCasePipe
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

  getStatusSeverity = getStatusSeverity;
  getSideSeverity = getSideSeverity;

  isUsdQuote = isUsdQuote;
  formatType = formatType;
}
