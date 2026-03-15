import { DatePipe, DecimalPipe, NgClass, UpperCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ViewChild,
  ViewEncapsulation,
  computed,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DatePickerModule } from 'primeng/datepicker';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { EMPTY } from 'rxjs';

import { Order, OrderSide, OrderStatus, OrderType } from '@chansey/api-interfaces';

import { TransactionsService } from './transactions.service';

import { formatType, isUsdQuote } from '../../shared/utils/order-format.util';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    DatePipe,
    DatePickerModule,
    DecimalPipe,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    MultiSelectModule,
    NgClass,
    ReactiveFormsModule,
    RouterModule,
    SelectModule,
    SkeletonModule,
    TableModule,
    TagModule,
    UpperCasePipe
  ],
  templateUrl: './transactions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: `
    app-transactions td .p-avatar-image {
      background: var(--p-datatable-row-background);
    }
    app-transactions .p-datatable-striped .p-datatable-tbody > tr:nth-child(even) td .p-avatar-image {
      background: var(--p-datatable-row-striped-background);
    }
  `
})
export class TransactionsComponent {
  @ViewChild('dt') dt!: Table;

  // Services
  private readonly transactionsService = inject(TransactionsService);
  private readonly fb = inject(FormBuilder);

  // State signals
  searchText = signal<string>('');

  filterForm = this.fb.group({
    statuses: [[] as OrderStatus[]],
    sides: [[] as OrderSide[]],
    types: [[] as OrderType[]],
    dateRange: new FormControl<Date[] | null>(null)
  });

  // Enum references for the template
  orderSideEnum = OrderSide;
  orderStatusEnum = OrderStatus;
  orderTypeEnum = OrderType;

  // Filter options
  statusOptions = Object.values(OrderStatus).map((status) => ({ label: status, value: status }));
  sideOptions = Object.values(OrderSide).map((side) => ({ label: side, value: side }));
  typeOptions = Object.values(OrderType).map((type) => ({
    label: formatType(type),
    value: type
  }));

  // TanStack Query hooks
  transactionsQuery = this.transactionsService.useTransactions();

  // Computed states
  isLoading = computed(() => this.transactionsQuery.isPending() || this.transactionsQuery.isFetching());
  private allTransactions = computed(() => this.transactionsQuery.data() ?? []);

  private dateRangeValue = toSignal(this.filterForm.get('dateRange')?.valueChanges ?? EMPTY, { initialValue: null });
  hasDateFilter = computed(() => {
    const dr = this.dateRangeValue();
    return !!(dr && dr[0] && dr[1]);
  });

  transactions = computed(() => {
    const data = this.allTransactions();
    const dr = this.dateRangeValue();
    if (dr && dr[0] && dr[1]) {
      const start = dr[0];
      const end = new Date(dr[1].getTime());
      end.setHours(23, 59, 59, 999);
      return data.filter((t) => {
        const d = new Date(t.transactTime);
        return d >= start && d <= end;
      });
    }
    return data;
  });

  tableData = computed(() => {
    const data = this.transactions();
    return this.isLoading() && data.length === 0 ? new Array(8).fill(null) : data;
  });

  // Mobile filter toggle
  filtersVisible = signal(false);
  activeFilterCount = computed(() => {
    let count = 0;
    if (this.searchText().length > 0) count++;
    if (this.hasDateFilter()) count++;
    const f = this.filterForm.value;
    if (f.statuses?.length) count++;
    if (f.sides?.length) count++;
    if (f.types?.length) count++;
    return count;
  });

  toggleFilters(): void {
    this.filtersVisible.update((v) => !v);
  }

  // Filter transactions based on global filter
  applyGlobalFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchText.set(filterValue);
    this.dt?.filterGlobal(filterValue, 'contains');
  }

  // Clear only search text filter
  clearSearchFilter(): void {
    this.searchText.set('');
    this.dt?.filterGlobal('', 'contains');
  }

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

  isUsdQuote = isUsdQuote;
  formatType = formatType;

  getFeePercentage(transaction: Order): number | null {
    const fee = transaction.fee;
    const cost = transaction.cost;
    if (fee != null && fee > 0 && cost != null && cost > 0) {
      return (fee / cost) * 100;
    }
    return null;
  }

  // Apply filters to the table
  applyFilters(): void {
    const filters = this.filterForm.value;

    type FilterValue = string | { value: string };
    const statuses = (filters.statuses ?? []).map((s: FilterValue) =>
      typeof s === 'object' && 'value' in s ? s.value : s
    );
    const sides = (filters.sides ?? []).map((s: FilterValue) => (typeof s === 'object' && 'value' in s ? s.value : s));
    const types = (filters.types ?? []).map((t: FilterValue) => (typeof t === 'object' && 'value' in t ? t.value : t));

    // Apply status filter
    if (statuses.length) {
      this.dt.filter(statuses, 'status', 'in');
    } else {
      this.dt.filter(null, 'status', 'in');
    }

    // Apply side filter
    if (sides.length) {
      this.dt.filter(sides, 'side', 'in');
    } else {
      this.dt.filter(null, 'side', 'in');
    }

    // Apply type filter
    if (types.length) {
      this.dt.filter(types, 'type', 'in');
    } else {
      this.dt.filter(null, 'type', 'in');
    }
  }

  // Reset all filters
  clearFilters(): void {
    this.filterForm.reset({
      statuses: [],
      sides: [],
      types: [],
      dateRange: null
    });
    this.dt.clear();
  }
}
