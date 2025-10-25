export type BacktestMode = 'historical' | 'live_replay';

export type BacktestStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type BacktestSignalType = 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'RISK_CONTROL';

export type BacktestSignalDirection = 'LONG' | 'SHORT' | 'FLAT';

export type SimulatedOrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';

export type SimulatedOrderStatus = 'FILLED' | 'PARTIAL' | 'CANCELLED';

export type MarketDataSource = 'EXCHANGE_STREAM' | 'VENDOR_FEED' | 'INTERNAL_CAPTURE';

export type MarketDataTimeframe = 'TICK' | 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY';

export type BacktestType = 'HISTORICAL' | 'LIVE_REPLAY' | 'PAPER_TRADING' | 'STRATEGY_OPTIMIZATION';

export interface MarketDataSet {
  id: string;
  label: string;
  source: MarketDataSource;
  instrumentUniverse: string[];
  timeframe: MarketDataTimeframe;
  startAt: Date;
  endAt: Date;
  integrityScore: number;
  checksum: string;
  storageLocation: string;
  replayCapable: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BacktestAlgorithmRef {
  id: string;
  name: string;
  version?: string;
}

export interface BacktestUserRef {
  id: string;
  displayName?: string;
}

export interface BacktestPerformanceMetrics {
  totalReturn?: number;
  annualizedReturn?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  winRate?: number;
  totalTrades?: number;
  winningTrades?: number;
  avgTradeDurationSeconds?: number;
  profitFactor?: number;
  maxAdverseExcursion?: number;
  volatility?: number;
  benchmarkSymbol?: string;
  benchmarkReturn?: number;
}

export interface BacktestPerformanceSnapshot {
  id: string;
  timestamp: Date;
  portfolioValue: number;
  cashBalance: number;
  holdings: Record<string, { quantity: number; value: number; price: number }>;
  cumulativeReturn: number;
  drawdown: number;
}

export interface BacktestSignal {
  id: string;
  backtestId: string;
  timestamp: Date;
  signalType: BacktestSignalType;
  instrument: string;
  direction: BacktestSignalDirection;
  quantity: number;
  price?: number;
  reason?: string;
  confidence?: number;
  payload?: Record<string, unknown>;
}

export interface SimulatedOrderFill {
  id: string;
  backtestId: string;
  orderType: SimulatedOrderType;
  status: SimulatedOrderStatus;
  filledQuantity: number;
  averagePrice: number;
  fees: number;
  slippageBps?: number;
  executionTimestamp: Date;
  instrument?: string;
  metadata?: Record<string, unknown>;
  signalId?: string;
}

export interface BacktestRunSummary {
  id: string;
  name: string;
  description?: string;
  algorithm: BacktestAlgorithmRef;
  marketDataSet?: MarketDataSet;
  mode: BacktestMode;
  status: BacktestStatus;
  initiatedBy: BacktestUserRef;
  initiatedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  warningFlags: string[];
  keyMetrics?: BacktestPerformanceMetrics;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BacktestRunDetail extends BacktestRunSummary {
  type: BacktestType | string;
  initialCapital: number;
  tradingFee: number;
  startDate: Date;
  endDate: Date;
  finalValue?: number;
  totalReturn?: number;
  annualizedReturn?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  totalTrades?: number;
  winningTrades?: number;
  winRate?: number;
  configSnapshot?: Record<string, unknown>;
  deterministicSeed?: string;
  signalsCount?: number;
  tradesCount?: number;
  auditTrail?: Array<{
    previousStatus: BacktestStatus;
    nextStatus: BacktestStatus;
    timestamp: Date;
    actor?: string;
    note?: string;
  }>;
}

export interface BacktestRun extends BacktestRunDetail {
  performanceSnapshots?: BacktestPerformanceSnapshot[];
  signals?: BacktestSignal[];
  simulatedFills?: SimulatedOrderFill[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BacktestRunCollection {
  items: BacktestRunSummary[];
  nextCursor?: string;
}

export interface BacktestSignalCollection {
  items: BacktestSignal[];
  nextCursor?: string;
}

export interface SimulatedOrderFillCollection {
  items: SimulatedOrderFill[];
  nextCursor?: string;
}

export interface CreateBacktestRequest {
  name: string;
  description?: string;
  algorithmId: string;
  marketDataSetId: string;
  type: BacktestType | string;
  mode?: BacktestMode;
  initialCapital: number;
  tradingFee?: number;
  startDate: Date | string;
  endDate: Date | string;
  parametersOverride?: Record<string, unknown>;
  executionWindow?: { startAt: Date | string; endAt: Date | string };
  deterministicSeed?: string;
}

export interface BacktestFilters {
  algorithmId?: string;
  mode?: BacktestMode;
  status?: BacktestStatus;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  cursor?: string;
}

export interface ComparisonFilters {
  timeframe?: string | null;
  marketRegime?: string | null;
  algorithmIds?: string[];
}

export interface ComparisonReportRun {
  run: BacktestRunSummary;
  metrics?: BacktestPerformanceMetrics;
  benchmark?: {
    symbol?: string;
    return?: number;
  } | null;
}

export interface ComparisonReportSummary {
  bestReturn: number;
  bestSharpe: number;
  lowestDrawdown: number;
}

export interface ComparisonReportNote {
  author: BacktestUserRef;
  body: string;
  createdAt: Date;
}

export interface ComparisonReport {
  id: string | null;
  name: string;
  createdAt: Date;
  createdBy: BacktestUserRef;
  filters?: ComparisonFilters | null;
  runs: ComparisonReportRun[];
  notes?: ComparisonReportNote[];
  summary?: ComparisonReportSummary;
}

export interface CreateComparisonReportRequest {
  name: string;
  runIds: string[];
  filters?: ComparisonFilters;
}

export interface ComparisonReportResponse extends ComparisonReport {}
