import { GridSearchService } from './grid-search.service';

import { ParameterConstraint, ParameterDefinition, ParameterSpace } from '../interfaces';

// Helper to create a valid ParameterDefinition with required fields
const createParam = (
  overrides: Partial<ParameterDefinition> & { name: string; default: any }
): ParameterDefinition => ({
  type: 'integer',
  priority: 'medium',
  ...overrides
});

// Helper to create a valid ParameterSpace with required fields
const createSpace = (overrides: Partial<ParameterSpace> = {}): ParameterSpace => ({
  strategyType: 'test-strategy',
  parameters: [],
  ...overrides
});

describe('GridSearchService', () => {
  let service: GridSearchService;

  beforeEach(() => {
    service = new GridSearchService();
  });

  describe('expandParameter', () => {
    it('should expand integer range correctly', () => {
      const param = createParam({
        name: 'period',
        type: 'integer',
        min: 10,
        max: 14,
        step: 2,
        default: 12
      });

      const values = service.expandParameter(param);

      expect(values).toEqual([10, 12, 14]);
    });

    it('should expand float range with precision', () => {
      const param = createParam({
        name: 'threshold',
        type: 'float',
        min: 0.1,
        max: 0.3,
        step: 0.1,
        default: 0.2
      });

      const values = service.expandParameter(param);

      expect(values).toEqual([0.1, 0.2, 0.3]);
    });

    it('should handle categorical values', () => {
      const param = createParam({
        name: 'type',
        type: 'categorical',
        values: ['sma', 'ema', 'wma'],
        default: 'ema'
      });

      const values = service.expandParameter(param);

      expect(values).toEqual(['sma', 'ema', 'wma']);
    });

    it('should use default when no values provided for categorical', () => {
      const param = createParam({
        name: 'mode',
        type: 'categorical',
        default: 'default'
      });

      const values = service.expandParameter(param);

      expect(values).toEqual(['default']);
    });

    it('should return single value when min equals max', () => {
      const param = createParam({
        name: 'fixed',
        type: 'integer',
        min: 5,
        max: 5,
        default: 5
      });

      const values = service.expandParameter(param);

      expect(values).toEqual([5]);
    });

    it('should fallback to default when min/max are undefined', () => {
      const param = createParam({
        name: 'fallback',
        type: 'integer',
        default: 7
      });

      const values = service.expandParameter(param);

      expect(values).toEqual([7]);
    });

    it('should round float values to 4 decimal places', () => {
      const param = createParam({
        name: 'ratio',
        type: 'float',
        min: 0,
        max: 0.1,
        step: 0.0333333,
        default: 0.0333
      });

      const values = service.expandParameter(param);

      expect(values).toContain(0.0333);
    });

    it('should include max value when step does not land exactly', () => {
      const param = createParam({
        name: 'value',
        type: 'integer',
        min: 10,
        max: 15,
        step: 4,
        default: 10
      });

      const values = service.expandParameter(param);

      // 10, 14, 15 (max included)
      expect(values).toContain(10);
      expect(values).toContain(14);
      expect(values).toContain(15);
    });
  });

  describe('generateCombinations', () => {
    it('should generate cartesian product of parameters', () => {
      const space = createSpace({
        parameters: [
          createParam({ name: 'a', type: 'integer', min: 1, max: 2, step: 1, default: 1 }),
          createParam({ name: 'b', type: 'integer', min: 10, max: 20, step: 10, default: 10 })
        ]
      });

      const combinations = service.generateCombinations(space);

      // 2 values for a (1,2) * 2 values for b (10,20) = 4 combinations
      expect(combinations.length).toBe(4);
    });

    it('should mark baseline combination at index 0', () => {
      const space = createSpace({
        parameters: [createParam({ name: 'period', type: 'integer', min: 10, max: 20, step: 5, default: 15 })]
      });

      const combinations = service.generateCombinations(space);
      const baseline = combinations.find((c) => c.isBaseline);

      expect(baseline).toBeDefined();
      expect(baseline?.index).toBe(0);
      expect(baseline?.values.period).toBe(15);
    });

    it('should respect maxCombinations limit', () => {
      const space = createSpace({
        parameters: [
          createParam({ name: 'a', type: 'integer', min: 1, max: 10, step: 1, default: 5 }),
          createParam({ name: 'b', type: 'integer', min: 1, max: 10, step: 1, default: 5 })
        ]
      });

      const combinations = service.generateCombinations(space, 10);

      expect(combinations.length).toBe(10);
      // Baseline should always be included
      expect(combinations.some((c) => c.isBaseline)).toBe(true);
    });

    it('should handle empty parameter space', () => {
      const space = createSpace({ parameters: [] });

      const combinations = service.generateCombinations(space);

      expect(combinations.length).toBe(1);
      expect(combinations[0].values).toEqual({});
    });

    it('should include baseline even if constraints exclude it', () => {
      const space = createSpace({
        parameters: [
          createParam({ name: 'fast', type: 'integer', min: 5, max: 10, step: 5, default: 5 }),
          createParam({ name: 'slow', type: 'integer', min: 5, max: 10, step: 5, default: 5 })
        ],
        constraints: [{ type: 'less_than', param1: 'fast', param2: 'slow' }]
      });

      const combinations = service.generateCombinations(space);

      expect(combinations[0].isBaseline).toBe(true);
      expect(combinations[0].values).toEqual({ fast: 5, slow: 5 });
    });
  });

  describe('validateConstraints', () => {
    it('should validate less_than constraint with param2', () => {
      const params = { shortPeriod: 10, longPeriod: 20 };
      const constraints: ParameterConstraint[] = [{ type: 'less_than', param1: 'shortPeriod', param2: 'longPeriod' }];

      expect(service.validateConstraints(params, constraints)).toBe(true);
    });

    it('should reject when less_than constraint fails', () => {
      const params = { shortPeriod: 25, longPeriod: 20 };
      const constraints: ParameterConstraint[] = [{ type: 'less_than', param1: 'shortPeriod', param2: 'longPeriod' }];

      expect(service.validateConstraints(params, constraints)).toBe(false);
    });

    it('should validate less_than constraint with value', () => {
      const params = { threshold: 0.5 };
      const constraints: ParameterConstraint[] = [{ type: 'less_than', param1: 'threshold', value: 1.0 }];

      expect(service.validateConstraints(params, constraints)).toBe(true);
    });

    it('should validate greater_than constraint', () => {
      const params = { stopLoss: 0.05 };
      const constraints: ParameterConstraint[] = [{ type: 'greater_than', param1: 'stopLoss', value: 0.01 }];

      expect(service.validateConstraints(params, constraints)).toBe(true);
    });

    it('should validate greater_than constraint with param2', () => {
      const params = { fast: 10, slow: 30 };
      const constraints: ParameterConstraint[] = [{ type: 'greater_than', param1: 'slow', param2: 'fast' }];

      expect(service.validateConstraints(params, constraints)).toBe(true);
    });

    it('should validate not_equal constraint', () => {
      const params = { a: 10, b: 20 };
      const constraints: ParameterConstraint[] = [{ type: 'not_equal', param1: 'a', param2: 'b' }];

      expect(service.validateConstraints(params, constraints)).toBe(true);
    });

    it('should validate not_equal constraint with value', () => {
      const params = { mode: 1 };
      const constraints: ParameterConstraint[] = [{ type: 'not_equal', param1: 'mode', value: 0 }];

      expect(service.validateConstraints(params, constraints)).toBe(true);
    });

    it('should reject when not_equal constraint fails', () => {
      const params = { a: 10, b: 10 };
      const constraints: ParameterConstraint[] = [{ type: 'not_equal', param1: 'a', param2: 'b' }];

      expect(service.validateConstraints(params, constraints)).toBe(false);
    });

    it('should validate custom constraint', () => {
      const params = { a: 5, b: 10 };
      const constraints: ParameterConstraint[] = [
        {
          type: 'custom',
          param1: 'a',
          customValidator: (p) => (p.a as number) + (p.b as number) < 20
        }
      ];

      expect(service.validateConstraints(params, constraints)).toBe(true);
    });

    it('should reject when custom constraint fails', () => {
      const params = { a: 5, b: 10 };
      const constraints: ParameterConstraint[] = [
        {
          type: 'custom',
          param1: 'a',
          customValidator: (p) => (p.a as number) + (p.b as number) < 10
        }
      ];

      expect(service.validateConstraints(params, constraints)).toBe(false);
    });

    it('should return true for empty constraints', () => {
      const params = { any: 123 };

      expect(service.validateConstraints(params, [])).toBe(true);
    });
  });

  describe('generateRandomCombinations', () => {
    it('should generate requested number of combinations', () => {
      const space = createSpace({
        parameters: [
          createParam({ name: 'period', type: 'integer', min: 5, max: 50, step: 1, default: 14 }),
          createParam({ name: 'threshold', type: 'float', min: 0.1, max: 0.9, step: 0.1, default: 0.5 })
        ]
      });

      const combinations = service.generateRandomCombinations(space, 20);

      expect(combinations.length).toBe(20);
    });

    it('should always include baseline first', () => {
      const space = createSpace({
        parameters: [createParam({ name: 'period', type: 'integer', min: 5, max: 50, step: 1, default: 14 })]
      });

      const combinations = service.generateRandomCombinations(space, 10);

      expect(combinations[0].isBaseline).toBe(true);
      expect(combinations[0].values.period).toBe(14);
    });

    it('should not generate duplicate combinations', () => {
      const space = createSpace({
        parameters: [createParam({ name: 'period', type: 'integer', min: 10, max: 15, step: 1, default: 12 })]
      });

      const combinations = service.generateRandomCombinations(space, 6);
      const uniqueValues = new Set(combinations.map((c) => JSON.stringify(c.values)));

      expect(uniqueValues.size).toBe(combinations.length);
    });

    it('should respect constraints in random generation', () => {
      const space = createSpace({
        parameters: [
          createParam({ name: 'short', type: 'integer', min: 5, max: 20, step: 1, default: 10 }),
          createParam({ name: 'long', type: 'integer', min: 5, max: 20, step: 1, default: 15 })
        ],
        constraints: [{ type: 'less_than', param1: 'short', param2: 'long' }]
      });

      const combinations = service.generateRandomCombinations(space, 20);

      for (const combo of combinations) {
        expect((combo.values.short as number) < (combo.values.long as number)).toBe(true);
      }
    });

    it('should stop when constraints make combinations impossible', () => {
      const space = createSpace({
        parameters: [
          createParam({ name: 'a', type: 'integer', min: 1, max: 1, step: 1, default: 1 }),
          createParam({ name: 'b', type: 'integer', min: 1, max: 1, step: 1, default: 1 })
        ],
        constraints: [{ type: 'not_equal', param1: 'a', param2: 'b' }]
      });

      const combinations = service.generateRandomCombinations(space, 5);

      expect(combinations.length).toBe(1);
      expect(combinations[0].isBaseline).toBe(true);
    });
  });

  describe('calculateTotalCombinations', () => {
    it('should calculate total combinations correctly', () => {
      const space = createSpace({
        parameters: [
          createParam({ name: 'a', type: 'integer', min: 1, max: 5, step: 1, default: 3 }), // 5 values
          createParam({ name: 'b', type: 'integer', min: 10, max: 30, step: 10, default: 20 }) // 3 values
        ]
      });

      const total = service.calculateTotalCombinations(space);

      expect(total).toBe(15); // 5 * 3
    });

    it('should return 1 for empty parameter space', () => {
      const space = createSpace({ parameters: [] });

      expect(service.calculateTotalCombinations(space)).toBe(1);
    });
  });
});
