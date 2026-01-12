/**
 * Backtest Orchestration DTOs
 *
 * Types and configuration for automatic backtest orchestration.
 * Defines risk-based configuration matrix and job data structures.
 */

import { MarketDataTimeframe } from '../../order/backtest/market-data-set.entity';
import { SlippageModelType } from '../../order/backtest/slippage-model';

/**
 * Risk-level based backtest configuration
 */
export interface RiskLevelConfig {
  /** Number of days to look back for historical data */
  lookbackDays: number;
  /** Type of slippage model to use */
  slippageModel: SlippageModelType;
  /** Slippage in basis points */
  slippageBps: number;
  /** Trading fee as decimal (e.g., 0.0015 = 0.15%) */
  tradingFee: number;
  /** Preferred timeframes for dataset selection */
  preferredTimeframes: MarketDataTimeframe[];
}

/**
 * Risk Configuration Matrix
 *
 * Maps user risk levels (1-5) to backtest configuration parameters.
 * Lower risk levels use longer lookback periods and more conservative slippage.
 *
 * | Level | Description      | Lookback | Slippage Model | BPS | Fee    | Timeframes         |
 * |-------|------------------|----------|----------------|-----|--------|-------------------|
 * | 1     | Conservative     | 180 days | volume-based   | 10  | 0.15%  | HOUR, DAY         |
 * | 2     | Low-Moderate     | 120 days | volume-based   | 8   | 0.12%  | HOUR, DAY         |
 * | 3     | Moderate         | 90 days  | fixed          | 5   | 0.10%  | MINUTE, HOUR      |
 * | 4     | Moderate-High    | 60 days  | fixed          | 5   | 0.10%  | MINUTE, HOUR      |
 * | 5     | Aggressive       | 30 days  | fixed          | 3   | 0.08%  | MINUTE, SECOND    |
 */
export const RISK_CONFIG_MATRIX: Record<number, RiskLevelConfig> = {
  1: {
    lookbackDays: 180,
    slippageModel: SlippageModelType.VOLUME_BASED,
    slippageBps: 10,
    tradingFee: 0.0015,
    preferredTimeframes: [MarketDataTimeframe.HOUR, MarketDataTimeframe.DAY]
  },
  2: {
    lookbackDays: 120,
    slippageModel: SlippageModelType.VOLUME_BASED,
    slippageBps: 8,
    tradingFee: 0.0012,
    preferredTimeframes: [MarketDataTimeframe.HOUR, MarketDataTimeframe.DAY]
  },
  3: {
    lookbackDays: 90,
    slippageModel: SlippageModelType.FIXED,
    slippageBps: 5,
    tradingFee: 0.001,
    preferredTimeframes: [MarketDataTimeframe.MINUTE, MarketDataTimeframe.HOUR]
  },
  4: {
    lookbackDays: 60,
    slippageModel: SlippageModelType.FIXED,
    slippageBps: 5,
    tradingFee: 0.001,
    preferredTimeframes: [MarketDataTimeframe.MINUTE, MarketDataTimeframe.HOUR]
  },
  5: {
    lookbackDays: 30,
    slippageModel: SlippageModelType.FIXED,
    slippageBps: 3,
    tradingFee: 0.0008,
    preferredTimeframes: [MarketDataTimeframe.MINUTE, MarketDataTimeframe.SECOND]
  }
};

/** Default risk level when user's risk level is not set */
export const DEFAULT_RISK_LEVEL = 3;

/** Minimum capital for orchestrated backtests (in USD) */
export const MIN_ORCHESTRATION_CAPITAL = 1000;

/** Minimum dataset integrity score for selection */
export const MIN_DATASET_INTEGRITY_SCORE = 70;

/** Stagger interval between users in milliseconds (30 seconds) */
export const STAGGER_INTERVAL_MS = 30_000;

/**
 * Job data passed to the orchestration queue processor
 */
export interface OrchestrationJobData {
  /** User ID to process */
  userId: string;
  /** ISO timestamp when the job was scheduled */
  scheduledAt: string;
  /** User's risk level (used for config lookup) */
  riskLevel: number;
}

/**
 * Result of orchestration for a single user
 */
export interface OrchestrationResult {
  /** User ID that was processed */
  userId: string;
  /** Number of backtests successfully created */
  backtestsCreated: number;
  /** IDs of created backtests */
  backtestIds: string[];
  /** Algorithms that were skipped with reasons */
  skippedAlgorithms: SkippedAlgorithm[];
  /** Any errors encountered during orchestration */
  errors: string[];
}

/**
 * Information about a skipped algorithm
 */
export interface SkippedAlgorithm {
  /** Algorithm ID that was skipped */
  algorithmId: string;
  /** Algorithm name for logging */
  algorithmName: string;
  /** Reason the algorithm was skipped */
  reason: string;
}

/**
 * Extended configSnapshot fields added for orchestrated backtests.
 * Merged with the base configSnapshot from BacktestService.createBacktest().
 */
export interface OrchestratedConfigSnapshot {
  /** Flag indicating this backtest was created by orchestration */
  orchestrated: true;
  /** ISO timestamp when orchestration created this backtest */
  orchestratedAt: string;
  /** User's risk level at time of orchestration */
  riskLevel: number;
  /** Allow additional fields from base configSnapshot */
  [key: string]: any;
}

/**
 * Get risk configuration for a given risk level
 * Falls back to default (level 3) if level is invalid
 */
export function getRiskConfig(riskLevel: number): RiskLevelConfig {
  return RISK_CONFIG_MATRIX[riskLevel] ?? RISK_CONFIG_MATRIX[DEFAULT_RISK_LEVEL];
}
