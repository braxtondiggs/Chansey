/**
 * Pipeline Orchestration DTOs
 *
 * Types and configuration for automatic pipeline orchestration.
 * Defines risk-based configuration matrix and job data structures.
 */

import { getMaxLeverage } from '@chansey/api-interfaces';

import {
  type HistoricalStageConfig,
  type LiveReplayStageConfig,
  type OptimizationStageConfig,
  type PaperTradingStageConfig,
  type PipelineStageConfig
} from '../../pipeline/interfaces';
import { DEFAULT_RISK_LEVEL } from '../../risk/risk.constants';

/**
 * Risk-based optimization configuration
 */
export interface RiskOptimizationConfig {
  /** Walk-forward training period in days */
  trainDays: number;
  /** Walk-forward testing period in days */
  testDays: number;
  /** Step size for rolling windows */
  stepDays: number;
  /** Maximum parameter combinations to test */
  maxCombinations: number;
  /** Maximum number of coins to include in optimization */
  maxCoins: number;
}

/**
 * Risk-based stop conditions for paper trading
 */
export interface RiskStopConditions {
  /** Stop if drawdown exceeds this percentage (e.g., 0.20 = 20%) */
  maxDrawdown: number;
  /** Stop if return reaches target (e.g., 0.30 = 30%) */
  targetReturn: number;
}

/**
 * Paper Trading Duration Matrix (Hard Time Cap)
 *
 * Maps user risk levels (1-5) to paper trading time cap.
 * All levels use 30d as a safety-net hard cap; the primary completion
 * gate is now the minimum trade count (see PAPER_TRADING_MIN_TRADES).
 *
 * | Level | Description      | Time Cap |
 * |-------|------------------|----------|
 * | 1     | Conservative     | 30 days  |
 * | 2     | Low-Moderate     | 30 days  |
 * | 3     | Moderate         | 30 days  |
 * | 4     | Moderate-High    | 30 days  |
 * | 5     | Aggressive       | 30 days  |
 */
export const PAPER_TRADING_DURATION: Record<number, string> = {
  1: '30d',
  2: '30d',
  3: '30d',
  4: '30d',
  5: '30d'
};

/**
 * Paper Trading Minimum Trade Count Matrix
 *
 * Maps user risk levels (1-5) to minimum trades required before
 * the paper trading session can complete. This is the primary
 * completion gate; duration acts as a hard time cap.
 *
 * | Level | Description      | Min Trades |
 * |-------|------------------|------------|
 * | 1     | Conservative     | 50         |
 * | 2     | Low-Moderate     | 45         |
 * | 3     | Moderate         | 40         |
 * | 4     | Moderate-High    | 35         |
 * | 5     | Aggressive       | 30         |
 */
export const PAPER_TRADING_MIN_TRADES: Record<number, number> = {
  1: 50, // Conservative - most trades for statistical confidence
  2: 45,
  3: 40, // Default
  4: 35,
  5: 30 // Aggressive - minimum for statistical confidence
};

/**
 * Insufficient-Signal Early Termination Matrix
 *
 * When a paper-trading session is clearly starved of signals, we terminate
 * it early as COMPLETED (with `stoppedReason = 'insufficient_signals'`) so
 * that the (user × algorithm) dedup lock is released and the orchestrator
 * can retry with fresh parameters.
 *
 * Evaluated AFTER safety (drawdown/target) but BEFORE the duration cap.
 *
 * | Level | Description      | Check After | Min Trades By Then |
 * |-------|------------------|-------------|--------------------|
 * | 1     | Conservative     | 7 days      | 3                  |
 * | 2     | Low-Moderate     | 6 days      | 3                  |
 * | 3     | Moderate         | 5 days      | 2                  |
 * | 4     | Moderate-High    | 5 days      | 2                  |
 * | 5     | Aggressive       | 4 days      | 2                  |
 */
export interface InsufficientSignalThreshold {
  /** Earliest day at which the gate can fire */
  checkAfterDays: number;
  /** Minimum trades required by the check-after day to avoid early termination */
  minTradesByThen: number;
}

