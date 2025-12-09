import { BacktestRun } from '../entities/backtest-run.entity';
import { StrategyConfig } from '../entities/strategy-config.entity';
import { StrategyScore } from '../entities/strategy-score.entity';

/**
 * PromotionGateResult
 *
 * Result of a single gate check
 */
export interface PromotionGateResult {
  /** Gate name/identifier */
  gateName: string;

  /** Whether the gate passed */
  passed: boolean;

  /** Actual value that was checked */
  actualValue: number | string | boolean;

  /** Required/threshold value */
  requiredValue: number | string | boolean;

  /** Human-readable message */
  message: string;

  /** Severity if gate failed (warning vs critical) */
  severity?: 'warning' | 'critical';

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * PromotionGate Interface
 *
 * All promotion gates must implement this interface.
 * Each gate checks one specific criterion for strategy promotion.
 *
 * Gates are evaluated in sequence before allowing a strategy to go live.
 */
export interface IPromotionGate {
  /** Unique gate identifier */
  readonly name: string;

  /** Gate description */
  readonly description: string;

  /** Gate priority (lower = checked first) */
  readonly priority: number;

  /** Whether this gate is critical (failure blocks promotion) */
  readonly isCritical: boolean;

  /**
   * Evaluate the gate
   * @param strategyConfig - Strategy configuration
   * @param strategyScore - Latest strategy score
   * @param backtestRun - Latest backtest run
   * @param context - Additional context for gate evaluation
   * @returns Gate evaluation result
   */
  evaluate(
    strategyConfig: StrategyConfig,
    strategyScore: StrategyScore,
    backtestRun: BacktestRun,
    context?: PromotionGateContext
  ): Promise<PromotionGateResult>;
}

/**
 * PromotionGateContext
 *
 * Additional context for gate evaluation
 */
export interface PromotionGateContext {
  /** Existing deployments for correlation checks */
  existingDeployments?: any[];

  /** Current market regime */
  currentMarketRegime?: string;

  /** Total portfolio allocation */
  totalAllocation?: number;

  /** User-specific overrides */
  overrides?: Record<string, any>;
}

/**
 * PromotionGateEvaluation
 *
 * Result of evaluating all gates
 */
export interface PromotionGateEvaluation {
  /** Overall result - true if all critical gates passed */
  canPromote: boolean;

  /** Individual gate results */
  gateResults: PromotionGateResult[];

  /** Total gates checked */
  totalGates: number;

  /** Number of gates passed */
  gatesPassed: number;

  /** Number of gates failed */
  gatesFailed: number;

  /** List of failed gate names */
  failedGates: string[];

  /** Summary message */
  summary: string;

  /** Warnings (non-critical failures) */
  warnings: string[];
}
