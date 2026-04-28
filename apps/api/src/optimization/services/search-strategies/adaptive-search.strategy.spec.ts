import { AdaptiveSearchStrategy } from './adaptive-search.strategy';
import { type SearchHistoryRecord } from './search-strategy.interface';

import type { ParameterSpace } from '../../interfaces';
import { makeRandom } from '../../utils/seeded-random';
import { GridSearchService } from '../grid-search.service';

describe('AdaptiveSearchStrategy', () => {
  let strategy: AdaptiveSearchStrategy;

  const space: ParameterSpace = {
    strategyType: 'test',
    parameters: [
      { name: 'period', type: 'integer', min: 10, max: 50, step: 1, default: 20, priority: 'medium' },
      { name: 'stdDev', type: 'float', min: 1, max: 3, step: 0.1, default: 2, priority: 'medium' }
    ]
  };

  beforeEach(() => {
    strategy = new AdaptiveSearchStrategy(new GridSearchService());
  });

  it('exposes adaptive_search method and is non-static', () => {
    expect(strategy.method).toBe('adaptive_search');
    expect(strategy.isStatic).toBe(false);
  });

  it('initial generation returns only the baseline', () => {
    const init = strategy.generateInitialCombinations(space, 100);
    expect(init).toHaveLength(1);
    expect(init[0].isBaseline).toBe(true);
    expect(init[0].values.period).toBe(20);
    expect(init[0].values.stdDev).toBe(2);
  });

  it('first batch with empty history returns unique non-baseline combinations', () => {
    const batch = strategy.generateNextBatch(space, [], 10, 50, 1);
    expect(batch).toHaveLength(10);
    expect(batch.every((c) => !c.isBaseline)).toBe(true);
    // value-level uniqueness — exercises the seen-set dedupe path
    const valueKeys = new Set(batch.map((b) => JSON.stringify(b.values)));
    expect(valueKeys.size).toBe(batch.length);
  });

  it('biases roughly 30% of subsequent batches toward neighborhoods of top results', () => {
    const topPeriod = 35;
    const topStdDev = 2.5;
    const history: SearchHistoryRecord[] = [
      { combinationIndex: 0, values: { period: 20, stdDev: 2 }, avgTestScore: -1, isBaseline: true },
      { combinationIndex: 1, values: { period: topPeriod, stdDev: topStdDev }, avgTestScore: 5 },
      { combinationIndex: 2, values: { period: 36, stdDev: 2.4 }, avgTestScore: 4.5 },
      { combinationIndex: 3, values: { period: 34, stdDev: 2.6 }, avgTestScore: 4 },
      { combinationIndex: 4, values: { period: 12, stdDev: 1.2 }, avgTestScore: -8 }
    ];

    const samples = 200;
    let nearTop = 0;
    for (let i = 0; i < samples; i++) {
      const batch = strategy.generateNextBatch(space, history, 10, samples, i * 10);
      for (const c of batch) {
        const periodDist = Math.abs((c.values.period as number) - topPeriod);
        const stdDist = Math.abs((c.values.stdDev as number) - topStdDev);
        if (periodDist <= 6 && stdDist <= 0.6) nearTop++;
      }
    }

    const totalGenerated = samples * 10;
    const nearTopFraction = nearTop / totalGenerated;
    // Pure-random baseline for this neighborhood is ~0.18 (period in [29,41] ≈ 0.317 ×
    // stdDev in [1.9,3.0] ≈ 0.571). Adaptive expected ≈ 0.38 (0.7 × 0.18 + 0.3 × ~0.86).
    // Threshold 0.30 stays well above pure-random while leaving ~7σ headroom at n=2000.
    expect(nearTopFraction).toBeGreaterThan(0.3);
  });

  it('clamps batch size to `remaining` when batchSize exceeds it', () => {
    const history: SearchHistoryRecord[] = [
      { combinationIndex: 0, values: { period: 20, stdDev: 2 }, avgTestScore: 1 }
    ];
    const batch = strategy.generateNextBatch(space, history, 50, 3, 1);
    expect(batch).toHaveLength(3);
  });

  it('respects reachability filter', () => {
    const history: SearchHistoryRecord[] = [];
    const reject = () => false;
    const batch = strategy.generateNextBatch(space, history, 10, 100, 1, { reachabilityFilter: reject });
    expect(batch).toHaveLength(0);
  });

  it('produces identical output for the same seed (determinism contract)', () => {
    const history: SearchHistoryRecord[] = [
      { combinationIndex: 0, values: { period: 20, stdDev: 2 }, avgTestScore: -1, isBaseline: true },
      { combinationIndex: 1, values: { period: 35, stdDev: 2.5 }, avgTestScore: 5 },
      { combinationIndex: 2, values: { period: 36, stdDev: 2.4 }, avgTestScore: 4.5 }
    ];
    const a = strategy.generateNextBatch(space, history, 10, 50, 3, { random: makeRandom(42) });
    const b = strategy.generateNextBatch(space, history, 10, 50, 3, { random: makeRandom(42) });
    expect(a.map((c) => c.values)).toEqual(b.map((c) => c.values));
  });
});
