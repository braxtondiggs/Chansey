import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DatePickerModule } from 'primeng/datepicker';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TabsModule } from 'primeng/tabs';
import { ToastModule } from 'primeng/toast';

import {
  BacktestFiltersDto,
  BacktestOverviewDto,
  BacktestStatus,
  BacktestType,
  ExportFormat,
  PaginatedBacktestListDto,
  SignalAnalyticsDto,
  TradeAnalyticsDto
} from '@chansey/api-interfaces';

import { BacktestMonitoringService } from './backtest-monitoring.service';
import { BacktestsTableComponent } from './components/backtests-table/backtests-table.component';
import { ExportPanelComponent } from './components/export-panel/export-panel.component';
import { OverviewCardsComponent } from './components/overview-cards/overview-cards.component';
import { SignalQualityPanelComponent } from './components/signal-quality-panel/signal-quality-panel.component';
import { TopAlgorithmsComponent } from './components/top-algorithms/top-algorithms.component';
import { TradeAnalyticsPanelComponent } from './components/trade-analytics-panel/trade-analytics-panel.component';

@Component({
  selector: 'app-backtest-monitoring',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    DatePickerModule,
    ProgressSpinnerModule,
    SelectModule,
    TabsModule,
    ToastModule,
    OverviewCardsComponent,
    BacktestsTableComponent,
    TopAlgorithmsComponent,
    SignalQualityPanelComponent,
    TradeAnalyticsPanelComponent,
    ExportPanelComponent
  ],
  providers: [MessageService],
  template: `
    <div class="backtest-monitoring-page">
      <p-toast />

      <!-- Header -->
      <div class="page-header mb-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="m-0 text-2xl font-bold">Backtest Monitoring</h1>
            <p class="mt-1 text-gray-500">Analytics and performance metrics for backtests</p>
          </div>

          <!-- Filters -->
          <div class="flex flex-wrap items-center gap-3">
            <p-datepicker
              [(ngModel)]="dateRange"
              selectionMode="range"
              [readonlyInput]="true"
              placeholder="Date Range"
              dateFormat="yy-mm-dd"
              [showIcon]="true"
              (onSelect)="onDateRangeChange()"
            />

            <p-select
              [(ngModel)]="selectedStatus"
              [options]="statusOptions"
              placeholder="All Statuses"
              [showClear]="true"
              (onChange)="onFilterChange()"
            />

            <p-select
              [(ngModel)]="selectedType"
              [options]="typeOptions"
              placeholder="All Types"
              [showClear]="true"
              (onChange)="onFilterChange()"
            />

            <p-button
              icon="pi pi-refresh"
              [rounded]="true"
              [text]="true"
              severity="secondary"
              (onClick)="refresh()"
              pTooltip="Refresh data"
            />
          </div>
        </div>
      </div>

      @if (isLoading()) {
        <div class="flex items-center justify-center py-8">
          <p-progress-spinner strokeWidth="4" />
        </div>
      } @else {
        <!-- Overview Cards -->
        <app-overview-cards [overview]="overview()" class="mb-4" />

        <!-- Tabs -->
        <p-tabs [(value)]="activeTab">
          <p-tablist>
            <p-tab value="overview">Overview</p-tab>
            <p-tab value="signals">Signal Quality</p-tab>
            <p-tab value="trades">Trade Analytics</p-tab>
            <p-tab value="export">Export</p-tab>
          </p-tablist>
          <p-tabpanels>
            <p-tabpanel value="overview">
              <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <app-top-algorithms [algorithms]="overview()?.topAlgorithms || []" />
                <app-backtests-table [backtests]="backtests()" (pageChange)="onPageChange($event)" />
              </div>
            </p-tabpanel>
            <p-tabpanel value="signals">
              @if (signalAnalyticsQuery.isPending()) {
                <div class="flex items-center justify-center py-8">
                  <p-progress-spinner strokeWidth="4" />
                </div>
              } @else {
                <app-signal-quality-panel [analytics]="signalAnalytics()" />
              }
            </p-tabpanel>
            <p-tabpanel value="trades">
              @if (tradeAnalyticsQuery.isPending()) {
                <div class="flex items-center justify-center py-8">
                  <p-progress-spinner strokeWidth="4" />
                </div>
              } @else {
                <app-trade-analytics-panel [analytics]="tradeAnalytics()" />
              }
            </p-tabpanel>
            <p-tabpanel value="export">
              <app-export-panel [filters]="currentFilters()" (exportRequest)="onExport($event)" />
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      }
    </div>
  `,
  styles: `
    .backtest-monitoring-page {
      padding: 1.5rem;
    }
  `
})
export class BacktestMonitoringComponent {
  private monitoringService = inject(BacktestMonitoringService);
  private messageService = inject(MessageService);

