import { Test, TestingModule } from '@nestjs/testing';

import { Response } from 'express';

import { BacktestMonitoringController } from './backtest-monitoring.controller';
import { BacktestMonitoringService } from './backtest-monitoring.service';
import { BacktestListQueryDto, ExportFormat, PaginatedBacktestListDto } from './dto/backtest-listing.dto';
import { AverageMetricsDto, BacktestFiltersDto, BacktestOverviewDto, RecentActivityDto } from './dto/overview.dto';
import { SignalAnalyticsDto, SignalOverallStatsDto } from './dto/signal-analytics.dto';
import {
  BacktestSlippageStatsDto,
  ProfitabilityStatsDto,
  TradeAnalyticsDto,
  TradeDurationStatsDto,
  TradeSummaryDto
} from './dto/trade-analytics.dto';

import { BacktestStatus, BacktestType } from '../../order/backtest/backtest.entity';

describe('BacktestMonitoringController', () => {
  let controller: BacktestMonitoringController;
  let service: jest.Mocked<BacktestMonitoringService>;

  const mockOverview: BacktestOverviewDto = {
    statusCounts: {
      [BacktestStatus.PENDING]: 5,
      [BacktestStatus.RUNNING]: 10,
      [BacktestStatus.PAUSED]: 2,
      [BacktestStatus.COMPLETED]: 100,
      [BacktestStatus.FAILED]: 3,
      [BacktestStatus.CANCELLED]: 1
    },
    typeDistribution: {
      [BacktestType.HISTORICAL]: 80,
      [BacktestType.LIVE_REPLAY]: 20,
      [BacktestType.PAPER_TRADING]: 15,
      [BacktestType.STRATEGY_OPTIMIZATION]: 6
    },
    averageMetrics: {
      sharpeRatio: 1.5,
      totalReturn: 12.5,
      maxDrawdown: 8.2,
      winRate: 0.62
    } as AverageMetricsDto,
    recentActivity: {
      last24h: 5,
      last7d: 25,
      last30d: 100
    } as RecentActivityDto,
    topAlgorithms: [{ id: 'algo-1', name: 'RSI Strategy', avgSharpe: 2.1, backtestCount: 10, avgReturn: 18.5 }],
    totalBacktests: 121
  };

  const mockBacktestList: PaginatedBacktestListDto = {
    data: [
      {
        id: 'bt-1',
        name: 'Test Backtest',
        status: BacktestStatus.COMPLETED,
        type: BacktestType.HISTORICAL,
        algorithmId: 'algo-1',
        algorithmName: 'RSI Strategy',
        userId: 'user-1',
        initialCapital: 10000,
        totalReturn: 15,
        sharpeRatio: 1.5,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-12-31T23:59:59.999Z',
        createdAt: '2024-01-01T00:00:00.000Z',
        progressPercent: 100
      }
    ],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false
  };

  const mockSignalAnalytics: SignalAnalyticsDto = {
    overall: {
      totalSignals: 100,
      entryCount: 40,
      exitCount: 35,
      adjustmentCount: 15,
      riskControlCount: 10,
      avgConfidence: 0.72
    } as SignalOverallStatsDto,
    byConfidenceBucket: [],
    bySignalType: [],
    byDirection: [],
    byInstrument: []
  };

  const mockTradeAnalytics: TradeAnalyticsDto = {
    summary: {
      totalTrades: 50,
      totalVolume: 100000,
      totalFees: 100,
      buyCount: 25,
      sellCount: 25
    } as TradeSummaryDto,
    profitability: {
      winCount: 15,
      lossCount: 10,
      winRate: 0.6,
      profitFactor: 2.5,
      largestWin: 1000,
      largestLoss: -500,
      expectancy: 100,
      avgWin: 333,
      avgLoss: -200,
      totalRealizedPnL: 3000
    } as ProfitabilityStatsDto,
    duration: {
      avgHoldTimeMs: 3600000,
      avgHoldTime: '1h',
      medianHoldTimeMs: 3000000,
      medianHoldTime: '50m',
      maxHoldTimeMs: 86400000,
      maxHoldTime: '1d',
      minHoldTimeMs: 60000,
      minHoldTime: '1m'
    } as TradeDurationStatsDto,
    slippage: {
      avgBps: 5.5,
      totalImpact: 50,
      p95Bps: 12,
      maxBps: 15,
      fillCount: 40
    } as BacktestSlippageStatsDto,
    byInstrument: []
  };

  beforeEach(async () => {
    service = {
      getOverview: jest.fn().mockResolvedValue(mockOverview),
      getBacktests: jest.fn().mockResolvedValue(mockBacktestList),
      getSignalAnalytics: jest.fn().mockResolvedValue(mockSignalAnalytics),
      getTradeAnalytics: jest.fn().mockResolvedValue(mockTradeAnalytics),
      exportBacktests: jest.fn().mockResolvedValue([]),
      exportSignals: jest.fn().mockResolvedValue([]),
      exportTrades: jest.fn().mockResolvedValue([])
    } as unknown as jest.Mocked<BacktestMonitoringService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BacktestMonitoringController],
      providers: [{ provide: BacktestMonitoringService, useValue: service }]
    }).compile();

    controller = module.get(BacktestMonitoringController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOverview', () => {
    it('returns overview metrics', async () => {
      const filters: BacktestFiltersDto = {};

      const result = await controller.getOverview(filters);

      expect(result).toEqual(mockOverview);
      expect(service.getOverview).toHaveBeenCalledWith(filters);
    });

    it('passes filters to service', async () => {
      const filters: BacktestFiltersDto = {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-12-31T23:59:59.999Z',
        status: BacktestStatus.COMPLETED
      };

      await controller.getOverview(filters);

      expect(service.getOverview).toHaveBeenCalledWith(filters);
    });
  });

  describe('getBacktests', () => {
    it('returns paginated backtest list', async () => {
      const query: BacktestListQueryDto = { page: 1, limit: 10 };

      const result = await controller.getBacktests(query);

      expect(result).toEqual(mockBacktestList);
      expect(service.getBacktests).toHaveBeenCalledWith(query);
    });

    it('passes search and filters to service', async () => {
      const query: BacktestListQueryDto = {
        page: 1,
        limit: 10,
        search: 'test',
        status: BacktestStatus.COMPLETED
      };

      await controller.getBacktests(query);

      expect(service.getBacktests).toHaveBeenCalledWith(query);
    });
  });

  describe('getSignalAnalytics', () => {
    it('returns signal analytics', async () => {
      const filters: BacktestFiltersDto = {};

      const result = await controller.getSignalAnalytics(filters);

      expect(result).toEqual(mockSignalAnalytics);
      expect(service.getSignalAnalytics).toHaveBeenCalledWith(filters);
    });
  });

  describe('getTradeAnalytics', () => {
    it('returns trade analytics', async () => {
      const filters: BacktestFiltersDto = {};

      const result = await controller.getTradeAnalytics(filters);

      expect(result).toEqual(mockTradeAnalytics);
      expect(service.getTradeAnalytics).toHaveBeenCalledWith(filters);
    });
  });

  describe('exportBacktests', () => {
    it('exports backtests as JSON', async () => {
      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn()
      } as unknown as Response;

      const mockData = [{ id: 'bt-1', name: 'Test' }];
      service.exportBacktests.mockResolvedValueOnce(mockData);

      await controller.exportBacktests({}, ExportFormat.JSON, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="backtests.json"'
      );
      expect(mockResponse.send).toHaveBeenCalledWith(mockData);
    });

    it('exports backtests as CSV', async () => {
      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn()
      } as unknown as Response;

      const mockData = Buffer.from('id,name\nbt-1,Test');
      service.exportBacktests.mockResolvedValueOnce(mockData);

      await controller.exportBacktests({}, ExportFormat.CSV, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="backtests.csv"'
      );
      expect(mockResponse.send).toHaveBeenCalledWith(mockData);
    });
  });

  describe('exportSignals', () => {
    it('exports signals for a specific backtest', async () => {
      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn()
      } as unknown as Response;

      const mockData = [{ id: 'signal-1' }];
      service.exportSignals.mockResolvedValueOnce(mockData);

      await controller.exportSignals('bt-1', ExportFormat.JSON, mockResponse);

      expect(service.exportSignals).toHaveBeenCalledWith('bt-1', ExportFormat.JSON);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="signals-bt-1.json"'
      );
      expect(mockResponse.send).toHaveBeenCalledWith(mockData);
    });
  });

  describe('exportTrades', () => {
    it('exports trades for a specific backtest', async () => {
      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn()
      } as unknown as Response;

      const mockData = [{ id: 'trade-1' }];
      service.exportTrades.mockResolvedValueOnce(mockData);

      await controller.exportTrades('bt-1', ExportFormat.JSON, mockResponse);

      expect(service.exportTrades).toHaveBeenCalledWith('bt-1', ExportFormat.JSON);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="trades-bt-1.json"'
      );
      expect(mockResponse.send).toHaveBeenCalledWith(mockData);
    });
  });
});
