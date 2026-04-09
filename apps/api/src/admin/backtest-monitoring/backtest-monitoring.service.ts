import { Injectable } from '@nestjs/common';

import { BacktestMonitoringAnalyticsService } from './backtest-monitoring-analytics.service';
import {
  BacktestListQueryDto,
  ExportFormat,
  PaginatedBacktestListDto,
  PaginatedLiveReplayRunsDto
} from './dto/backtest-listing.dto';
import {
  OptimizationAnalyticsDto,
  OptimizationFiltersDto,
  PaginatedOptimizationRunsDto
} from './dto/optimization-analytics.dto';
import { BacktestFiltersDto, BacktestOverviewDto } from './dto/overview.dto';
import {
  PaginatedPaperTradingSessionsDto,
  PaperTradingFiltersDto,
  PaperTradingMonitoringDto,
  PipelineStageCountsDto
} from './dto/paper-trading-analytics.dto';
import { SignalActivityFeedDto } from './dto/signal-activity-feed.dto';
import { SignalAnalyticsDto } from './dto/signal-analytics.dto';
import { TradeAnalyticsDto } from './dto/trade-analytics.dto';
import { LiveReplayMonitoringService } from './live-replay-monitoring.service';
import { MonitoringExportService } from './monitoring-export.service';
import { OptimizationAnalyticsService } from './optimization-analytics.service';
import { PaperTradingMonitoringService } from './paper-trading-monitoring.service';
import { SignalActivityFeedService } from './signal-activity-feed.service';
import { SignalAnalyticsService } from './signal-analytics.service';
import { TradeAnalyticsService } from './trade-analytics.service';

/**
 * Facade for backtest monitoring features used by `BacktestMonitoringController`.
 *
 * Delegates every operation to a focused collaborator service. Exists only to
 * keep the controller's dependency list stable and provide one import point.
 */
@Injectable()
export class BacktestMonitoringService {
  constructor(
    private readonly analyticsService: BacktestMonitoringAnalyticsService,
    private readonly exportService: MonitoringExportService,
    private readonly liveReplayService: LiveReplayMonitoringService,
    private readonly optimizationAnalyticsService: OptimizationAnalyticsService,
    private readonly paperTradingMonitoringService: PaperTradingMonitoringService,
    private readonly tradeAnalyticsService: TradeAnalyticsService,
    private readonly signalAnalyticsService: SignalAnalyticsService,
    private readonly signalActivityFeedService: SignalActivityFeedService
  ) {}

  getOverview(filters: BacktestFiltersDto): Promise<BacktestOverviewDto> {
    return this.analyticsService.getOverview(filters);
  }

  getBacktests(query: BacktestListQueryDto): Promise<PaginatedBacktestListDto> {
    return this.analyticsService.getBacktests(query);
  }

  getSignalAnalytics(filters: BacktestFiltersDto): Promise<SignalAnalyticsDto> {
    return this.signalAnalyticsService.getSignalAnalytics(filters);
  }

  getTradeAnalytics(filters: BacktestFiltersDto): Promise<TradeAnalyticsDto> {
    return this.tradeAnalyticsService.getTradeAnalytics(filters);
  }

  exportBacktests(filters: BacktestFiltersDto, format: ExportFormat): Promise<Buffer | object[]> {
    return this.exportService.exportBacktests(filters, format);
  }

  exportSignals(backtestId: string, format: ExportFormat): Promise<Buffer | object[]> {
    return this.exportService.exportSignals(backtestId, format);
  }

  exportTrades(backtestId: string, format: ExportFormat): Promise<Buffer | object[]> {
    return this.exportService.exportTrades(backtestId, format);
  }

  getOptimizationAnalytics(filters: OptimizationFiltersDto): Promise<OptimizationAnalyticsDto> {
    return this.optimizationAnalyticsService.getOptimizationAnalytics(filters);
  }

  getPaperTradingMonitoring(filters: PaperTradingFiltersDto): Promise<PaperTradingMonitoringDto> {
    return this.paperTradingMonitoringService.getPaperTradingMonitoring(filters);
  }

  listOptimizationRuns(filters: OptimizationFiltersDto, page = 1, limit = 10): Promise<PaginatedOptimizationRunsDto> {
    return this.optimizationAnalyticsService.listOptimizationRuns(filters, page, limit);
  }

  listPaperTradingSessions(
    filters: PaperTradingFiltersDto,
    page = 1,
    limit = 10
  ): Promise<PaginatedPaperTradingSessionsDto> {
    return this.paperTradingMonitoringService.listPaperTradingSessions(filters, page, limit);
  }

  listLiveReplayRuns(filters: BacktestFiltersDto, page = 1, limit = 10): Promise<PaginatedLiveReplayRunsDto> {
    return this.liveReplayService.listLiveReplayRuns(filters, page, limit);
  }

  getPipelineStageCounts(): Promise<PipelineStageCountsDto> {
    return this.liveReplayService.getPipelineStageCounts();
  }

  getSignalActivityFeed(limit: number): Promise<SignalActivityFeedDto> {
    return this.signalActivityFeedService.getSignalActivityFeed(limit);
  }
}
