import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DatePickerModule } from 'primeng/datepicker';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TabsModule } from 'primeng/tabs';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';

import { AlertsPanelComponent } from './components/alerts-panel/alerts-panel.component';
import { AlgorithmSelectorComponent } from './components/algorithm-selector/algorithm-selector.component';
import { BacktestComparisonPanelComponent } from './components/backtest-comparison-panel/backtest-comparison-panel.component';
import { OrdersTableComponent } from './components/orders-table/orders-table.component';
import { OverviewCardsComponent } from './components/overview-cards/overview-cards.component';
import { SlippageComparisonPanelComponent } from './components/slippage-comparison-panel/slippage-comparison-panel.component';
import { UserActivityPanelComponent } from './components/user-activity-panel/user-activity-panel.component';
import {
  AlertsDto,
  ComparisonDto,
  LiveTradeFiltersDto,
  LiveTradeMonitoringService,
  LiveTradeOverviewDto,
  PaginatedAlgorithmListDto,
  PaginatedOrderListDto,
  PaginatedUserActivityDto,
  SlippageAnalysisDto
} from './live-trade-monitoring.service';

@Component({
  selector: 'app-live-trade-monitoring',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    TooltipModule,
    OverviewCardsComponent,
    BacktestComparisonPanelComponent,
    SlippageComparisonPanelComponent,
    AlertsPanelComponent,
    OrdersTableComponent,
    UserActivityPanelComponent,
    AlgorithmSelectorComponent
  ],
  providers: [MessageService],
  template: `
    <div class="live-trade-monitoring-page">
      <p-toast />

      <!-- Header -->
      <div class="page-header mb-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="m-0 text-2xl font-bold">Live Trade Monitoring</h1>
            <p class="mt-1 text-gray-500">Monitor live trading activity and compare against backtest predictions</p>
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

            <p-button
              icon="pi pi-refresh"
              [rounded]="true"
              [text]="true"
              severity="secondary"
              (onClick)="refresh()"
              pTooltip="Refresh data"
            />

            <p-button
              icon="pi pi-download"
              label="Export"
              severity="secondary"
              [outlined]="true"
              (onClick)="onExport()"
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
        <p-tabs [value]="activeTab()" (valueChange)="onTabChange($event)">
          <p-tablist>
            <p-tab value="overview">Overview</p-tab>
            <p-tab value="comparison">Backtest vs Live</p-tab>
            <p-tab value="slippage">Slippage Analysis</p-tab>
            <p-tab value="alerts">
              Alerts
              @if (alertsSummary().critical > 0) {
                <span class="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">
                  {{ alertsSummary().critical }}
                </span>
              }
            </p-tab>
            <p-tab value="users">User Activity</p-tab>
          </p-tablist>
          <p-tabpanels>
            <!-- Overview Tab -->
            <p-tabpanel value="overview">
              <div class="mt-4">
                <app-orders-table
                  [orders]="orders()"
                  [isLoading]="ordersQuery.isPending()"
                  (pageChange)="onOrdersPageChange($event)"
                />
              </div>
            </p-tabpanel>

            <!-- Backtest vs Live Tab -->
            <p-tabpanel value="comparison">
              <div class="mt-4">
                <app-algorithm-selector
                  [algorithms]="algorithms()"
                  [selectedAlgorithmId]="selectedAlgorithmId()"
                  (selectionChange)="onAlgorithmSelect($event)"
                  class="mb-4"
                />
                @if (selectedAlgorithmId()) {
                  @if (comparisonQuery.isPending()) {
                    <div class="flex items-center justify-center py-8">
                      <p-progress-spinner strokeWidth="4" />
                    </div>
                  } @else {
                    <app-backtest-comparison-panel [comparison]="comparison()" />
                  }
                } @else {
                  <p-card>
                    <div class="py-8 text-center text-gray-500">
                      <i class="pi pi-chart-line mb-4 text-4xl"></i>
                      <p>Select an algorithm to view backtest vs live comparison</p>
                    </div>
                  </p-card>
                }
              </div>
            </p-tabpanel>

            <!-- Slippage Analysis Tab -->
            <p-tabpanel value="slippage">
              @if (slippageQuery.isPending()) {
                <div class="flex items-center justify-center py-8">
                  <p-progress-spinner strokeWidth="4" />
                </div>
              } @else {
                <app-slippage-comparison-panel [slippageAnalysis]="slippageAnalysis()" />
              }
            </p-tabpanel>

            <!-- Alerts Tab -->
            <p-tabpanel value="alerts">
              @if (alertsQuery.isPending()) {
                <div class="flex items-center justify-center py-8">
                  <p-progress-spinner strokeWidth="4" />
                </div>
              } @else {
                <app-alerts-panel [alerts]="alerts()" />
              }
            </p-tabpanel>

            <!-- User Activity Tab -->
            <p-tabpanel value="users">
              @if (userActivityQuery.isPending()) {
                <div class="flex items-center justify-center py-8">
                  <p-progress-spinner strokeWidth="4" />
                </div>
              } @else {
                <app-user-activity-panel
                  [userActivity]="userActivity()"
                  (pageChange)="onUserActivityPageChange($event)"
                />
              }
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      }
    </div>
  `
})
export class LiveTradeMonitoringComponent {
  private monitoringService = inject(LiveTradeMonitoringService);
  private messageService = inject(MessageService);

