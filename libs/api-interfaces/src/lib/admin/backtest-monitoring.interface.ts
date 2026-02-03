/**
 * Backtest Monitoring Interfaces
 *
 * Shared types for the admin backtest monitoring dashboard.
 */

import { BacktestStatus, BacktestType, SignalDirection, SignalType } from '../backtesting/backtesting.interface';

// ===========================================================================
// Monitoring-specific Enums
// ===========================================================================

export enum BacktestSortField {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  SHARPE_RATIO = 'sharpeRatio',
  TOTAL_RETURN = 'totalReturn',
  MAX_DRAWDOWN = 'maxDrawdown',
  WIN_RATE = 'winRate',
  TOTAL_TRADES = 'totalTrades',
  NAME = 'name',
  STATUS = 'status'
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC'
}

export enum ExportFormat {
  CSV = 'csv',
  JSON = 'json'
}

// ===========================================================================
// Filter DTOs
// ===========================================================================

export interface BacktestFiltersDto {
  startDate?: string;
  endDate?: string;
  algorithmId?: string;
  status?: BacktestStatus;
  type?: BacktestType;
}

export interface BacktestListQueryDto extends BacktestFiltersDto {
  page?: number;
  limit?: number;
  sortBy?: BacktestSortField;
  sortOrder?: SortOrder;
  search?: string;
}

// ===========================================================================
// Overview DTOs
// ===========================================================================

export interface AverageMetricsDto {
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
}

export interface RecentActivityDto {
  last24h: number;
  last7d: number;
  last30d: number;
}

export interface TopAlgorithmDto {
  id: string;
  name: string;
  avgSharpe: number;
  backtestCount: number;
  avgReturn: number;
}

export interface BacktestOverviewDto {
  statusCounts: Record<BacktestStatus, number>;
  typeDistribution: Record<BacktestType, number>;
  averageMetrics: AverageMetricsDto;
  recentActivity: RecentActivityDto;
  topAlgorithms: TopAlgorithmDto[];
  totalBacktests: number;
}

// ===========================================================================
// Signal Analytics DTOs
// ===========================================================================

export interface SignalOverallStatsDto {
  totalSignals: number;
  entryCount: number;
  exitCount: number;
  adjustmentCount: number;
  riskControlCount: number;
  avgConfidence: number;
}

export interface ConfidenceBucketDto {
  bucket: string;
  signalCount: number;
  successRate: number;
  avgReturn: number;
}

export interface SignalTypeMetricsDto {
  type: SignalType;
  count: number;
  successRate: number;
  avgReturn: number;
}

export interface SignalDirectionMetricsDto {
  direction: SignalDirection;
  count: number;
  successRate: number;
  avgReturn: number;
}

export interface SignalInstrumentMetricsDto {
  instrument: string;
  count: number;
  successRate: number;
  avgReturn: number;
}

export interface SignalAnalyticsDto {
  overall: SignalOverallStatsDto;
  byConfidenceBucket: ConfidenceBucketDto[];
  bySignalType: SignalTypeMetricsDto[];
  byDirection: SignalDirectionMetricsDto[];
  byInstrument: SignalInstrumentMetricsDto[];
}

// ===========================================================================
// Trade Analytics DTOs
// ===========================================================================

export interface TradeSummaryDto {
  totalTrades: number;
  totalVolume: number;
  totalFees: number;
  buyCount: number;
  sellCount: number;
}

export interface ProfitabilityStatsDto {
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  totalRealizedPnL: number;
}

export interface TradeDurationStatsDto {
  avgHoldTimeMs: number;
  avgHoldTime: string;
  medianHoldTimeMs: number;
  medianHoldTime: string;
  maxHoldTimeMs: number;
  maxHoldTime: string;
  minHoldTimeMs: number;
  minHoldTime: string;
}

export interface SlippageStatsDto {
  avgBps: number;
  totalImpact: number;
  p95Bps: number;
  maxBps: number;
  fillCount: number;
}

export interface InstrumentTradeMetricsDto {
  instrument: string;
  tradeCount: number;
  totalReturn: number;
  winRate: number;
  totalVolume: number;
  totalPnL: number;
}

export interface TradeAnalyticsDto {
  summary: TradeSummaryDto;
  profitability: ProfitabilityStatsDto;
  duration: TradeDurationStatsDto;
  slippage: SlippageStatsDto;
  byInstrument: InstrumentTradeMetricsDto[];
}

// ===========================================================================
// Backtest Listing DTOs
// ===========================================================================

export interface BacktestListItemDto {
  id: string;
  name: string;
  description?: string;
  status: BacktestStatus;
  type: BacktestType;
  algorithmId: string;
  algorithmName: string;
  userId: string;
  userEmail?: string;
  initialCapital: number;
  finalValue?: number;
  totalReturn?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  totalTrades?: number;
  winRate?: number;
  startDate: string;
  endDate: string;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  progressPercent: number;
}

export interface PaginatedBacktestListDto {
  data: BacktestListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