export const INSUFFICIENT_SIGNAL_THRESHOLDS: Record<number, InsufficientSignalThreshold> = {
  1: { checkAfterDays: 7, minTradesByThen: 3 },
  2: { checkAfterDays: 6, minTradesByThen: 3 },
  3: { checkAfterDays: 5, minTradesByThen: 2 },
  4: { checkAfterDays: 5, minTradesByThen: 2 },
  5: { checkAfterDays: 4, minTradesByThen: 2 }
};

/**
 * Optimization Configuration Matrix
 *
 * Maps user risk levels (1-5) to optimization parameters.
 * Lower risk levels use longer training periods and more combinations.
 */
export const OPTIMIZATION_CONFIG: Record<number, RiskOptimizationConfig> = {
  1: { trainDays: 180, testDays: 90, stepDays: 45, maxCombinations: 75, maxCoins: 10 }, // Conservative
  2: { trainDays: 150, testDays: 60, stepDays: 30, maxCombinations: 60, maxCoins: 10 },
  3: { trainDays: 120, testDays: 45, stepDays: 30, maxCombinations: 50, maxCoins: 10 }, // Default
  4: { trainDays: 120, testDays: 45, stepDays: 21, maxCombinations: 40, maxCoins: 8 },
  5: { trainDays: 90, testDays: 45, stepDays: 21, maxCombinations: 30, maxCoins: 8 } // Aggressive
};

/**
 * Paper Trading Stop Conditions Matrix
 *
 * Maps user risk levels (1-5) to stop conditions.
 * Lower risk levels have tighter drawdown limits and lower target returns.
 *
 * | Level | Description      | Max Drawdown | Target Return |
 * |-------|------------------|--------------|---------------|
 * | 1     | Conservative     | 15%          | 25%           |
 * | 2     | Low-Moderate     | 20%          | 40%           |
 * | 3     | Moderate         | 25%          | 50%           |
 * | 4     | Moderate-High    | 35%          | 75%           |
 * | 5     | Aggressive       | 40%          | 100%          |
 */
export const STOP_CONDITIONS_CONFIG: Record<number, RiskStopConditions> = {
  1: { maxDrawdown: 0.15, targetReturn: 0.25 }, // Conservative - tight stops
  2: { maxDrawdown: 0.2, targetReturn: 0.4 },
  3: { maxDrawdown: 0.25, targetReturn: 0.5 }, // Default
  4: { maxDrawdown: 0.35, targetReturn: 0.75 },
  5: { maxDrawdown: 0.4, targetReturn: 1.0 } // Aggressive - wide stops
};

/** Standard capital for all orchestrated pipelines (USD) */
export const PIPELINE_STANDARD_CAPITAL = 10000;

/** Stagger interval between users in milliseconds (1 minute) */
export const PIPELINE_STAGGER_INTERVAL_MS = 60_000;

/** Standard trading fee for all stages */
export const STANDARD_TRADING_FEE = 0.001;

/**
 * Job data passed to the pipeline orchestration queue processor
 */
export interface PipelineOrchestrationJobData {
  /** User ID to process */
  userId: string;
  /** ISO timestamp when the job was scheduled */
  scheduledAt: string;
  /** User's risk level (used for config lookup) */
  riskLevel: number;
}

/**
 * Information about a skipped strategy config
 */
export interface SkippedStrategyConfig {
  /** Strategy config ID that was skipped */
  strategyConfigId: string;
  /** Strategy config name for logging */
  strategyName: string;
  /** Reason the strategy was skipped */
  reason: string;
}

/**
 * Result of pipeline orchestration for a single user
 */
export interface PipelineOrchestrationResult {
  /** User ID that was processed */
  userId: string;
  /** Number of pipelines successfully created */
  pipelinesCreated: number;
  /** IDs of created pipelines */
  pipelineIds: string[];
  /** Strategy configs that were skipped with reasons */
  skippedConfigs: SkippedStrategyConfig[];
  /** Any errors encountered during orchestration */
  errors: string[];
}

/**
 * Get paper trading duration for a given risk level
 * Falls back to default (level 3) if level is invalid
 */
export function getPaperTradingDuration(riskLevel: number): string {
  return PAPER_TRADING_DURATION[riskLevel] ?? PAPER_TRADING_DURATION[DEFAULT_RISK_LEVEL];
}

