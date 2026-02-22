export enum AlgorithmStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  MAINTENANCE = 'maintenance',
  ERROR = 'error'
}

export enum AlgorithmCategory {
  TECHNICAL = 'technical',
  FUNDAMENTAL = 'fundamental',
  SENTIMENT = 'sentiment',
  HYBRID = 'hybrid',
  CUSTOM = 'custom'
}

export interface AlgorithmConfig {
  parameters?: Record<string, unknown>;
  settings?: {
    timeout?: number;
    retries?: number;
    enableLogging?: boolean;
  };
  metadata?: Record<string, unknown>;
}

export interface AlgorithmMetrics {
  totalExecutions?: number;
  successfulExecutions?: number;
  failedExecutions?: number;
  successRate?: number;
  averageExecutionTime?: number;
  lastExecuted?: string;
  lastError?: string;
  errorCount?: number;
}

export interface Algorithm {
  id: string;
  name: string;
  slug: string;
  strategyId?: string;
  service?: string;
  description?: string;
  category: AlgorithmCategory;
  status: AlgorithmStatus;
  evaluate: boolean;
  weight?: number;
  cron: string;
  config?: AlgorithmConfig;
  metrics?: AlgorithmMetrics;
  version?: string;
  author?: string;
  isFavorite: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlgorithmStrategy {
  id: string;
  name: string;
  className: string;
  version: string;
  description: string;
  configSchema?: Record<string, unknown>;
}

export interface AlgorithmDetailResponse extends Algorithm {
  strategy?: AlgorithmStrategy | null;
  hasStrategy: boolean;
}

export interface CreateAlgorithmDto {
  name: string;
  description?: string;
  strategyId?: string;
  service?: string;
  category?: AlgorithmCategory;
  status?: AlgorithmStatus;
  evaluate?: boolean;
  cron?: string;
  version?: string;
  author?: string;
}

export interface UpdateAlgorithmDto {
  id: string;
  name?: string;
  description?: string;
  strategyId?: string;
  service?: string;
  category?: AlgorithmCategory;
  status?: AlgorithmStatus;
  evaluate?: boolean;
  cron?: string;
  version?: string;
  author?: string;
}

export interface AlgorithmDrawerSaveEvent {
  id: string | null;
  data: CreateAlgorithmDto & { service?: string };
}

export interface AlgorithmActivation {
  id: string;
  userId: string;
  algorithmId: string;
  exchangeKeyId: string;
  isActive: boolean;
  allocationPercentage: number;
  config?: Record<string, unknown>;
  activatedAt?: Date;
  deactivatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  algorithm?: Algorithm;
}

export interface AlgorithmPerformance {
  id: string;
  algorithmActivationId: string;
  userId: string;
  roi?: number;
  winRate?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  totalTrades: number;
  riskAdjustedReturn?: number;
  volatility?: number;
  alpha?: number;
  beta?: number;
  rank?: number;
  calculatedAt: Date;
  createdAt: Date;
}

export interface PerformanceMetrics {
  roi?: number;
  winRate?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  totalTrades: number;
  volatility?: number;
  alpha?: number;
  beta?: number;
  rank?: number;
}

export enum TradingSignalType {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD'
}

export interface TradingSignal {
  type: TradingSignalType;
  coinId: string;
  strength: number;
  price: number;
  confidence: number;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface ChartDataPoint {
  timestamp: Date;
  value: number;
  label?: string;
}

export interface AlgorithmExecutionResult {
  success: boolean;
  signals: TradingSignal[];
  chartData?: ChartDataPoint[];
  metadata?: Record<string, unknown>;
  error?: string;
  metrics: {
    executionTime: number;
    signalsGenerated: number;
    confidence: number;
  };
  timestamp: Date;
}

export interface AlgorithmExecutionResponse {
  algorithm: {
    id: string;
    name: string;
    service: string;
  };
  execution: AlgorithmExecutionResult;
  context: {
    timestamp: Date;
    coinsAnalyzed: number;
    priceDataPoints: number;
  };
}
