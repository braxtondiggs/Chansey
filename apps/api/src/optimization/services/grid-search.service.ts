import { Injectable, Logger } from '@nestjs/common';

import { ParameterCombination, ParameterConstraint, ParameterDefinition, ParameterSpace } from '../interfaces';

/**
 * Grid Search Service
 * Generates parameter combinations for optimization
 */
@Injectable()
export class GridSearchService {
  private readonly logger = new Logger(GridSearchService.name);

  /**
   * Generate all parameter combinations from a parameter space
   * @param space Parameter space definition
   * @param maxCombinations Optional limit on combinations (random sample if exceeded)
   * @returns Array of parameter combinations
   */
  generateCombinations(space: ParameterSpace, maxCombinations?: number): ParameterCombination[] {
    // Expand each parameter to its possible values
    const parameterValues: Map<string, (number | string | boolean)[]> = new Map();

    for (const param of space.parameters) {
      parameterValues.set(param.name, this.expandParameter(param));
    }

    // Generate cartesian product
    const allCombinations = this.cartesianProduct(parameterValues);

    // Filter by constraints
    const validCombinations = allCombinations.filter((combo) =>
      this.validateConstraints(combo, space.constraints || [])
    );

    this.logger.log(
      `Generated ${validCombinations.length} valid combinations from ${allCombinations.length} total (${space.parameters.length} parameters)`
    );

    // Find baseline combination
    const baselineValues = this.getBaselineValues(space);

    // Build result with baseline marked
    let combinations = validCombinations.map((values, index) => ({
      index,
      values,
      isBaseline: this.isBaselineCombination(values, baselineValues)
    }));

    // Ensure baseline is included and at index 0
    const baselineIndex = combinations.findIndex((c) => c.isBaseline);
    if (baselineIndex === -1) {
      // Baseline wasn't in valid combinations, add it
      combinations.unshift({
        index: 0,
        values: baselineValues,
        isBaseline: true
      });
    } else if (baselineIndex > 0) {
      // Move baseline to front
      const [baseline] = combinations.splice(baselineIndex, 1);
      combinations.unshift(baseline);
    }

    // Re-index
    combinations = combinations.map((c, idx) => ({ ...c, index: idx }));

    // Limit if needed (random sample, but always keep baseline)
    if (maxCombinations && combinations.length > maxCombinations) {
      combinations = this.sampleCombinations(combinations, maxCombinations);
    }

    return combinations;
  }

  /**
   * Expand a single parameter to its possible values
   */
  expandParameter(param: ParameterDefinition): (number | string | boolean)[] {
    if (param.type === 'categorical') {
      return param.values || [param.default];
    }

    // Numeric types
    const min = param.min ?? (param.default as number);
    const max = param.max ?? (param.default as number);
    const step = param.step ?? 1;

    if (min === max) {
      return [min];
    }

    const values: number[] = [];
    for (let value = min; value <= max; value += step) {
      // Handle floating point precision
      values.push(param.type === 'integer' ? Math.round(value) : Math.round(value * 10000) / 10000);
    }

    // Ensure max is included if step doesn't land exactly on it
    if (values.length > 0 && values[values.length - 1] < max) {
      values.push(param.type === 'integer' ? Math.round(max) : Math.round(max * 10000) / 10000);
    }

    return values;
  }

  /**
   * Calculate total possible combinations (before constraints)
   */
  calculateTotalCombinations(space: ParameterSpace): number {
    return space.parameters.reduce((total, param) => {
      return total * this.expandParameter(param).length;
    }, 1);
  }

