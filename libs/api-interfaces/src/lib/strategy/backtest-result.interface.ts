/**
 * Backtest result interfaces extending existing backtest types
 */

export enum BacktestRunStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface BacktestRun {
  id: string;
  strategyConfigId: string;
  startedAt: Date;
  completedAt?: Date | null;
  status: BacktestRunStatus;
  config: BacktestConfiguration;
  datasetChecksum: string; // SHA-256 hash for reproducibility
  windowCount: number;
  results?: BacktestResults | null;
  errorMessage?: string | null;
  executionTimeMs?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BacktestConfiguration {
  startDate: string;
  endDate: string;
  walkForward?: WalkForwardConfig;
  initialCapital: number;
  slippageModel?: string;
  commissionModel?: string;
  [key: string]: any;
}

export interface WalkForwardConfig {
  trainDays: number;
  testDays: number;
  stepDays: number;
  method: 'rolling' | 'anchored';
}

export interface BacktestResults {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgTradeReturn: number;
  volatility: number;
  windows?: WalkForwardWindowResult[];
  [key: string]: any;
}

export interface WalkForwardWindowResult {
  id: string;
  backtestRunId: string;
  windowIndex: number;
  trainStartDate: string;
  trainEndDate: string;
  testStartDate: string;
  testEndDate: string;
  trainMetrics: WindowMetrics;
  testMetrics: WindowMetrics;
  degradation: number; // Percentage performance degradation from train to test
  createdAt: Date;
}

export interface WindowMetrics {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  /** Win rate as decimal (0.0 to 1.0), e.g., 0.65 = 65% win rate */
  winRate: number;
  tradeCount: number;
  profitFactor: number;
  volatility: number;
  /** Downside deviation for Sortino ratio calculation (standard deviation of negative returns only) */
  downsideDeviation?: number;
  [key: string]: any;
}

export interface StartBacktestDto {
  startDate: string;
  endDate: string;
  walkForwardConfig?: WalkForwardConfig;
  initialCapital?: number;
  additionalConfig?: Record<string, any>;
}
