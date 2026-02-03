/**
 * Pipeline Orchestration DTOs
 *
 * Types and configuration for automatic pipeline orchestration.
 * Defines risk-based configuration matrix and job data structures.
 */

import {
  HistoricalStageConfig,
  LiveReplayStageConfig,
  OptimizationStageConfig,
  PaperTradingStageConfig,
  PipelineStageConfig
} from '../../pipeline/interfaces';

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
 * Paper Trading Duration Matrix
 *
 * Maps user risk levels (1-5) to paper trading duration.
 * Lower risk levels use longer validation periods.
 *
 * | Level | Description      | Duration |
 * |-------|------------------|----------|
 * | 1     | Conservative     | 14 days  |
 * | 2     | Low-Moderate     | 10 days  |
 * | 3     | Moderate         | 7 days   |
 * | 4     | Moderate-High    | 5 days   |
 * | 5     | Aggressive       | 3 days   |
 */
export const PAPER_TRADING_DURATION: Record<number, string> = {
  1: '14d', // Conservative - longest validation
  2: '10d',
  3: '7d', // Moderate - default
  4: '5d',
  5: '3d' // Aggressive - shortest validation
};

/**
 * Optimization Configuration Matrix
 *
 * Maps user risk levels (1-5) to optimization parameters.
 * Lower risk levels use longer training periods and more combinations.
 */
export const OPTIMIZATION_CONFIG: Record<number, RiskOptimizationConfig> = {
  1: { trainDays: 180, testDays: 60, stepDays: 30, maxCombinations: 1000 }, // Conservative
  2: { trainDays: 120, testDays: 45, stepDays: 21, maxCombinations: 750 },
  3: { trainDays: 90, testDays: 30, stepDays: 14, maxCombinations: 500 }, // Default
  4: { trainDays: 60, testDays: 21, stepDays: 10, maxCombinations: 300 },
  5: { trainDays: 30, testDays: 14, stepDays: 7, maxCombinations: 200 } // Aggressive
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
 * | 2     | Low-Moderate     | 20%          | 35%           |
 * | 3     | Moderate         | 25%          | 50%           |
 * | 4     | Moderate-High    | 30%          | 75%           |
 * | 5     | Aggressive       | 40%          | 100%          |
 */
export const STOP_CONDITIONS_CONFIG: Record<number, RiskStopConditions> = {
  1: { maxDrawdown: 0.15, targetReturn: 0.25 }, // Conservative - tight stops
  2: { maxDrawdown: 0.2, targetReturn: 0.35 },
  3: { maxDrawdown: 0.25, targetReturn: 0.5 }, // Default
  4: { maxDrawdown: 0.3, targetReturn: 0.75 },
  5: { maxDrawdown: 0.4, targetReturn: 1.0 } // Aggressive - wide stops
};

/** Default risk level when user's risk level is not set */
export const DEFAULT_RISK_LEVEL = 3;

/** Standard capital for all orchestrated pipelines (USD) */
export const PIPELINE_STANDARD_CAPITAL = 10000;

/** Stagger interval between users in milliseconds (1 minute) */
export const STAGGER_INTERVAL_MS = 60_000;

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
    objectiveMetric: 'sharpe_ratio',
    maxCombinations: optimizationConfig.maxCombinations,
    earlyStop: true,
    patience: 20
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
    stopConditions
  };

  return {
    optimization,
    historical,
    liveReplay,
    paperTrading
  };
}
