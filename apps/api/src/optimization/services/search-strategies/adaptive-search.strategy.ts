import { Injectable, Logger } from '@nestjs/common';

import { SearchHistoryRecord, SearchStrategy, SearchStrategyOptions } from './search-strategy.interface';

import { ParameterCombination, ParameterDefinition, ParameterSpace } from '../../interfaces';
import { stepDecimals, type RandomFn } from '../../utils/seeded-random';
import { GridSearchService } from '../grid-search.service';

/**
 * Hybrid neighborhood / random sampler.
 *
 * - Batch 1 has no history → returns the baseline only; the orchestrator's first call to
 *   generateNextBatch fills in random + neighborhood combos as history accumulates.
 * - Subsequent batches sample 70% from random space and 30% from a Gaussian neighborhood
 *   around the top-3 results so far. Numeric params get σ = 10% of (max-min);
 *   categorical params re-sample with a weighted bias toward the top performers.
 *
 * Caveat: with single-regime data concentration, adaptive search can lock onto regime-specific
 * combos. Mitigate by ensuring walk-forward windows span as long a history as available.
 */
@Injectable()
export class AdaptiveSearchStrategy implements SearchStrategy {
  private readonly logger = new Logger(AdaptiveSearchStrategy.name);

  readonly method = 'adaptive_search' as const;
  readonly isStatic = false;

  /** Fraction of each batch sampled from neighborhood of top results (vs pure random). */
  private static readonly NEIGHBORHOOD_RATIO = 0.3;
  /** Number of top results used as neighborhood centers. */
  private static readonly TOP_K = 3;
  /** Gaussian σ as a fraction of each numeric param's (max-min) range. */
  private static readonly SIGMA_FRACTION = 0.1;

  constructor(private readonly gridSearchService: GridSearchService) {}

  generateInitialCombinations(
    space: ParameterSpace,
    targetCount: number | undefined,
    options?: SearchStrategyOptions
  ): ParameterCombination[] {
    // Seed with baseline only; batches will fill in the rest as evaluation history arrives.
    const baselineValues: Record<string, number | string | boolean> = {};
    for (const param of space.parameters) {
      baselineValues[param.name] = param.default;
    }
    void targetCount;
    void options;
    return [{ index: 0, values: baselineValues, isBaseline: true }];
  }

  generateNextBatch(
    space: ParameterSpace,
    history: SearchHistoryRecord[],
    batchSize: number,
    remaining: number,
    startIndex: number,
    options?: SearchStrategyOptions
  ): ParameterCombination[] {
    const random = options?.random ?? Math.random;
    const reachabilityFilter = options?.reachabilityFilter;

    const targetCount = Math.max(0, Math.min(batchSize, remaining));
    if (targetCount === 0) return [];

    const seen = new Set<string>(history.map((h) => JSON.stringify(h.values)));
    const out: ParameterCombination[] = [];

    const validCenters = this.pickTopK(history, AdaptiveSearchStrategy.TOP_K);
    const useNeighborhood = validCenters.length > 0;
    const neighborhoodCount = useNeighborhood ? Math.round(targetCount * AdaptiveSearchStrategy.NEIGHBORHOOD_RATIO) : 0;
    const randomCount = targetCount - neighborhoodCount;

    let attempts = 0;
    const maxAttempts = targetCount * 20;
    let randomAdded = 0;

    // Random portion
    while (randomAdded < randomCount && attempts < maxAttempts) {
      attempts++;
      const candidate = this.sampleRandom(space, random);
      if (!this.acceptCandidate(candidate, space, seen, reachabilityFilter)) continue;
      out.push({ index: startIndex + out.length, values: candidate, isBaseline: false });
      seen.add(JSON.stringify(candidate));
      randomAdded++;
    }

    // Neighborhood portion
    let neighborhoodAdded = 0;
    while (neighborhoodAdded < neighborhoodCount && attempts < maxAttempts * 2) {
      attempts++;
      const center = validCenters[neighborhoodAdded % validCenters.length].values;
      const candidate = this.sampleNeighborhood(space, center, random);
      if (!this.acceptCandidate(candidate, space, seen, reachabilityFilter)) continue;
      out.push({ index: startIndex + out.length, values: candidate, isBaseline: false });
      seen.add(JSON.stringify(candidate));
      neighborhoodAdded++;
    }

    if (out.length < targetCount) {
      this.logger.warn(
        `Adaptive search produced ${out.length}/${targetCount} combos after ${attempts} attempts ` +
          `(history=${history.length}, centers=${validCenters.length})`
      );
    }

    return out;
  }

