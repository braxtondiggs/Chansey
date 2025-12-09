/**
 * Walk-Forward Analysis Configuration
 * Default settings and validation rules
 */

export interface WalkForwardAnalysisConfig {
  // Window configuration
  trainDays: number;
  testDays: number;
  stepDays: number;
  method: 'rolling' | 'anchored';

  // Degradation thresholds
  maxAcceptableDegradation: number; // Percentage (e.g., 30%)
  criticalDegradationThreshold: number; // Percentage (e.g., 50%)

  // Overfitting detection
  minTrainPeriodDays: number;
  minTestPeriodDays: number;
  maxOverfittingWindowsAllowed: number; // Max number of overfitting windows before rejection

  // Consistency requirements
  minConsistencyScore: number; // 0-100 scale
  maxDegradationVariance: number; // Standard deviation threshold

  // Performance requirements
  minWindowsRequired: number; // Minimum number of windows for statistical significance
}

/**
 * Default walk-forward configuration
 * Based on research.md recommendations
 */
export const DEFAULT_WALK_FORWARD_CONFIG: WalkForwardAnalysisConfig = {
  // Window settings (from research.md: 180-day train, 90-day test, 30-day step)
  trainDays: 180,
  testDays: 90,
  stepDays: 30,
  method: 'rolling',

  // Degradation thresholds
  maxAcceptableDegradation: 30, // 30% max degradation (from research.md)
  criticalDegradationThreshold: 50, // 50% triggers automatic rejection

  // Overfitting detection
  minTrainPeriodDays: 30, // Minimum for statistical significance
  minTestPeriodDays: 14, // Minimum for meaningful testing
  maxOverfittingWindowsAllowed: 2, // Allow 2 bad windows out of many

  // Consistency requirements
  minConsistencyScore: 60, // 60/100 minimum consistency
  maxDegradationVariance: 25, // Max standard deviation of degradation

  // Performance requirements
  minWindowsRequired: 3 // Need at least 3 windows for validation
};

/**
 * Aggressive walk-forward configuration
 * For strategies that need more rigorous testing
 */
export const AGGRESSIVE_WALK_FORWARD_CONFIG: WalkForwardAnalysisConfig = {
  trainDays: 365, // Full year training
  testDays: 90,
  stepDays: 30,
  method: 'rolling',
  maxAcceptableDegradation: 20, // Stricter degradation limit
  criticalDegradationThreshold: 35,
  minTrainPeriodDays: 60,
  minTestPeriodDays: 21,
  maxOverfittingWindowsAllowed: 1,
  minConsistencyScore: 70,
  maxDegradationVariance: 20,
  minWindowsRequired: 5
};

/**
 * Fast walk-forward configuration
 * For quick validation during development
 */
export const FAST_WALK_FORWARD_CONFIG: WalkForwardAnalysisConfig = {
  trainDays: 90,
  testDays: 30,
  stepDays: 15,
  method: 'rolling',
  maxAcceptableDegradation: 40, // More lenient
  criticalDegradationThreshold: 60,
  minTrainPeriodDays: 30,
  minTestPeriodDays: 7,
  maxOverfittingWindowsAllowed: 3,
  minConsistencyScore: 50,
  maxDegradationVariance: 30,
  minWindowsRequired: 2
};
