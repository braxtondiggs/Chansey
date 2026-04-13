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
import { LiveTradeMonitoringService } from './live-trade-monitoring.service';
import {
  AlertsDto,
  ComparisonDto,
  LiveTradeFiltersDto,
  LiveTradeOverviewDto,
  PaginatedAlgorithmListDto,
  PaginatedOrderListDto,
  PaginatedUserActivityDto,
  SlippageAnalysisDto
} from './live-trade-monitoring.types';

@Component({
  selector: 'app-live-trade-monitoring',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
  templateUrl: './live-trade-monitoring.component.html'
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
