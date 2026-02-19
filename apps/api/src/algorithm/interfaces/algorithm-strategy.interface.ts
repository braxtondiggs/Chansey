import { AlgorithmContext } from './algorithm-context.interface';
import { AlgorithmResult } from './algorithm-result.interface';

import { ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { Algorithm } from '../algorithm.entity';

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
   * Health check for the algorithm
   */
  healthCheck?(): Promise<boolean>;
}