  // Filter state
  dateRange: Date[] | null = null;
  selectedStatus: BacktestStatus | null = null;
  selectedType: BacktestType | null = null;
  activeTab = 'overview';

  // Filter options
  statusOptions = Object.values(BacktestStatus).map((status) => ({
    label: this.formatStatus(status),
    value: status
  }));

  typeOptions = Object.values(BacktestType).map((type) => ({
    label: this.formatType(type),
    value: type
  }));

  // Filters signal for queries
  filtersSignal = signal<BacktestFiltersDto>({});
  currentPage = signal(1);

  // Computed filters
  currentFilters = computed(() => this.filtersSignal());

  // TanStack Query hooks
  overviewQuery = this.monitoringService.useOverview(this.filtersSignal);
  backtestsQuery = this.monitoringService.useBacktests(
    computed(() => ({
      ...this.filtersSignal(),
      page: this.currentPage(),
      limit: 10
    }))
  );
  signalAnalyticsQuery = this.monitoringService.useSignalAnalytics(this.filtersSignal);
  tradeAnalyticsQuery = this.monitoringService.useTradeAnalytics(this.filtersSignal);

  // Computed data
  isLoading = computed(
    () =>
      this.overviewQuery.isPending() ||
      (this.activeTab === 'signals' && this.signalAnalyticsQuery.isPending()) ||
      (this.activeTab === 'trades' && this.tradeAnalyticsQuery.isPending())
  );

  overview = computed(() => this.overviewQuery.data() as BacktestOverviewDto | undefined);
  backtests = computed(() => this.backtestsQuery.data() as PaginatedBacktestListDto | undefined);
  signalAnalytics = computed(() => this.signalAnalyticsQuery.data() as SignalAnalyticsDto | undefined);
  tradeAnalytics = computed(() => this.tradeAnalyticsQuery.data() as TradeAnalyticsDto | undefined);

  onDateRangeChange(): void {
    this.updateFilters();
  }

  onFilterChange(): void {
    this.updateFilters();
  }

  private updateFilters(): void {
    const filters: BacktestFiltersDto = {};

    if (this.dateRange && this.dateRange.length === 2) {
      if (this.dateRange[0]) {
        filters.startDate = this.dateRange[0].toISOString();
      }
      if (this.dateRange[1]) {
        filters.endDate = this.dateRange[1].toISOString();
      }
    }

    if (this.selectedStatus) {
      filters.status = this.selectedStatus;
    }

    if (this.selectedType) {
      filters.type = this.selectedType;
    }

    this.filtersSignal.set(filters);
    this.currentPage.set(1);
  }

  onPageChange(page: number): void {
    this.currentPage.set(page);
  }

  refresh(): void {
    this.overviewQuery.refetch();
    this.backtestsQuery.refetch();

    if (this.activeTab === 'signals') {
      this.signalAnalyticsQuery.refetch();
    }

    if (this.activeTab === 'trades') {
      this.tradeAnalyticsQuery.refetch();
    }

    this.messageService.add({
      severity: 'info',
      summary: 'Refreshing',
      detail: 'Data is being refreshed',
      life: 2000
    });
  }

  async onExport(event: {
    type: 'backtests' | 'signals' | 'trades';
    format: ExportFormat;
    backtestId?: string;
  }): Promise<void> {
    try {
      await this.monitoringService.downloadExport(event.type, event.format, event.backtestId, this.currentFilters());

      this.messageService.add({
        severity: 'success',
        summary: 'Export Complete',
        detail: `${event.type} exported successfully`
      });
    } catch (error: unknown) {
      this.messageService.add({
        severity: 'error',
        summary: 'Export Failed',
        detail: error instanceof Error ? error.message : 'Failed to export data'
      });
    }
  }

  private formatStatus(status: BacktestStatus): string {
    return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
  }

  private formatType(type: BacktestType): string {
    return type
      .split('_')
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ');
  }
}
