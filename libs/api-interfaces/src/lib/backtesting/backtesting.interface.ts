// Re-export enums from backend entities
export enum BacktestStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum BacktestType {
  HISTORICAL = 'HISTORICAL',
  LIVE_REPLAY = 'LIVE_REPLAY',
  PAPER_TRADING = 'PAPER_TRADING',
  STRATEGY_OPTIMIZATION = 'STRATEGY_OPTIMIZATION'
}

export enum SignalType {
  ENTRY = 'ENTRY',
  EXIT = 'EXIT',
  ADJUSTMENT = 'ADJUSTMENT',
  RISK_CONTROL = 'RISK_CONTROL'
}

export enum SignalDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
  FLAT = 'FLAT'
}

export enum SimulatedOrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT'
}

export enum SimulatedOrderStatus {
  FILLED = 'FILLED',
  PARTIAL = 'PARTIAL',
  CANCELLED = 'CANCELLED'
}

export enum MarketDataSource {
  EXCHANGE_STREAM = 'EXCHANGE_STREAM',
  VENDOR_FEED = 'VENDOR_FEED',
  INTERNAL_CAPTURE = 'INTERNAL_CAPTURE'
}

export enum MarketDataTimeframe {
  TICK = 'TICK',
  SECOND = 'SECOND',
  MINUTE = 'MINUTE',
  HOUR = 'HOUR',
  DAY = 'DAY'
}

// Backward compatibility type alias
export type BacktestMode = 'historical' | 'live_replay';

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
  signalType: SignalType;
  instrument: string;
  direction: SignalDirection;
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
  type?: BacktestType; // Added for consistency with BacktestRunDetail
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
  type: BacktestType;
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

export type ComparisonReportResponse = ComparisonReport;