  // Filter state
  dateRange: Date[] | null = null;
  activeTab = signal('overview');

  // Filters signal for queries
  filtersSignal = signal<LiveTradeFiltersDto>({});
  ordersPage = signal(1);
  userActivityPage = signal(1);
  selectedAlgorithmId = signal<string | null>(null);

  // TanStack Query hooks
  overviewQuery = this.monitoringService.useOverview(this.filtersSignal);
  algorithmsQuery = this.monitoringService.useAlgorithms(
    computed(() => ({
      ...this.filtersSignal(),
      isActive: true,
      limit: 100
    }))
  );
  ordersQuery = this.monitoringService.useOrders(
    computed(() => ({
      ...this.filtersSignal(),
      page: this.ordersPage(),
      limit: 10
    }))
  );
  comparisonQuery = this.monitoringService.useComparison(this.selectedAlgorithmId);
  slippageQuery = this.monitoringService.useSlippageAnalysis(
    this.filtersSignal,
    computed(() => this.activeTab() === 'slippage')
  );
  alertsQuery = this.monitoringService.useAlerts(
    this.filtersSignal,
    computed(() => this.activeTab() === 'alerts')
  );
  userActivityQuery = this.monitoringService.useUserActivity(
    computed(() => ({
      page: this.userActivityPage(),
      limit: 10,
      minActiveAlgorithms: 1
    })),
    computed(() => this.activeTab() === 'users')
  );

  // Computed data
  isLoading = computed(() => this.overviewQuery.isPending());
  overview = computed(() => this.overviewQuery.data() as LiveTradeOverviewDto | undefined);
  algorithms = computed(() => this.algorithmsQuery.data() as PaginatedAlgorithmListDto | undefined);
  orders = computed(() => this.ordersQuery.data() as PaginatedOrderListDto | undefined);
  comparison = computed(() => this.comparisonQuery.data() as ComparisonDto | undefined);
  slippageAnalysis = computed(() => this.slippageQuery.data() as SlippageAnalysisDto | undefined);
  alerts = computed(() => this.alertsQuery.data() as AlertsDto | undefined);
  userActivity = computed(() => this.userActivityQuery.data() as PaginatedUserActivityDto | undefined);

  // Alerts summary for tab badge (sourced from overview which always polls,
  // not alertsQuery which only polls when the alerts tab is active)
  alertsSummary = computed(() => {
    const overviewData = this.overview();
    return {
      critical: overviewData?.alertsSummary?.critical || 0,
      warning: overviewData?.alertsSummary?.warning || 0,
      info: overviewData?.alertsSummary?.info || 0
    };
  });

  onTabChange(value: string | number | undefined): void {
    this.activeTab.set(String(value ?? 'overview'));
  }

  onDateRangeChange(): void {
    this.updateFilters();
  }

  private updateFilters(): void {
    const filters: LiveTradeFiltersDto = {};

    if (this.dateRange && this.dateRange.length === 2) {
      if (this.dateRange[0]) {
        filters.startDate = this.dateRange[0].toISOString();
      }
      if (this.dateRange[1]) {
        filters.endDate = this.dateRange[1].toISOString();
      }
    }

    this.filtersSignal.set(filters);
    this.ordersPage.set(1);
    this.userActivityPage.set(1);
  }

  onOrdersPageChange(page: number): void {
    this.ordersPage.set(page);
  }

  onUserActivityPageChange(page: number): void {
    this.userActivityPage.set(page);
  }

  onAlgorithmSelect(algorithmId: string | null): void {
    this.selectedAlgorithmId.set(algorithmId);
  }

  refresh(): void {
    this.overviewQuery.refetch();
    this.ordersQuery.refetch();
    this.algorithmsQuery.refetch();

    if (this.activeTab() === 'comparison' && this.selectedAlgorithmId()) {
      this.comparisonQuery.refetch();
    }
    if (this.activeTab() === 'slippage') {
      this.slippageQuery.refetch();
    }
    if (this.activeTab() === 'alerts') {
      this.alertsQuery.refetch();
    }
    if (this.activeTab() === 'users') {
      this.userActivityQuery.refetch();
    }

    this.messageService.add({
      severity: 'info',
      summary: 'Refreshing',
      detail: 'Data is being refreshed',
      life: 2000
    });
  }

  async onExport(): Promise<void> {
    try {
      await this.monitoringService.downloadExport('csv', this.filtersSignal());
      this.messageService.add({
        severity: 'success',
        summary: 'Export Complete',
        detail: 'Orders exported successfully'
      });
    } catch (error: unknown) {
      this.messageService.add({
        severity: 'error',
        summary: 'Export Failed',
        detail: error instanceof Error ? error.message : 'Failed to export data'
      });
    }
  }
}
