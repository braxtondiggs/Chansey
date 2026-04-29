import {
  type ParameterConstraint,
  type ParameterDefinition,
  type ParameterSpace
} from '../interfaces/parameter-space.interface';

/**
 * Shape of a single field from getConfigSchema()
 */
interface ConfigSchemaField {
  type: string;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  enum?: (string | number | boolean)[];
  description?: string;
}

/**
 * Control parameters that should not be optimized.
 * These affect execution behaviour, not strategy logic.
 */
const NON_OPTIMIZABLE_PARAMS = new Set(['enabled', 'riskLevel', 'cooldownMs', 'maxTradesPerDay', 'minSellPercent']);

/**
 * Step values traders actually pick in the wild — quarters, fifths, halves, integers.
 * Sorted ascending. The picker walks this list to find the largest step that still
 * yields a useful number of grid points, so float ranges land on natural anchors
 * (2.0, 0.5, 5%) instead of arbitrary values like 2.55 or 0.37.
 */
const NATURAL_STEPS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10] as const;

/**
 * Minimum number of grid points a chosen step should produce.
 * Below this we fall back to the previous (smaller) step so the grid stays useful.
 */
const MIN_GRID_POINTS = 8;

/**
 * Pick a "natural" step size for a float range.
 *
 * Walks NATURAL_STEPS from smallest to largest and returns the largest step that
 * still produces ≥ MIN_GRID_POINTS samples across `range`. Falls back to the
 * smallest natural step (0.005) if even that overshoots the floor — anchor
 * injection in the grid expander then ensures min/default/max are still reachable.
 *
 * The chosen step is also clamped to `range` when `range` is smaller than the
 * smallest natural step (e.g., 0.001), so the step never overshoots the field's
 * actual span — callers can rely on `step <= range` without an extra `Math.min`.
 */
export function chooseNaturalStep(range: number): number {
  if (!Number.isFinite(range) || range <= 0) return NATURAL_STEPS[0];

  let chosen: number = NATURAL_STEPS[0];
  for (const candidate of NATURAL_STEPS) {
    if (range / candidate >= MIN_GRID_POINTS) {
      chosen = candidate;
    } else {
      break;
    }
  }
  return Math.min(chosen, range);
}

/**
 * Check whether a schema field is worth optimizing.
 * - Numeric fields need both min and max with min < max
 * - Categorical fields (enum) need at least 2 values
 * - Boolean fields are treated as categorical toggles
 */
function isOptimizable(field: ConfigSchemaField): boolean {
  if (field.type === 'boolean') {
    return true;
  }
  if (field.enum && field.enum.length >= 2) {
    return true;
  }
  if (field.type === 'number' && field.min !== undefined && field.max !== undefined && field.min < field.max) {
    return true;
  }
  return false;
}

/**
 * Determine whether a numeric field represents an integer.
 * Uses the heuristic: default, min, and max are all integers.
 */
function isIntegerField(field: ConfigSchemaField): boolean {
  const values = [field.default, field.min, field.max].filter((v) => v !== undefined) as number[];
  return values.length > 0 && values.every((v) => Number.isInteger(v));
}

/**
 * Convert a config schema field into a ParameterDefinition.
 */
function toParameterDefinition(name: string, field: ConfigSchemaField): ParameterDefinition {
  // Boolean → categorical with [true, false]
  if (field.type === 'boolean') {
    return {
      name,
      type: 'categorical',
      values: [true, false],
      default: field.default as boolean,
      priority: 'low',
      description: field.description
    };
  }

  // Enum → categorical
  if (field.enum && field.enum.length >= 2) {
    return {
      name,
      type: 'categorical',
      values: field.enum,
      default: field.default as string | number | boolean,
      priority: 'medium',
      description: field.description
    };
  }

  // Numeric: integer vs float (min/max guaranteed by isOptimizable check)
  const isInteger = isIntegerField(field);
  const min = field.min ?? 0;
  const max = field.max ?? 0;
  const range = max - min;

  let step: number;
  if (field.step !== undefined) {
    step = field.step;
  } else if (isInteger) {
    step = 1;
  } else {
    step = chooseNaturalStep(range);
  }

  return {
    name,
    type: isInteger ? 'integer' : 'float',
    min,
    max,
    step,
    default: field.default as number,
    priority: 'high',
    description: field.description
  };
}

/**
 * Build a ParameterSpace from a strategy's getConfigSchema() output and
 * getParameterConstraints() result. Filters out non-optimizable and
 * control parameters automatically.
 *
 * @param strategyId  The strategy type identifier (e.g. 'ema-crossover-001')
 * @param configSchema  Output of strategy.getConfigSchema()
 * @param constraints  Output of strategy.getParameterConstraints()
 * @param version  Optional version string for the parameter space
 */
export function buildParameterSpace(
  strategyId: string,
  configSchema: Record<string, unknown>,
  constraints: ParameterConstraint[] = [],
  version?: string
): ParameterSpace {
  const parameters: ParameterDefinition[] = [];

  for (const [name, rawField] of Object.entries(configSchema)) {
    if (NON_OPTIMIZABLE_PARAMS.has(name)) continue;

    const field = rawField as ConfigSchemaField;
    if (!isOptimizable(field)) continue;

    parameters.push(toParameterDefinition(name, field));
  }

  const paramNames = new Set(parameters.map((p) => p.name));
  const validConstraints = constraints.filter((c) => {
    if (!paramNames.has(c.param1)) return false;
    if (c.param2 !== undefined && !paramNames.has(c.param2)) return false;
    return true;
  });

  return { strategyType: strategyId, parameters, constraints: validConstraints, version };
}
