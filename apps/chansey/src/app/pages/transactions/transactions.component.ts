import { CommonModule } from '@angular/common';
import { Component, OnInit, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { OrderSide, OrderStatus, OrderType, Transaction, TransactionsService } from './transactions.service';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    CommonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    MultiSelectModule,
    ProgressSpinnerModule,
    ReactiveFormsModule,
    RouterModule,
    SelectModule,
    SkeletonModule,
    TableModule,
    TagModule
  ],
  templateUrl: './transactions.component.html'
})
export class TransactionsComponent implements OnInit {
  @ViewChild('dt') dt!: Table;

  // Services
  private readonly transactionsService = inject(TransactionsService);
  private readonly fb = inject(FormBuilder);

  // State signals
  transactions = signal<Transaction[]>([]);
  loading = signal<boolean>(true);
  searchText = signal<string>('');
  filterForm: FormGroup;

  // Enum references for the template
  orderSideEnum = OrderSide;
  orderStatusEnum = OrderStatus;
  orderTypeEnum = OrderType;

  // Filter options
  statusOptions = Object.values(OrderStatus).map((status) => ({ label: status, value: status }));
  sideOptions = Object.values(OrderSide).map((side) => ({ label: side, value: side }));
  typeOptions = Object.values(OrderType).map((type) => ({ label: type.replace(/_/g, ' '), value: type }));

  // TanStack Query hooks
  transactionsQuery = this.transactionsService.useTransactions();

  // Computed states
  isLoading = computed(() => this.transactionsQuery.isPending() || this.transactionsQuery.isFetching());
  transactionsData = computed(() => this.transactionsQuery.data() || []);
  transactionsError = computed(() => this.transactionsQuery.error);

  constructor() {
    // Initialize filter form
    this.filterForm = this.fb.group({
      statuses: [[]],
      sides: [[]],
      types: [[]]
    });

    // Set up an effect to update transactions when query data changes
    effect(() => {
      const data = this.transactionsData();
      if (data && Array.isArray(data)) {
        this.transactions.set(data);
        this.loading.set(false);
      }
    });
  }

  ngOnInit(): void {
    // Initial data load
    this.loadInitialData();
  }

  private loadInitialData(): void {
    this.loading.set(true);
    this.transactionsQuery.refetch();
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

  // Apply filters to the table
  applyFilters(): void {
    const filters = this.filterForm.value;

    type FilterValue = string | { value: string };
    const statuses = filters.statuses.map((s: FilterValue) => (typeof s === 'object' && 'value' in s ? s.value : s));
    const sides = filters.sides.map((s: FilterValue) => (typeof s === 'object' && 'value' in s ? s.value : s));
    const types = filters.types.map((t: FilterValue) => (typeof t === 'object' && 'value' in t ? t.value : t));

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
      types: []
    });
    this.dt.clear();
  }
}
