/**
 * Optimization Configuration Interface
 * Defines how parameter optimization should be executed
 */

/**
 * Optimization objective configuration
 */
export interface OptimizationObjective {
  /** Primary metric to optimize */
  metric: 'sharpe_ratio' | 'total_return' | 'calmar_ratio' | 'profit_factor' | 'sortino_ratio' | 'composite';

  /** Weights for composite metric optimization */
  weights?: {
    sharpeRatio?: number;
    totalReturn?: number;
    calmarRatio?: number;
    profitFactor?: number;
    maxDrawdown?: number;
    winRate?: number;
  };

  /** Whether to minimize (true) or maximize (false) the objective */
  minimize: boolean;
}

/**
 * Walk-forward configuration for optimization
 */
export interface OptimizationWalkForwardConfig {
  /** Training period in days */
  trainDays: number;

  /** Testing period in days */
  testDays: number;

  /** Step size between windows in days */
  stepDays: number;

  /** Window generation method */
  method: 'rolling' | 'anchored';

  /** Minimum number of windows required for valid optimization */
  minWindowsRequired: number;

  /** Maximum acceptable degradation percentage */
  maxAcceptableDegradation?: number;
}

/**
 * Early stopping configuration
 */
export interface EarlyStopConfig {
  /** Whether early stopping is enabled */
  enabled: boolean;

  /** Stop if no improvement after this many combinations */
  patience: number;

  /** Minimum improvement threshold (percentage) to reset patience */
  minImprovement: number;
}

/**
 * Parallelism configuration
 */
export interface ParallelismConfig {
  /** Maximum concurrent backtests */
  maxConcurrentBacktests: number;

  /** Maximum concurrent windows per backtest */
  maxConcurrentWindows: number;
}

/**
 * Complete optimization configuration
 */
export interface OptimizationConfig {
  /** Search method */
  method: 'grid_search' | 'random_search' | 'adaptive_search';

  /** Maximum iterations for random search and adaptive search */
  maxIterations?: number;

  /** Maximum combinations to test for grid search */
  maxCombinations?: number;

  /** Walk-forward analysis configuration */
  walkForward: OptimizationWalkForwardConfig;

  /** Optimization objective */
  objective: OptimizationObjective;

  /** Early stopping configuration */
  earlyStop?: EarlyStopConfig;

  /** Parallelism configuration */
  parallelism: ParallelismConfig;

  /** Date range for backtesting */
  dateRange?: {
    startDate: Date;
    endDate: Date;
  };

  /** Maximum number of coins to include in optimization (only coins with OHLC data) */
  maxCoins?: number;

  /** User risk level (1-5) for regime gate derivation. Default: 3 */
  riskLevel?: number;

  /**
   * Deterministic seed for random/adaptive search. When omitted, a fresh seed is generated
   * at run creation and persisted into the saved config so the run can replay deterministically.
   */
  seed?: number;
}

/**
 * Fast optimization configuration for development/testing
 */
export const FAST_OPTIMIZATION_CONFIG: OptimizationConfig = {
  method: 'grid_search',
  maxCombinations: 20,
  walkForward: {
    trainDays: 90,
    testDays: 30,
    stepDays: 30,
    method: 'rolling',
    minWindowsRequired: 2,
    maxAcceptableDegradation: 40
  },
  objective: {
    metric: 'sharpe_ratio',
    minimize: false
  },
  earlyStop: {
    enabled: true,
    patience: 10,
    minImprovement: 2
  },
  parallelism: {
    maxConcurrentBacktests: 5,
    maxConcurrentWindows: 3
  }
};

/**
 * Thorough optimization configuration for production.
 *
 * Uses adaptive_search to bias sampling toward neighborhoods of top results once
 * history accumulates — pure random produced 0.2-0.8% robust-combo yield in past runs.
 * `maxIterations` rather than `maxCombinations` controls budget for adaptive sampling.
 *
 * `seed` is left undefined here — the orchestrator generates and persists a fresh seed per run
 * into `run.config.seed`, making each run reproducible from its stored config.
 */
export const THOROUGH_OPTIMIZATION_CONFIG: OptimizationConfig = {
  method: 'adaptive_search',
  maxIterations: 5000,
  maxCombinations: 5000,
  walkForward: {
    trainDays: 365,
    testDays: 90,
    stepDays: 30,
    method: 'rolling',
    minWindowsRequired: 5,
    maxAcceptableDegradation: 25
  },
  objective: {
    metric: 'composite',
    weights: {
      sharpeRatio: 0.3,
      totalReturn: 0.25,
      calmarRatio: 0.15,
      profitFactor: 0.15,
      maxDrawdown: 0.1,
      winRate: 0.05
    },
    minimize: false
  },
  earlyStop: {
    enabled: true,
    patience: 100,
    minImprovement: 0.5
  },
  parallelism: {
    maxConcurrentBacktests: 3,
    maxConcurrentWindows: 3
  }
};
