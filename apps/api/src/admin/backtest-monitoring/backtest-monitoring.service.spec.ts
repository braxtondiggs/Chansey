import { Test, TestingModule } from '@nestjs/testing';

import { BacktestMonitoringAnalyticsService } from './backtest-monitoring-analytics.service';
import { BacktestMonitoringService } from './backtest-monitoring.service';
import { ExportFormat } from './dto/backtest-listing.dto';
import { LiveReplayMonitoringService } from './live-replay-monitoring.service';
import { MonitoringExportService } from './monitoring-export.service';
import { OptimizationAnalyticsService } from './optimization-analytics.service';
import { PaperTradingMonitoringService } from './paper-trading-monitoring.service';
import { SignalActivityFeedService } from './signal-activity-feed.service';
import { SignalAnalyticsService } from './signal-analytics.service';
import { TradeAnalyticsService } from './trade-analytics.service';

/**
 * `BacktestMonitoringService` is a pure pass-through facade — every method
 * delegates one-to-one to a collaborator. We verify delegation with a single
 * parameterized table; business logic is covered in each collaborator's spec.
 */
describe('BacktestMonitoringService (facade)', () => {
  let service: BacktestMonitoringService;
  const collaborators = {
    analytics: { getOverview: jest.fn(), getBacktests: jest.fn() },
    export: { exportBacktests: jest.fn(), exportSignals: jest.fn(), exportTrades: jest.fn() },
    liveReplay: { listLiveReplayRuns: jest.fn(), getPipelineStageCounts: jest.fn() },
    optimization: { getOptimizationAnalytics: jest.fn(), listOptimizationRuns: jest.fn() },
    paperTrading: { getPaperTradingMonitoring: jest.fn(), listPaperTradingSessions: jest.fn() },
    trade: { getTradeAnalytics: jest.fn() },
    signal: { getSignalAnalytics: jest.fn() },
    signalFeed: { getSignalActivityFeed: jest.fn() }
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestMonitoringService,
        { provide: BacktestMonitoringAnalyticsService, useValue: collaborators.analytics },
        { provide: MonitoringExportService, useValue: collaborators.export },
        { provide: LiveReplayMonitoringService, useValue: collaborators.liveReplay },
        { provide: OptimizationAnalyticsService, useValue: collaborators.optimization },
        { provide: PaperTradingMonitoringService, useValue: collaborators.paperTrading },
        { provide: TradeAnalyticsService, useValue: collaborators.trade },
        { provide: SignalAnalyticsService, useValue: collaborators.signal },
        { provide: SignalActivityFeedService, useValue: collaborators.signalFeed }
      ]
    }).compile();

    service = module.get(BacktestMonitoringService);
  });

  afterEach(() => jest.clearAllMocks());

  it.each([
    ['getOverview', 'analytics', 'getOverview', [{}]],
    ['getBacktests', 'analytics', 'getBacktests', [{}]],
    ['getSignalAnalytics', 'signal', 'getSignalAnalytics', [{}]],
    ['getTradeAnalytics', 'trade', 'getTradeAnalytics', [{}]],
    ['exportBacktests', 'export', 'exportBacktests', [{}, ExportFormat.JSON]],
    ['exportSignals', 'export', 'exportSignals', ['bt-1', ExportFormat.JSON]],
    ['exportTrades', 'export', 'exportTrades', ['bt-1', ExportFormat.JSON]],
    ['getOptimizationAnalytics', 'optimization', 'getOptimizationAnalytics', [{}]],
    ['listOptimizationRuns', 'optimization', 'listOptimizationRuns', [{}, 1, 10]],
    ['getPaperTradingMonitoring', 'paperTrading', 'getPaperTradingMonitoring', [{}]],
    ['listPaperTradingSessions', 'paperTrading', 'listPaperTradingSessions', [{}, 1, 10]],
    ['listLiveReplayRuns', 'liveReplay', 'listLiveReplayRuns', [{}, 1, 10]],
    ['getPipelineStageCounts', 'liveReplay', 'getPipelineStageCounts', []],
    ['getSignalActivityFeed', 'signalFeed', 'getSignalActivityFeed', [10]]
  ] as const)('%s delegates to %s.%s with exact args', async (method, collaboratorKey, target, args) => {
    await (service as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method](...args);
    const mock = (collaborators[collaboratorKey] as Record<string, jest.Mock>)[target];
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith(...args);
  });
});
