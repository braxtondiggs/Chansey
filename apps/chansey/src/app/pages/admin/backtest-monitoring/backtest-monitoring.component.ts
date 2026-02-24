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
  OptimizationAnalyticsDto,
  OptimizationFiltersDto,
  OptimizationStatus,
  PaginatedBacktestListDto,
  PaginatedLiveReplayRunsDto,
  PaginatedOptimizationRunsDto,
  PaginatedPaperTradingSessionsDto,
  PaperTradingFiltersDto,
  PaperTradingMonitoringDto,
  PaperTradingStatus,
  PipelineStageCountsDto,
  SignalActivityFeedDto,
  SignalAnalyticsDto,
  TradeAnalyticsDto
} from '@chansey/api-interfaces';

import { BacktestMonitoringService } from './backtest-monitoring.service';
import { BacktestsTableComponent } from './components/backtests-table/backtests-table.component';
import { ExportPanelComponent } from './components/export-panel/export-panel.component';
import { LiveReplayPanelComponent } from './components/live-replay-panel/live-replay-panel.component';
import { OptimizationPanelComponent } from './components/optimization-panel/optimization-panel.component';
import { OverviewCardsComponent } from './components/overview-cards/overview-cards.component';
import { PaperTradingPanelComponent } from './components/paper-trading-panel/paper-trading-panel.component';
import { SignalActivityFeedComponent } from './components/signal-activity-feed/signal-activity-feed.component';
import { SignalQualityPanelComponent } from './components/signal-quality-panel/signal-quality-panel.component';
import { TopAlgorithmsComponent } from './components/top-algorithms/top-algorithms.component';
import { TradeAnalyticsPanelComponent } from './components/trade-analytics-panel/trade-analytics-panel.component';

type PipelineView = 'optimization' | 'historical' | 'live-replay' | 'paper-trading';

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
    LiveReplayPanelComponent,
    OptimizationPanelComponent,
    PaperTradingPanelComponent,
    SignalActivityFeedComponent,
    ExportPanelComponent
  ],
  providers: [MessageService],
  template: `
    <div class="p-3 md:p-6">
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
              [(ngModel)]="selectedView"
              [options]="viewOptions"
              placeholder="All Stages"
              [showClear]="true"
              (onChange)="onViewChange()"
            />

            <p-button
              icon="pi pi-bolt"
              [rounded]="true"
              [text]="activeTab() !== 'signal-feed'"
              [severity]="activeTab() === 'signal-feed' ? 'warn' : 'secondary'"
              (onClick)="toggleSignalFeed()"
              pTooltip="Signal Activity Feed"
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
        <app-overview-cards [overview]="overview()" [pipelineStageCounts]="pipelineStageCounts()" class="mb-4" />

        <!-- Global Signal Activity Feed (all pipeline stages) -->
        @if (activeTab() === 'signal-feed') {
          @if (signalFeedQuery.isPending()) {
            <div class="flex items-center justify-center py-8">
              <p-progress-spinner strokeWidth="4" />
            </div>
          } @else {
            <app-signal-activity-feed [feed]="signalFeed()" />
          }
        } @else if (selectedView === 'optimization') {
          @if (optimizationQuery.isPending()) {
            <div class="flex items-center justify-center py-8">
              <p-progress-spinner strokeWidth="4" />
            </div>
          } @else {
            <app-optimization-panel
              [analytics]="optimizationAnalytics()"
              [runs]="optimizationRuns()"
              (pageChange)="onOptimizationRunsPageChange($event)"
            />
          }
        } @else if (selectedView === 'paper-trading') {
          @if (paperTradingQuery.isPending()) {
            <div class="flex items-center justify-center py-8">
              <p-progress-spinner strokeWidth="4" />
            </div>
          } @else {
            <app-paper-trading-panel
              [analytics]="paperTradingAnalytics()"
              [sessions]="paperTradingSessions()"
              (pageChange)="onPaperTradingSessionsPageChange($event)"
            />
          }
        } @else if (selectedView === 'live-replay') {
          @if (liveReplayRunsQuery.isPending()) {
            <div class="flex items-center justify-center py-8">
              <p-progress-spinner strokeWidth="4" />
            </div>
          } @else {
            <app-live-replay-panel
              [overview]="overview()"
              [runs]="liveReplayRuns()"
              (pageChange)="onLiveReplayRunsPageChange($event)"
            />
          }
        } @else {
          <!-- Backtest tabs (overview, signals, trades, export) -->
          <p-tabs [value]="activeTab()" (valueChange)="activeTab.set($any($event))">
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
      }
    </div>
  `
})
export class BacktestMonitoringComponent {
  private monitoringService = inject(BacktestMonitoringService);
  private messageService = inject(MessageService);

