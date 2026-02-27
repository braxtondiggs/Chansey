import { getMaxLeverage } from './leverage-limits';

describe('getMaxLeverage', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 5],
    [5, 10]
  ])('risk level %i → leverage %i', (riskLevel, expected) => {
    expect(getMaxLeverage(riskLevel)).toBe(expected);
  });

  it('should clamp below-range input to risk level 1', () => {
    expect(getMaxLeverage(0)).toBe(1);
    expect(getMaxLeverage(-100)).toBe(1);
  });

  it('should clamp above-range input to risk level 5', () => {
    expect(getMaxLeverage(6)).toBe(10);
    expect(getMaxLeverage(999)).toBe(10);
  });

  it('should round fractional inputs before mapping', () => {
    expect(getMaxLeverage(2.4)).toBe(2); // rounds down
    expect(getMaxLeverage(2.5)).toBe(3); // rounds up at .5
  });
});
