import { type ParameterCombination, type ParameterSpace } from '../../interfaces';
import { type RandomFn } from '../../utils/seeded-random';

/**
 * Per-evaluation history record consumed by adaptive search to bias subsequent batches.
 */
export interface SearchHistoryRecord {
  combinationIndex: number;
  values: Record<string, number | string | boolean>;
  avgTestScore: number;
  isBaseline?: boolean;
}

/**
 * Generation method identifier matching {@link OptimizationConfig.method}.
 */
export type SearchMethod = 'grid_search' | 'random_search' | 'adaptive_search';

/**
 * Options consumed by both `generateInitialCombinations` and `generateNextBatch`.
 *
 * Bundling these into a single options object keeps the call sites stable as new
 * orthogonal concerns are added (PRNG injection, reachability filtering, …).
 */
export interface SearchStrategyOptions {
  /** Drop combos whose indicators can't warm up + fire inside the available test window. */
  reachabilityFilter?: (params: Record<string, unknown>) => boolean;
  /** Seeded PRNG. Default: `Math.random`. Pass a seeded function to make a run deterministic. */
  random?: RandomFn;
}

/**
 * Search strategy interface — encapsulates how parameter combinations are produced
 * across an optimization run.
 *
 * Strategies fall into two camps:
 * - **Static** (grid_search, random_search): produce the entire combination set up front,
 *   then `generateNextBatch` is a no-op (returns []) since the orchestrator already has them.
 * - **Adaptive**: needs to inspect history; the orchestrator calls `generateNextBatch` per batch.
 */
export interface SearchStrategy {
  /** Unique method identifier — used by the resolver to look up the right implementation. */
  readonly method: SearchMethod;

  /**
   * Whether this strategy enumerates all combinations at run start (true)
   * or generates them incrementally as history accumulates (false).
   */
  readonly isStatic: boolean;

  /**
   * Pre-generate the full combination set (static strategies only). Adaptive strategies
   * may return a small initial seed — typically the baseline plus a random first batch.
   *
   * `targetCount` is undefined when the caller wants the strategy's default (e.g. grid search
   * with no `maxCombinations` cap). Random and adaptive search treat undefined as "use 100".
   */
  generateInitialCombinations(
    space: ParameterSpace,
    targetCount: number | undefined,
    options?: SearchStrategyOptions
  ): ParameterCombination[];

  /**
   * Produce the next batch of combinations to evaluate, given the history so far.
   * Static strategies return an empty array — combinations were already enumerated.
   *
   * @param space      Parameter space definition.
   * @param history    All previously evaluated combinations and their test scores.
   * @param batchSize  Number of new combinations to produce.
   * @param remaining  Total combinations still pending (used to clamp output).
   * @param startIndex Next monotonic index to assign so combinations stay uniquely numbered.
   * @param options    Reachability filter + PRNG.
   */
  generateNextBatch(
    space: ParameterSpace,
    history: SearchHistoryRecord[],
    batchSize: number,
    remaining: number,
    startIndex: number,
    options?: SearchStrategyOptions
  ): ParameterCombination[];
}
