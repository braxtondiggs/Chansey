import {
  CCXT_DECIMAL_PLACES,
  CCXT_SIGNIFICANT_DIGITS,
  CCXT_TICK_SIZE,
  extractMarketLimits,
  precisionToStepSize
} from './precision.util';

describe('precisionToStepSize', () => {
  it('returns the value directly for TICK_SIZE mode', () => {
    expect(precisionToStepSize(0.001, CCXT_TICK_SIZE)).toBe(0.001);
    expect(precisionToStepSize(0.01, CCXT_TICK_SIZE)).toBe(0.01);
    expect(precisionToStepSize(1, CCXT_TICK_SIZE)).toBe(1);
  });

  it.each([
    [2, CCXT_DECIMAL_PLACES, 0.01],
    [8, CCXT_DECIMAL_PLACES, 1e-8],
    [0, CCXT_DECIMAL_PLACES, 1],
    [3, CCXT_SIGNIFICANT_DIGITS, 0.001],
    [1, CCXT_SIGNIFICANT_DIGITS, 0.1]
  ])('converts count %d (mode %d) to step size %f', (value, mode, expected) => {
    expect(precisionToStepSize(value, mode)).toBeCloseTo(expected);
  });

  it.each([null, undefined])('returns 0 when precision value is %s', (value) => {
    expect(precisionToStepSize(value, CCXT_DECIMAL_PLACES)).toBe(0);
    expect(precisionToStepSize(value, CCXT_TICK_SIZE)).toBe(0);
  });

  it.each([undefined, null, 999])('falls back to DECIMAL_PLACES when mode is %s', (mode) => {
    expect(precisionToStepSize(2, mode)).toBeCloseTo(0.01);
  });
});

describe('extractMarketLimits', () => {
  it('returns zeroes for null/undefined market', () => {
    const expected = { minQuantity: 0, maxQuantity: 0, minCost: 0, quantityStep: 0, priceStep: 0 };
    expect(extractMarketLimits(null, CCXT_DECIMAL_PLACES)).toEqual(expected);
    expect(extractMarketLimits(undefined, CCXT_TICK_SIZE)).toEqual(expected);
  });

  it('extracts limits using TICK_SIZE mode', () => {
    const market = {
      limits: { amount: { min: 0.001, max: 9000 }, cost: { min: 10 } },
      precision: { amount: 0.001, price: 0.01 }
    };
    expect(extractMarketLimits(market, CCXT_TICK_SIZE)).toEqual({
      minQuantity: 0.001,
      maxQuantity: 9000,
      minCost: 10,
      quantityStep: 0.001,
      priceStep: 0.01
    });
  });

  it('extracts limits using DECIMAL_PLACES mode', () => {
    const market = {
      limits: { amount: { min: 0.01, max: 5000 }, cost: { min: 5 } },
      precision: { amount: 3, price: 2 }
    };
    const result = extractMarketLimits(market, CCXT_DECIMAL_PLACES);
    expect(result.minQuantity).toBe(0.01);
    expect(result.maxQuantity).toBe(5000);
    expect(result.minCost).toBe(5);
    expect(result.quantityStep).toBeCloseTo(0.001);
    expect(result.priceStep).toBeCloseTo(0.01);
  });

  it('preserves explicit 0 limits via nullish coalescing', () => {
    const market = {
      limits: { amount: { min: 0, max: 0 }, cost: { min: 0 } },
      precision: { amount: 2, price: 2 }
    };
    const result = extractMarketLimits(market, CCXT_DECIMAL_PLACES);
    expect(result.minQuantity).toBe(0);
    expect(result.maxQuantity).toBe(0);
    expect(result.minCost).toBe(0);
  });

  it('defaults missing nested keys to 0 without throwing', () => {
    const market = { limits: { amount: { min: 1 } }, precision: {} };
    const result = extractMarketLimits(market, CCXT_TICK_SIZE);
    expect(result.minQuantity).toBe(1);
    expect(result.maxQuantity).toBe(0);
    expect(result.minCost).toBe(0);
    expect(result.quantityStep).toBe(0);
    expect(result.priceStep).toBe(0);
  });
});
