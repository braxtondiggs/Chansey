import { ParameterConstraint, ParameterDefinition, ParameterSpace } from '../interfaces/parameter-space.interface';

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
const NON_OPTIMIZABLE_PARAMS = new Set([
  'enabled',
  'weight',
  'riskLevel',
  'cooldownMs',
  'maxTradesPerDay',
  'minSellPercent'
]);

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

  // Numeric: integer vs float
  const isInteger = isIntegerField(field);
  const min = field.min!;
  const max = field.max!;
  const range = max - min;

  let step: number;
  if (field.step !== undefined) {
    step = field.step;
  } else if (isInteger) {
    step = 1;
  } else {
    const raw = Math.round((range / 10) * 100) / 100;
    step = Math.min(Math.max(raw, range / 100), range);
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