  /** Pick the top K by avgTestScore. Includes the baseline if it ranks. */
  private pickTopK(history: SearchHistoryRecord[], k: number): SearchHistoryRecord[] {
    return [...history]
      .filter((h) => Number.isFinite(h.avgTestScore))
      .sort((a, b) => b.avgTestScore - a.avgTestScore)
      .slice(0, k);
  }

  private acceptCandidate(
    candidate: Record<string, number | string | boolean>,
    space: ParameterSpace,
    seen: Set<string>,
    reachabilityFilter?: (params: Record<string, unknown>) => boolean
  ): boolean {
    if (seen.has(JSON.stringify(candidate))) return false;
    if (!this.gridSearchService.validateConstraints(candidate, space.constraints || [])) return false;
    if (reachabilityFilter && !reachabilityFilter(candidate)) return false;
    return true;
  }

  private sampleRandom(space: ParameterSpace, random: RandomFn): Record<string, number | string | boolean> {
    const result: Record<string, number | string | boolean> = {};
    for (const param of space.parameters) {
      result[param.name] = this.randomValue(param, random);
    }
    return result;
  }

  private sampleNeighborhood(
    space: ParameterSpace,
    center: Record<string, number | string | boolean>,
    random: RandomFn
  ): Record<string, number | string | boolean> {
    const result: Record<string, number | string | boolean> = {};
    for (const param of space.parameters) {
      result[param.name] = this.neighborhoodValue(param, center[param.name], random);
    }
    return result;
  }

  private randomValue(param: ParameterDefinition, random: RandomFn): number | string | boolean {
    if (param.type === 'categorical') {
      const values = param.values || [param.default];
      return values[Math.floor(random() * values.length)];
    }
    const min = param.min ?? (param.default as number);
    const max = param.max ?? (param.default as number);
    const step = param.step ?? 1;
    if (param.type === 'integer') {
      const range = Math.floor((max - min) / step) + 1;
      return Math.round(min + Math.floor(random() * range) * step);
    }
    // Float — mirror the integer branch so a step that doesn't divide (max - min) evenly
    // can never produce a value above max.
    const range = Math.floor((max - min) / step) + 1;
    const steps = Math.floor(random() * range);
    const factor = Math.pow(10, stepDecimals(step));
    return Math.round((min + steps * step) * factor) / factor;
  }

  private neighborhoodValue(
    param: ParameterDefinition,
    centerValue: number | string | boolean | undefined,
    random: RandomFn
  ): number | string | boolean {
    if (centerValue === undefined) return this.randomValue(param, random);

    if (param.type === 'categorical') {
      // 70% chance to keep the center, otherwise re-sample randomly
      if (random() < 0.7) return centerValue;
      return this.randomValue(param, random);
    }

    const center = Number(centerValue);
    if (!Number.isFinite(center)) return this.randomValue(param, random);

    const min = param.min ?? center;
    const max = param.max ?? center;
    const step = param.step ?? 1;
    const range = max - min;
    if (range <= 0) return center;

    const sigma = range * AdaptiveSearchStrategy.SIGMA_FRACTION;
    const noisy = center + this.gaussian(random) * sigma;
    const clamped = Math.max(min, Math.min(max, noisy));

    if (param.type === 'integer') {
      const snapped = Math.round((clamped - min) / step) * step + min;
      return Math.round(Math.max(min, Math.min(max, snapped)));
    }
    const snapped = Math.round((clamped - min) / step) * step + min;
    const factor = Math.pow(10, stepDecimals(step));
    return Math.round(Math.max(min, Math.min(max, snapped)) * factor) / factor;
  }

  /** Box-Muller transform — standard-normal sample. */
  private gaussian(random: RandomFn): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