  // Filter state
  dateRange: Date[] | null = null;
  selectedStatus: string | null = null;
  selectedView: PipelineView | null = null;
  activeTab = signal('overview');

  // View options for pipeline stages
  viewOptions: { label: string; value: PipelineView }[] = [
    { label: 'Optimization', value: 'optimization' },
    { label: 'Historical', value: 'historical' },
    { label: 'Live Replay', value: 'live-replay' },
    { label: 'Paper Trading', value: 'paper-trading' }
  ];

  // Status options (rebuilt dynamically when view changes)
  statusOptions = this.buildStatusOptions(null);

  // Filters signals for queries
  filtersSignal = signal<BacktestFiltersDto>({});
  optimizationFiltersSignal = signal<OptimizationFiltersDto>({});
  paperTradingFiltersSignal = signal<PaperTradingFiltersDto>({});
  currentPage = signal(1);
  optimizationRunsPage = signal(1);
  liveReplayRunsPage = signal(1);
  paperTradingSessionsPage = signal(1);

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
  optimizationQuery = this.monitoringService.useOptimizationAnalytics(this.optimizationFiltersSignal);
  optimizationRunsQuery = this.monitoringService.useOptimizationRuns(
    computed(() => ({
      ...this.optimizationFiltersSignal(),
      page: this.optimizationRunsPage(),
      limit: 10
    }))
  );
  liveReplayRunsQuery = this.monitoringService.useLiveReplayRuns(
    computed(() => ({
      ...this.filtersSignal(),
      page: this.liveReplayRunsPage(),
      limit: 10
    }))
  );
  paperTradingQuery = this.monitoringService.usePaperTradingAnalytics(this.paperTradingFiltersSignal);
  paperTradingSessionsQuery = this.monitoringService.usePaperTradingSessions(
    computed(() => ({
      ...this.paperTradingFiltersSignal(),
      page: this.paperTradingSessionsPage(),
      limit: 10
    }))
  );
  signalFeedEnabled = computed(() => this.activeTab() === 'signal-feed');
  signalFeedQuery = this.monitoringService.useSignalActivityFeed(undefined, this.signalFeedEnabled);
  pipelineStageCountsQuery = this.monitoringService.usePipelineStageCounts();

  // Computed data
  isLoading = computed(() => this.overviewQuery.isPending());

  overview = computed(() => this.overviewQuery.data() as BacktestOverviewDto | undefined);
  backtests = computed(() => this.backtestsQuery.data() as PaginatedBacktestListDto | undefined);
  signalAnalytics = computed(() => this.signalAnalyticsQuery.data() as SignalAnalyticsDto | undefined);
  tradeAnalytics = computed(() => this.tradeAnalyticsQuery.data() as TradeAnalyticsDto | undefined);
  optimizationAnalytics = computed(() => this.optimizationQuery.data() as OptimizationAnalyticsDto | undefined);
  optimizationRuns = computed(() => this.optimizationRunsQuery.data() as PaginatedOptimizationRunsDto | undefined);
  liveReplayRuns = computed(() => this.liveReplayRunsQuery.data() as PaginatedLiveReplayRunsDto | undefined);
  paperTradingAnalytics = computed(() => this.paperTradingQuery.data() as PaperTradingMonitoringDto | undefined);
  paperTradingSessions = computed(
    () => this.paperTradingSessionsQuery.data() as PaginatedPaperTradingSessionsDto | undefined
  );
  signalFeed = computed(() => this.signalFeedQuery.data() as SignalActivityFeedDto | undefined);
  pipelineStageCounts = computed(() => this.pipelineStageCountsQuery.data() as PipelineStageCountsDto | undefined);