  /**
   * Validate constraints on a parameter combination
   */
  validateConstraints(params: Record<string, unknown>, constraints: ParameterConstraint[]): boolean {
    for (const constraint of constraints) {
      if (!this.validateSingleConstraint(params, constraint)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Validate a single constraint
   */
  private validateSingleConstraint(params: Record<string, unknown>, constraint: ParameterConstraint): boolean {
    const val1 = params[constraint.param1] as number;

    switch (constraint.type) {
      case 'less_than':
        if (constraint.param2) {
          const val2 = params[constraint.param2] as number;
          return val1 < val2;
        }
        return constraint.value !== undefined ? val1 < constraint.value : true;

      case 'greater_than':
        if (constraint.param2) {
          const val2 = params[constraint.param2] as number;
          return val1 > val2;
        }
        return constraint.value !== undefined ? val1 > constraint.value : true;

      case 'not_equal':
        if (constraint.param2) {
          const val2 = params[constraint.param2];
          return val1 !== val2;
        }
        return constraint.value !== undefined ? val1 !== constraint.value : true;

      case 'custom':
        return constraint.customValidator ? constraint.customValidator(params) : true;

      default:
        return true;
    }
  }

  /**
   * Generate cartesian product of all parameter values
   */
  private cartesianProduct(
    parameterValues: Map<string, (number | string | boolean)[]>
  ): Record<string, number | string | boolean>[] {
    const paramNames = Array.from(parameterValues.keys());
    const paramArrays = Array.from(parameterValues.values());

    if (paramNames.length === 0) {
      return [{}];
    }

    const result: Record<string, number | string | boolean>[] = [];

    const helper = (current: Record<string, number | string | boolean>, depth: number) => {
      if (depth === paramNames.length) {
        result.push({ ...current });
        return;
      }

      const paramName = paramNames[depth];
      const values = paramArrays[depth];

      for (const value of values) {
        current[paramName] = value;
        helper(current, depth + 1);
      }
    };

    helper({}, 0);
    return result;
  }

  /**
   * Get baseline parameter values from space
   */
  private getBaselineValues(space: ParameterSpace): Record<string, number | string | boolean> {
    const baseline: Record<string, number | string | boolean> = {};
    for (const param of space.parameters) {
      baseline[param.name] = param.default as number | string | boolean;
    }
    return baseline;
  }

  /**
   * Check if a combination matches the baseline
   */
  private isBaselineCombination(
    values: Record<string, number | string | boolean>,
    baseline: Record<string, number | string | boolean>
  ): boolean {
    for (const key of Object.keys(baseline)) {
      if (values[key] !== baseline[key]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Sample combinations while keeping baseline
   */
  private sampleCombinations(combinations: ParameterCombination[], maxCombinations: number): ParameterCombination[] {
    if (combinations.length <= maxCombinations) {
      return combinations;
    }

    // Always keep baseline (index 0)
    const baseline = combinations[0];
    const rest = combinations.slice(1);

    // Random sample from rest
    const sampleSize = maxCombinations - 1;
    const sampled = this.shuffleArray(rest).slice(0, sampleSize);

    // Combine and re-index
    const result = [baseline, ...sampled].map((c, idx) => ({
      ...c,
      index: idx
    }));

    this.logger.log(`Sampled ${result.length} combinations from ${combinations.length}`);

    return result;
  }

  /**
   * Fisher-Yates shuffle
   */
  private shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Generate combinations for random search
   */
  generateRandomCombinations(space: ParameterSpace, numCombinations: number): ParameterCombination[] {
    const combinations: ParameterCombination[] = [];
    const seen = new Set<string>();

    // Always include baseline first
    const baseline = this.getBaselineValues(space);
    combinations.push({
      index: 0,
      values: baseline,
      isBaseline: true
    });
    seen.add(JSON.stringify(baseline));

    let attempts = 0;
    const maxAttempts = numCombinations * 10;

    while (combinations.length < numCombinations && attempts < maxAttempts) {
      attempts++;

      const randomCombo = this.generateRandomCombination(space);
      const key = JSON.stringify(randomCombo);

      if (seen.has(key)) {
        continue;
      }

      if (!this.validateConstraints(randomCombo, space.constraints || [])) {
        continue;
      }

      seen.add(key);
      combinations.push({
        index: combinations.length,
        values: randomCombo,
        isBaseline: false
      });
    }

    this.logger.log(`Generated ${combinations.length} random combinations (target: ${numCombinations})`);

    return combinations;
  }

  /**
   * Generate a single random parameter combination
   */
  private generateRandomCombination(space: ParameterSpace): Record<string, number | string | boolean> {
    const result: Record<string, number | string | boolean> = {};

    for (const param of space.parameters) {
      result[param.name] = this.generateRandomValue(param);
    }

    return result;
  }

  /**
   * Generate a random value for a parameter
   */
  private generateRandomValue(param: ParameterDefinition): number | string | boolean {
    if (param.type === 'categorical') {
      const values = param.values || [param.default];
      return values[Math.floor(Math.random() * values.length)];
    }

    const min = param.min ?? (param.default as number);
    const max = param.max ?? (param.default as number);
    const step = param.step ?? 1;

    if (param.type === 'integer') {
      const range = Math.floor((max - min) / step) + 1;
      return Math.round(min + Math.floor(Math.random() * range) * step);
    }

    // Float
    const range = (max - min) / step;
    const steps = Math.floor(Math.random() * (range + 1));
    return Math.round((min + steps * step) * 10000) / 10000;
  }
}
