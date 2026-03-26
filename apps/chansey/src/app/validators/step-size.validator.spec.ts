import { FormControl } from '@angular/forms';

import { getPrecisionFromStep, snapToStep, stepSizeValidator } from './step-size.validator';

describe('stepSizeValidator', () => {
  it.each([
    [0.01, 0.02, 'decimal multiple'],
    [0.1, 0.3, 'float-precision edge case (0.3 / 0.1)'],
    [1, 5, 'whole number multiple'],
    [1e-8, 0.00000002, 'scientific notation step']
  ])('should accept valid value (step=%s, value=%s, %s)', (step, value) => {
    const validator = stepSizeValidator(step);
    expect(validator(new FormControl(value))).toBeNull();
  });

  it.each([
    [0.01, 0.015],
    [1, 5.5],
    [1e-8, 0.000000015]
  ])('should reject value not on step boundary (step=%s, value=%s)', (step, value) => {
    const validator = stepSizeValidator(step);
    expect(validator(new FormControl(value))).toEqual({ stepSize: { requiredStep: step, actualValue: value } });
  });

  it.each<[string | null, string]>([
    [null, 'null'],
    ['', 'empty string']
  ])('should skip validation for %s input (%s)', (value) => {
    const validator = stepSizeValidator(0.01);
    expect(validator(new FormControl(value))).toBeNull();
  });

  it.each([
    [0, 'zero'],
    [-1, 'negative']
  ])('should skip validation when stepSize is %s (%s)', (step) => {
    const validator = stepSizeValidator(step);
    expect(validator(new FormControl(0.5))).toBeNull();
  });
});

describe('snapToStep', () => {
  it.each([
    [0.123, 0.01, 0.12, 'snaps down decimal'],
    [0.3, 0.1, 0.3, 'handles float-precision (0.3 / 0.1)'],
    [7.9, 1, 7, 'snaps down whole number'],
    [0.00123, 0.001, 0.001, 'handles high-precision step'],
    [0.000000019, 1e-8, 0.00000001, 'snaps down with scientific notation step']
  ])('snapToStep(%s, %s) → %s (%s)', (value, step, expected) => {
    expect(snapToStep(value, step)).toBe(expected);
  });

  it('should return value unchanged when stepSize is 0', () => {
    expect(snapToStep(1.234, 0)).toBe(1.234);
  });

  it('should handle negative values', () => {
    expect(snapToStep(-0.123, 0.01)).toBe(-0.13);
  });
});

describe('getPrecisionFromStep', () => {
  it.each([
    [0.001, 3],
    [0.01, 2],
    [0.1, 1],
    [1, 0],
    [10, 0],
    [1e-8, 8],
    [1e-6, 6]
  ])('getPrecisionFromStep(%s) → %s', (step, expected) => {
    expect(getPrecisionFromStep(step)).toBe(expected);
  });
});