/**
 * Get paper trading minimum trade count for a given risk level
 * Falls back to default (level 3) if level is invalid
 */
export function getPaperTradingMinTrades(riskLevel: number): number {
  return PAPER_TRADING_MIN_TRADES[riskLevel] ?? PAPER_TRADING_MIN_TRADES[DEFAULT_RISK_LEVEL];
}

/**
 * Get the insufficient-signal early-termination threshold for a given risk level
 * Falls back to default (level 3) if level is missing/invalid
 */
export function getInsufficientSignalThreshold(riskLevel?: number | null): InsufficientSignalThreshold {
  const level = riskLevel ?? DEFAULT_RISK_LEVEL;
  return INSUFFICIENT_SIGNAL_THRESHOLDS[level] ?? INSUFFICIENT_SIGNAL_THRESHOLDS[DEFAULT_RISK_LEVEL];
}

/**
 * Get optimization config for a given risk level
 * Falls back to default (level 3) if level is invalid
 */
export function getOptimizationConfig(riskLevel: number): RiskOptimizationConfig {
  return OPTIMIZATION_CONFIG[riskLevel] ?? OPTIMIZATION_CONFIG[DEFAULT_RISK_LEVEL];
}

/**
 * Get stop conditions for a given risk level
 * Falls back to default (level 3) if level is invalid
 */
export function getStopConditions(riskLevel: number): RiskStopConditions {
  return STOP_CONDITIONS_CONFIG[riskLevel] ?? STOP_CONDITIONS_CONFIG[DEFAULT_RISK_LEVEL];
}

/**
 * Build complete stage configuration for a pipeline based on risk level
 */
export function buildStageConfigFromRisk(riskLevel: number): PipelineStageConfig {
  const optimizationConfig = getOptimizationConfig(riskLevel);
  const paperTradingDuration = getPaperTradingDuration(riskLevel);
  const stopConditions = getStopConditions(riskLevel);
  const minTrades = getPaperTradingMinTrades(riskLevel);

  // Calculate date ranges
  const now = new Date();
  const historicalEndDate = new Date(now);
  historicalEndDate.setMonth(historicalEndDate.getMonth() - 1); // End 1 month ago
  const historicalStartDate = new Date(historicalEndDate);
  historicalStartDate.setMonth(historicalStartDate.getMonth() - 3); // 3 months of historical data

  const liveReplayEndDate = new Date(now);
  const liveReplayStartDate = new Date(historicalEndDate); // Start from where historical ended

  const optimization: OptimizationStageConfig = {
    trainDays: optimizationConfig.trainDays,
    testDays: optimizationConfig.testDays,
    stepDays: optimizationConfig.stepDays,
    objectiveMetric: 'sortino_ratio',
    maxCombinations: optimizationConfig.maxCombinations,
    earlyStop: true,
    patience: 20,
    maxCoins: optimizationConfig.maxCoins
  };

  const historical: HistoricalStageConfig = {
    startDate: historicalStartDate.toISOString(),
    endDate: historicalEndDate.toISOString(),
    initialCapital: PIPELINE_STANDARD_CAPITAL,
    tradingFee: STANDARD_TRADING_FEE
  };

  const liveReplay: LiveReplayStageConfig = {
    startDate: liveReplayStartDate.toISOString(),
    endDate: liveReplayEndDate.toISOString(),
    initialCapital: PIPELINE_STANDARD_CAPITAL,
    tradingFee: STANDARD_TRADING_FEE,
    enablePacing: false,
    pacingSpeed: 1
  };

  const paperTrading: PaperTradingStageConfig = {
    initialCapital: PIPELINE_STANDARD_CAPITAL,
    duration: paperTradingDuration,
    tradingFee: STANDARD_TRADING_FEE,
    stopConditions,
    minTrades
  };

  return {
    optimization,
    historical,
    liveReplay,
    paperTrading
  };
}

/**
 * Get maximum leverage allowed for a given risk level
 * Delegates to the shared getMaxLeverage utility from @chansey/api-interfaces
 */
export function getLeverageConfig(riskLevel: number): number {
  return getMaxLeverage(riskLevel);
}
