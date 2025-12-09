import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

/**
 * RiskCheckResult
 *
 * Result of a single risk check
 */
export interface RiskCheckResult {
  /** Risk check name/identifier */
  checkName: string;

  /** Whether the check passed (no risk breach) */
  passed: boolean;

  /** Actual value that was checked */
  actualValue: number | string;

  /** Threshold/limit value */
  threshold: number | string;

  /** Severity of the risk if breached */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Human-readable message */
  message: string;

  /** Recommended action if check failed */
  recommendedAction?: string;

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * IRiskCheck Interface
 *
 * All risk checks must implement this interface.
 * Each check monitors one specific risk metric for deployed strategies.
 *
 * Risk checks are evaluated periodically (e.g., hourly) and on-demand.
 */
export interface IRiskCheck {
  /** Unique check identifier */
  readonly name: string;

  /** Check description */
  readonly description: string;

  /** Check priority (lower = checked first) */
  readonly priority: number;

  /** Whether this check should trigger automatic demotion */
  readonly autoDemote: boolean;

  /**
   * Evaluate the risk check
   * @param deployment - Deployment to check
   * @param latestMetric - Latest performance metric
   * @param historicalMetrics - Historical metrics for trend analysis
   * @returns Risk check result
   */
  evaluate(
    deployment: Deployment,
    latestMetric: PerformanceMetric | null,
    historicalMetrics?: PerformanceMetric[]
  ): Promise<RiskCheckResult>;
}

/**
 * RiskEvaluation
 *
 * Result of evaluating all risk checks for a deployment
 */
export interface RiskEvaluation {
  /** Deployment ID */
  deploymentId: string;

  /** Timestamp of evaluation */
  evaluatedAt: Date;

  /** Whether any critical risks were detected */
  hasCriticalRisk: boolean;

  /** Whether automatic demotion is recommended */
  shouldDemote: boolean;

  /** Individual check results */
  checkResults: RiskCheckResult[];

  /** Total checks performed */
  totalChecks: number;

  /** Number of checks passed */
  checksPassed: number;

  /** Number of checks failed */
  checksFailed: number;

  /** List of failed check names */
  failedChecks: string[];

  /** Summary message */
  summary: string;

  /** Recommended actions */
  recommendedActions: string[];
}
