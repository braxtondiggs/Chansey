/**
 * Parameter Space Interface
 * Defines the searchable parameter space for strategy optimization
 */

/**
 * Defines a single parameter that can be optimized
 */
export interface ParameterDefinition {
  /** Parameter name (must match strategy config property) */
  name: string;

  /** Parameter type determines how values are generated */
  type: 'integer' | 'float' | 'categorical';

  /** Minimum value (for numeric types) */
  min?: number;

  /** Maximum value (for numeric types) */
  max?: number;

  /** Step size between values (for numeric types) */
  step?: number;

  /** Possible values (for categorical types) */
  values?: (string | number | boolean)[];

  /** Default value used as baseline */
  default: number | string | boolean;

  /** Priority affects search order and early stopping decisions */
  priority: 'high' | 'medium' | 'low';

  /** Human-readable description */
  description?: string;
}

/**
 * Constraint between parameters
 * Used to eliminate invalid parameter combinations
 */
export interface ParameterConstraint {
  /** Constraint type */
  type: 'less_than' | 'greater_than' | 'not_equal' | 'custom';

  /** First parameter name */
  param1: string;

  /** Second parameter name (for comparison constraints) */
  param2?: string;

  /** Fixed value to compare against */
  value?: number;

  /** Custom validation function (for 'custom' type) */
  customValidator?: (params: Record<string, unknown>) => boolean;

  /** Error message when constraint is violated */
  message?: string;
}

/**
 * Complete parameter space for a strategy
 */
export interface ParameterSpace {
  /** Strategy type identifier */
  strategyType: string;

  /** List of optimizable parameters */
  parameters: ParameterDefinition[];

  /** Constraints between parameters */
  constraints?: ParameterConstraint[];

  /** Version for tracking parameter space changes */
  version?: string;
}

/**
 * A single parameter combination to test
 */
export interface ParameterCombination {
  /** Index in the full combination list */
  index: number;

  /** Parameter values */
  values: Record<string, number | string | boolean>;

  /** Whether this is the baseline (default) combination */
  isBaseline: boolean;
}
