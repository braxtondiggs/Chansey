/**
 * Scoring metrics interfaces for strategy evaluation
 */

export interface StrategyScore {
  id: string;
  strategyConfigId: string;
  overallScore: number; // 0-100
  componentScores: ComponentScores;
  percentile: number; // Rank percentile among all strategies (0-100)
  grade: StrategyGrade;
  promotionEligible: boolean;
  warnings: string[];
  calculatedAt: Date;
  effectiveDate: string; // Date for which score is valid
  backtestRunIds: string[]; // Array of BacktestRun IDs used
}

export interface ComponentScores {
  sharpeRatio: ScoringComponent;
  calmarRatio: ScoringComponent;
  winRate: ScoringComponent;
  profitFactor: ScoringComponent;
  wfaDegradation: ScoringComponent; // Walk-forward analysis degradation
  stability: ScoringComponent;
  correlation: ScoringComponent;
}

export interface ScoringComponent {
  value: number; // Actual metric value
  score: number; // Weighted score (0-100)
  weight: number; // Weight in overall score (0-1, sum to 1.0)
  percentile: number; // Percentile rank (0-100)
}

export enum StrategyGrade {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
  F = 'F'
}

/**
 * Scoring weights configuration
 */
export interface ScoringWeights {
  sharpeRatio: number; // Default: 0.25 (25%)
  calmarRatio: number; // Default: 0.15 (15%)
  winRate: number; // Default: 0.10 (10%)
  profitFactor: number; // Default: 0.10 (10%)
  wfaDegradation: number; // Default: 0.20 (20%)
  stability: number; // Default: 0.10 (10%)
  correlation: number; // Default: 0.10 (10%)
}

/**
 * Performance metric thresholds
 */
export interface MetricThresholds {
  sharpeRatio: {
    excellent: number; // > 2.0
    good: number; // > 1.0
    acceptable: number; // > 0.5
  };
  calmarRatio: {
    excellent: number; // > 2.0
    good: number; // > 1.0
    acceptable: number; // > 0.5
  };
  winRate: {
    excellent: number; // > 60%
    good: number; // > 50%
    acceptable: number; // > 45%
  };
  maxDrawdown: {
    excellent: number; // < 15%
    good: number; // < 25%
    acceptable: number; // < 40%
  };
  wfaDegradation: {
    excellent: number; // < 10%
    good: number; // < 20%
    acceptable: number; // < 30%
  };
}

/**
 * Grade calculation ranges
 */
export const GRADE_RANGES = {
  A: { min: 85, max: 100 },
  B: { min: 70, max: 84 },
  C: { min: 55, max: 69 },
  D: { min: 40, max: 54 },
  F: { min: 0, max: 39 }
} as const;
