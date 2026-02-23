import { SMA } from 'technicalindicators';

import { IncrementalSma } from './incremental-sma';

describe('IncrementalSma', () => {
  it('should throw on non-positive period', () => {
    expect(() => new IncrementalSma(0)).toThrow('positive integer');
    expect(() => new IncrementalSma(-1)).toThrow('positive integer');
    expect(() => new IncrementalSma(1.5)).toThrow('positive integer');
  });

  it('should return NaN when empty', () => {
    const sma = new IncrementalSma(5);
    expect(sma.value).toBeNaN();
    expect(sma.filled).toBe(false);
  });

  it('should compute partial (unfilled) average', () => {
    const sma = new IncrementalSma(5);
    sma.push(10);
    sma.push(20);
    expect(sma.value).toBe(15);
    expect(sma.filled).toBe(false);
  });

  it('should become filled after `period` values', () => {
    const sma = new IncrementalSma(3);
    sma.push(1);
    sma.push(2);
    expect(sma.filled).toBe(false);
    sma.push(3);
    expect(sma.filled).toBe(true);
    expect(sma.value).toBe(2); // (1+2+3)/3
  });

  it('should evict oldest on wrap-around', () => {
    const sma = new IncrementalSma(3);
    sma.push(1);
    sma.push(2);
    sma.push(3);
    sma.push(10); // evicts 1
    // (2 + 3 + 10) / 3 = 5
    expect(sma.value).toBe(5);
  });

  it('should handle period=1', () => {
    const sma = new IncrementalSma(1);
    sma.push(42);
    expect(sma.value).toBe(42);
    expect(sma.filled).toBe(true);
    sma.push(99);
    expect(sma.value).toBe(99);
  });

  it('should match SMA.calculate for a 500-value sequence', () => {
    const period = 200;
    const values: number[] = [];
    // Generate pseudo-random values
    let seed = 12345;
    for (let i = 0; i < 500; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      values.push(20000 + (seed % 10000));
    }

    const sma = new IncrementalSma(period);
    const expected = SMA.calculate({ period, values });

    // SMA.calculate returns values starting at index (period-1)
    // Our incremental SMA is filled after `period` pushes
    for (let i = 0; i < values.length; i++) {
      sma.push(values[i]);
      if (i >= period - 1) {
        const expectedIndex = i - (period - 1);
        expect(sma.value).toBeCloseTo(expected[expectedIndex], 6);
      }
    }
  });
});
