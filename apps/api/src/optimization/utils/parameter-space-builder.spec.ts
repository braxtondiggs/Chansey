import { buildParameterSpace } from './parameter-space-builder';

import { ParameterConstraint } from '../interfaces/parameter-space.interface';

describe('buildParameterSpace', () => {
  it('should convert integer numeric fields with step=1 and high priority', () => {
    const schema = {
      period: { type: 'number', default: 14, min: 5, max: 50 }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.strategyType).toBe('test-001');
    expect(space.parameters).toHaveLength(1);
    expect(space.parameters[0]).toEqual(
      expect.objectContaining({
        name: 'period',
        type: 'integer',
        min: 5,
        max: 50,
        step: 1,
        default: 14,
        priority: 'high'
      })
    );
  });

  it('should convert float numeric fields with computed step', () => {
    const schema = {
      stopLoss: { type: 'number', default: 0.05, min: 0.01, max: 0.2 }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters).toHaveLength(1);
    expect(space.parameters[0]).toEqual(
      expect.objectContaining({
        name: 'stopLoss',
        type: 'float',
        min: 0.01,
        max: 0.2,
        default: 0.05,
        priority: 'high'
      })
    );
    // Step = (0.2 - 0.01) / 10 = 0.019, rounded to 0.02
    expect(space.parameters[0].step).toBe(0.02);
  });

  it('should detect float when default is non-integer despite integer min/max', () => {
    const schema = {
      threshold: { type: 'number', default: 0.5, min: 0, max: 1 }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters[0].type).toBe('float');
  });

  it('should use custom step when provided', () => {
    const schema = {
      period: { type: 'number', default: 14, min: 5, max: 50, step: 5 }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters[0].step).toBe(5);
  });

  it('should convert boolean fields to categorical with low priority', () => {
    const schema = {
      enableStopLoss: { type: 'boolean', default: true }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters).toHaveLength(1);
    expect(space.parameters[0]).toEqual(
      expect.objectContaining({
        name: 'enableStopLoss',
        type: 'categorical',
        values: [true, false],
        default: true,
        priority: 'low'
      })
    );
  });

  it('should convert enum fields to categorical with medium priority', () => {
    const schema = {
      trendMode: { type: 'string', enum: ['fast', 'slow', 'adaptive'], default: 'adaptive' }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters).toHaveLength(1);
    expect(space.parameters[0]).toEqual(
      expect.objectContaining({
        name: 'trendMode',
        type: 'categorical',
        values: ['fast', 'slow', 'adaptive'],
        default: 'adaptive',
        priority: 'medium'
      })
    );
  });

  it('should skip enum with fewer than 2 values', () => {
    const schema = {
      mode: { type: 'string', enum: ['only'], default: 'only' }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters).toHaveLength(0);
  });

  it('should filter out all NON_OPTIMIZABLE_PARAMS', () => {
    const schema = {
      enabled: { type: 'boolean', default: true },
      weight: { type: 'number', default: 1.0, min: 0, max: 10 },
      riskLevel: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
      cooldownMs: { type: 'number', default: 86400000, min: 0, max: 604800000 },
      maxTradesPerDay: { type: 'number', default: 6, min: 0, max: 50 },
      minSellPercent: { type: 'number', default: 0.5, min: 0, max: 1.0 },
      fastPeriod: { type: 'number', default: 12, min: 5, max: 50 }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters).toHaveLength(1);
    expect(space.parameters[0].name).toBe('fastPeriod');
  });

  it.each([
    ['string without enum', { label: { type: 'string', default: 'default' } }],
    ['number without min/max', { count: { type: 'number', default: 5 } }],
    ['number where min equals max', { fixed: { type: 'number', default: 10, min: 10, max: 10 } }]
  ])('should skip non-optimizable field: %s', (_label, schema) => {
    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters).toHaveLength(0);
  });

  it('should return empty parameters for empty schema', () => {
    const space = buildParameterSpace('test-001', {});

    expect(space.parameters).toHaveLength(0);
    expect(space.strategyType).toBe('test-001');
    expect(space.constraints).toEqual([]);
  });

  it('should pass through constraints and version', () => {
    const schema = {
      fastPeriod: { type: 'number', default: 12, min: 5, max: 50 },
      slowPeriod: { type: 'number', default: 26, min: 10, max: 100 }
    };
    const constraints: ParameterConstraint[] = [
      { type: 'less_than', param1: 'fastPeriod', param2: 'slowPeriod', message: 'fast < slow' }
    ];

    const space = buildParameterSpace('test-001', schema, constraints, '2.0.0');

    expect(space.constraints).toEqual(constraints);
    expect(space.version).toBe('2.0.0');
    expect(space.parameters).toHaveLength(2);
  });

  it('should produce step > 0 for tiny float range (prevents infinite loop)', () => {
    const schema = {
      threshold: { type: 'number', default: 0.0015, min: 0.001, max: 0.002 }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters[0].step).toBeGreaterThan(0);
    expect(space.parameters[0].step).toBeLessThanOrEqual(0.001); // range = 0.001
  });

  it('should clamp step <= range for small float range', () => {
    const schema = {
      factor: { type: 'number', default: 0.05, min: 0.01, max: 0.02 }
    };

    const space = buildParameterSpace('test-001', schema);

    const range = 0.02 - 0.01;
    expect(space.parameters[0].step).toBeGreaterThan(0);
    expect(space.parameters[0].step).toBeLessThanOrEqual(range);
  });

  it('should not clamp user-provided step', () => {
    const schema = {
      threshold: { type: 'number', default: 0.0015, min: 0.001, max: 0.002, step: 0.0001 }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters[0].step).toBe(0.0001);
  });

  it('should filter constraints referencing a filtered param1', () => {
    const schema = {
      enabled: { type: 'boolean', default: true },
      fastPeriod: { type: 'number', default: 12, min: 5, max: 50 }
    };
    const constraints: ParameterConstraint[] = [
      { type: 'less_than', param1: 'weight', param2: 'fastPeriod', message: 'weight < fast' }
    ];

    const space = buildParameterSpace('test-001', schema, constraints);

    expect(space.constraints).toHaveLength(0);
  });

  it('should filter constraints referencing a filtered param2', () => {
    const schema = {
      fastPeriod: { type: 'number', default: 12, min: 5, max: 50 }
    };
    const constraints: ParameterConstraint[] = [
      { type: 'less_than', param1: 'fastPeriod', param2: 'nonExistent', message: 'fast < non' }
    ];

    const space = buildParameterSpace('test-001', schema, constraints);

    expect(space.constraints).toHaveLength(0);
  });

  it('should preserve value-based constraint (no param2)', () => {
    const schema = {
      fastPeriod: { type: 'number', default: 12, min: 5, max: 50 }
    };
    const constraints: ParameterConstraint[] = [
      { type: 'greater_than', param1: 'fastPeriod', value: 3, message: 'fast > 3' } as ParameterConstraint
    ];

    const space = buildParameterSpace('test-001', schema, constraints);

    expect(space.constraints).toHaveLength(1);
    expect(space.constraints![0].param1).toBe('fastPeriod');
  });

  it('should preserve description from schema fields', () => {
    const schema = {
      crossoverLookback: {
        type: 'number',
        default: 3,
        min: 1,
        max: 10,
        description: 'Number of bars to scan for crossover events'
      }
    };

    const space = buildParameterSpace('test-001', schema);

    expect(space.parameters[0].description).toBe('Number of bars to scan for crossover events');
  });
});
