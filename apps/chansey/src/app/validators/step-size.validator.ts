import { AbstractControl, ValidatorFn } from '@angular/forms';

/**
 * Validates that a value is a multiple of the given step size.
 * Uses multiplier-based modulo with epsilon tolerance, mirroring the backend's `isValidTickSize`.
 */
export function stepSizeValidator(stepSize: number): ValidatorFn {
  return (control: AbstractControl) => {
    const value = control.value;
    if (value == null || value === '' || stepSize <= 0) return null;

    const precision = getPrecisionFromStep(stepSize);
    const multiplier = Math.pow(10, precision);
    const remainder = Math.abs((value * multiplier) % (stepSize * multiplier));

    if (remainder > Number.EPSILON) {
      return { stepSize: { requiredStep: stepSize, actualValue: value } };
    }

    return null;
  };
}

/**
 * Rounds a value down to the nearest valid step (mirrors backend's `calculateMaxQuantity`).
 */
export function snapToStep(value: number, stepSize: number): number {
  if (stepSize <= 0) return value;
  const precision = getPrecisionFromStep(stepSize);
  const multiplier = Math.pow(10, precision);
  const scaledValue = value * multiplier;
  const scaledStep = stepSize * multiplier;
  const maxSteps = Math.floor(scaledValue / scaledStep + Number.EPSILON);
  return Number((maxSteps * stepSize).toFixed(precision));
}

export function getPrecisionFromStep(stepSize: number): number {
  const s = String(stepSize);
  if (s.includes('e-')) {
    const [mantissa, exp] = s.split('e-');
    const mantissaDecimals = mantissa.split('.')[1]?.length || 0;
    return mantissaDecimals + parseInt(exp, 10);
  }
  return s.split('.')[1]?.length || 0;
}
