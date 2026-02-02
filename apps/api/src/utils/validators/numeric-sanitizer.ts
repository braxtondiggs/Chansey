import { Logger } from '@nestjs/common';

const logger = new Logger('NumericSanitizer');

export interface SanitizeNumericOptions {
  /** Maximum number of integer digits allowed (default: 30 for NUMERIC(38,8)) */
  maxIntegerDigits?: number;
  /** Whether to allow negative values (default: true) */
  allowNegative?: boolean;
  /** Field name for logging purposes */
  fieldName?: string;
}

/**
 * Sanitizes numeric values before database storage to prevent overflow errors.
 *
 * Handles the following cases:
 * - null/undefined -> returns null
 * - Infinity/-Infinity -> returns null with warning
 * - NaN -> returns null with warning
 * - Values exceeding max digits -> returns null with warning
 * - String numbers -> converts to number
 * - Valid numbers -> returns as-is
 *
 * @param value The value to sanitize
 * @param options Configuration options
 * @returns Sanitized number or null if invalid
 */
export function sanitizeNumericValue(value: unknown, options: SanitizeNumericOptions = {}): number | null {
  const { maxIntegerDigits = 30, allowNegative = true, fieldName = 'unknown' } = options;

  // Handle null/undefined
  if (value === null || value === undefined) {
    return null;
  }

  // Convert string to number if needed
  let numValue: number;
  if (typeof value === 'string') {
    numValue = parseFloat(value);
  } else if (typeof value === 'number') {
    numValue = value;
  } else {
    logger.warn(`[${fieldName}] Invalid type: ${typeof value}, returning null`);
    return null;
  }

  // Handle NaN
  if (Number.isNaN(numValue)) {
    logger.warn(`[${fieldName}] NaN value detected, returning null`);
    return null;
  }

  // Handle Infinity
  if (!Number.isFinite(numValue)) {
    logger.warn(`[${fieldName}] Infinity value detected, returning null`);
    return null;
  }

  // Check for negative values if not allowed
  if (!allowNegative && numValue < 0) {
    logger.warn(`[${fieldName}] Negative value not allowed: ${numValue}, returning null`);
    return null;
  }

  // Check for overflow: count integer digits
  const absValue = Math.abs(numValue);
  const integerPart = Math.floor(absValue);
  const integerDigits = integerPart === 0 ? 1 : BigInt(integerPart).toString().length;

  if (integerDigits > maxIntegerDigits) {
    logger.warn(
      `[${fieldName}] Value exceeds max integer digits (${integerDigits} > ${maxIntegerDigits}): ${numValue}, returning null`
    );
    return null;
  }

  return numValue;
}

/**
 * Batch sanitize multiple numeric values with the same options.
 *
 * @param values Object mapping field names to values
 * @param baseOptions Base options applied to all fields
 * @returns Object with sanitized values
 */
export function sanitizeNumericValues<T extends Record<string, unknown>>(
  values: T,
  baseOptions: Omit<SanitizeNumericOptions, 'fieldName'> = {}
): Record<keyof T, number | null> {
  const result = {} as Record<keyof T, number | null>;

  for (const key of Object.keys(values) as Array<keyof T>) {
    result[key] = sanitizeNumericValue(values[key], {
      ...baseOptions,
      fieldName: String(key)
    });
  }

  return result;
}