  onDateRangeChange(): void {
    this.updateFilters();
  }

  onFilterChange(): void {
    this.updateFilters();
  }

  onViewChange(): void {
    this.selectedStatus = null;
    this.statusOptions = this.buildStatusOptions(this.selectedView);
    this.updateFilters();
  }

  private updateFilters(): void {
    const dateFilters: { startDate?: string; endDate?: string } = {};

    if (this.dateRange && this.dateRange.length === 2) {
      if (this.dateRange[0]) {
        dateFilters.startDate = this.dateRange[0].toISOString();
      }
      if (this.dateRange[1]) {
        dateFilters.endDate = this.dateRange[1].toISOString();
      }
    }

    // Update backtest filters
    const backtestFilters: BacktestFiltersDto = { ...dateFilters };

    if (this.selectedView === 'historical') {
      backtestFilters.type = BacktestType.HISTORICAL;
    } else if (this.selectedView === 'live-replay') {
      backtestFilters.type = BacktestType.LIVE_REPLAY;
    }

    if (this.selectedStatus && this.selectedView !== 'optimization' && this.selectedView !== 'paper-trading') {
      backtestFilters.status = this.selectedStatus as BacktestStatus;
    }

    this.filtersSignal.set(backtestFilters);

    // Update optimization filters
    const optFilters: OptimizationFiltersDto = { ...dateFilters };
    if (this.selectedStatus && this.selectedView === 'optimization') {
      optFilters.status = this.selectedStatus as OptimizationStatus;
    }
    this.optimizationFiltersSignal.set(optFilters);

    // Update paper trading filters
    const ptFilters: PaperTradingFiltersDto = { ...dateFilters };
    if (this.selectedStatus && this.selectedView === 'paper-trading') {
      ptFilters.status = this.selectedStatus as PaperTradingStatus;
    }
    this.paperTradingFiltersSignal.set(ptFilters);

    this.currentPage.set(1);
    this.optimizationRunsPage.set(1);
    this.liveReplayRunsPage.set(1);
    this.paperTradingSessionsPage.set(1);
  }

  onPageChange(page: number): void {
    this.currentPage.set(page);
  }

  onOptimizationRunsPageChange(page: number): void {
    this.optimizationRunsPage.set(page);
  }

  onLiveReplayRunsPageChange(page: number): void {
    this.liveReplayRunsPage.set(page);
  }

  onPaperTradingSessionsPageChange(page: number): void {
    this.paperTradingSessionsPage.set(page);
  }

  toggleSignalFeed(): void {
    if (this.activeTab() === 'signal-feed') {
      this.activeTab.set('overview');
    } else {
      this.activeTab.set('signal-feed');
    }
  }

  refresh(): void {
    this.pipelineStageCountsQuery.refetch();

    if (this.activeTab() === 'signal-feed') {
      this.signalFeedQuery.refetch();
    } else if (this.selectedView === 'optimization') {
      this.optimizationQuery.refetch();
      this.optimizationRunsQuery.refetch();
    } else if (this.selectedView === 'live-replay') {
      this.overviewQuery.refetch();
      this.liveReplayRunsQuery.refetch();
    } else if (this.selectedView === 'paper-trading') {
      this.paperTradingQuery.refetch();
      this.paperTradingSessionsQuery.refetch();
    } else {
      this.overviewQuery.refetch();
      this.backtestsQuery.refetch();

      if (this.activeTab() === 'signals') {
        this.signalAnalyticsQuery.refetch();
      }

      if (this.activeTab() === 'trades') {
        this.tradeAnalyticsQuery.refetch();
      }
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

  private buildStatusOptions(view: PipelineView | null): { label: string; value: string }[] {
    if (view === 'optimization') {
      return Object.values(OptimizationStatus).map((s) => ({
        label: this.formatEnumValue(s),
        value: s
      }));
    }

    if (view === 'paper-trading') {
      return Object.values(PaperTradingStatus).map((s) => ({
        label: this.formatEnumValue(s),
        value: s
      }));
    }

    return Object.values(BacktestStatus).map((s) => ({
      label: this.formatEnumValue(s),
      value: s
    }));
  }

  private formatEnumValue(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}
