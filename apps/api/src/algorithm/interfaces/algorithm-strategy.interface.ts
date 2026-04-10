import { type AlgorithmContext } from './algorithm-context.interface';
import { type AlgorithmResult } from './algorithm-result.interface';

import { type ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { type Algorithm } from '../algorithm.entity';
import { type IndicatorRequirement } from '../indicators/indicator-requirements.interface';

/**
 * Base interface for all algorithm strategies
 * This defines the contract that all algorithm implementations must follow
 */
export interface AlgorithmStrategy {
  /**
   * Unique identifier for the algorithm strategy
   */
  readonly id: string;

  /**
   * Human-readable name of the algorithm
   */
  readonly name: string;

  /**
   * Version of the algorithm implementation
   */
  readonly version: string;

  /**
   * Description of what the algorithm does
   */
  readonly description: string;

  /**
   * Initialize the algorithm with configuration
   * Called when the algorithm is first loaded
   */
  onInit(algorithm: Algorithm): Promise<void>;

  /**
   * Execute the algorithm with the given context
   * This is the main method that performs the algorithm logic
   */
  execute(context: AlgorithmContext): Promise<AlgorithmResult>;

  /**
   * Cleanup resources when the algorithm is being destroyed
   */
  onDestroy?(): Promise<void>;

  /**
   * Validate if the algorithm can run with the given context
   */
  canExecute(context: AlgorithmContext): boolean;

  /**
   * Get algorithm-specific configuration schema
   */
  getConfigSchema?(): Record<string, unknown>;

  /**
   * Get cross-parameter constraints for optimization.
   * Returns constraints like "fastPeriod must be less than slowPeriod".
   */
  getParameterConstraints?(): ParameterConstraint[];

  /**
   * Declare which technical indicators this strategy needs so the backtest
   * engine can precompute full series before the timestamp loop.
   */
  getIndicatorRequirements?(config: Record<string, unknown>): IndicatorRequirement[];

  /**
   * Return the minimum number of price data points (candles) this strategy
   * needs before it can produce meaningful signals.  Used by the backtest
   * engine to pre-filter coins and avoid per-timestamp "insufficient data" noise.
   */
  getMinDataPoints?(config: Record<string, unknown>): number;

  /**
   * Health check for the algorithm
   */
  healthCheck?(): Promise<boolean>;
}
