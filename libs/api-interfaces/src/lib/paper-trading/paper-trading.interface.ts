/**
 * Paper Trading Shared Interfaces
 * Used by both API and frontend for type consistency
 */

export enum PaperTradingStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export enum PaperTradingOrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum PaperTradingOrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT'
}

export enum PaperTradingOrderStatus {
  PENDING = 'PENDING',
  FILLED = 'FILLED',
  PARTIAL = 'PARTIAL',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED'
}

export enum PaperTradingSignalType {
  ENTRY = 'ENTRY',
  EXIT = 'EXIT',
  ADJUSTMENT = 'ADJUSTMENT',
  RISK_CONTROL = 'RISK_CONTROL'
}

export enum PaperTradingSignalDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
  FLAT = 'FLAT'
}

export interface StopConditions {
  maxDrawdown?: number;
  targetReturn?: number;
}

export interface SnapshotHolding {
  quantity: number;
  value: number;
  price: number;
  averageCost?: number;
  unrealizedPnL?: number;
  unrealizedPnLPercent?: number;
}

export interface PaperTradingSessionSummary {
  id: string;
  name: string;
  status: PaperTradingStatus;
  initialCapital: number;
  currentPortfolioValue?: number;
  totalReturn?: number;
  maxDrawdown?: number;
  totalTrades: number;
  algorithmName: string;
  exchangeName: string;
  createdAt: string;
  startedAt?: string;
}

export interface PaperTradingSessionDetail extends PaperTradingSessionSummary {
  description?: string;
  peakPortfolioValue?: number;
  sharpeRatio?: number;
  winRate?: number;
  winningTrades: number;
  losingTrades: number;
  tradingFee: number;
  pipelineId?: string;
  duration?: string;
  stopConditions?: StopConditions;
  stoppedReason?: string;
  algorithmConfig?: Record<string, unknown>;
  tickIntervalMs: number;
  lastTickAt?: string;
  tickCount: number;
  errorMessage?: string;
  pausedAt?: string;
  stoppedAt?: string;
  completedAt?: string;
  algorithmId: string;
  exchangeKeyId: string;
}

export interface PaperTradingBalance {
  currency: string;
  available: number;
  locked: number;
  total: number;
  averageCost?: number;
  marketValue?: number;
  unrealizedPnL?: number;
}

export interface PaperTradingOrder {
  id: string;
  side: PaperTradingOrderSide;
  orderType: PaperTradingOrderType;
  status: PaperTradingOrderStatus;
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  requestedQuantity: number;
  filledQuantity: number;
  executedPrice?: number;
  slippageBps?: number;
  fee: number;
  totalValue?: number;
  realizedPnL?: number;
  realizedPnLPercent?: number;
  createdAt: string;
  executedAt?: string;
  signalId?: string;
}

export interface PaperTradingSignal {
  id: string;
  signalType: PaperTradingSignalType;
  direction: PaperTradingSignalDirection;
  instrument: string;
  quantity: number;
  price?: number;
  confidence?: number;
  reason?: string;
  processed: boolean;
  createdAt: string;
  processedAt?: string;
}

export interface PaperTradingSnapshot {
  id: string;
  portfolioValue: number;
  cashBalance: number;
  holdings: Record<string, SnapshotHolding>;
  cumulativeReturn: number;
  drawdown: number;
  unrealizedPnL?: number;
  realizedPnL?: number;
  timestamp: string;
}

export interface PaperTradingPosition {
  symbol: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

export interface PaperTradingMetrics {
  initialCapital: number;
  currentPortfolioValue: number;
  totalReturn: number;
  totalReturnPercent: number;
  maxDrawdown: number;
  sharpeRatio?: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageWin?: number;
  averageLoss?: number;
  profitFactor?: number;
  totalFees: number;
  durationHours: number;
}

export interface PaperTradingListResponse {
  data: PaperTradingSessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

// WebSocket event payloads
export interface PaperTradingTickEvent {
  sessionId: string;
  timestamp: string;
  prices: Record<string, number>;
  portfolioValue: number;
  tickCount: number;
}

export interface PaperTradingOrderEvent {
  sessionId: string;
  order: PaperTradingOrder;
}

export interface PaperTradingBalanceEvent {
  sessionId: string;
  balances: PaperTradingBalance[];
}

export interface PaperTradingMetricsEvent {
  sessionId: string;
  metrics: Partial<PaperTradingMetrics>;
}

export interface PaperTradingStatusEvent {
  sessionId: string;
  status: PaperTradingStatus;
  reason?: string;
  timestamp: string;
}

// Pipeline integration types
export interface PipelineStartParams {
  pipelineId: string;
  algorithmId: string;
  exchangeKeyId: string;
  initialCapital: number;
  optimizedParameters: Record<string, number>;
  duration: string;
  stopConditions?: StopConditions;
}

export interface SessionStatusResponse {
  status: PaperTradingStatus;
  metrics: PaperTradingMetrics;
  stoppedReason?: string;
}
