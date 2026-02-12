/**
 * Utility for sanitizing user input objects to prevent prototype pollution
 * and other injection attacks when storing data in JSONB fields.
 */

export interface SanitizeOptions {
  /** Maximum depth of nested objects allowed (default: 10) */
  maxDepth?: number;
  /** Maximum number of keys allowed per object (default: 100) */
  maxKeys?: number;
  /** Allowed primitive types (default: all JSON-compatible types) */
  allowedTypes?: Array<'string' | 'number' | 'boolean' | 'null'>;
  /** Maximum string length (default: 10000) */
  maxStringLength?: number;
  /** Allow arrays (default: true) */
  allowArrays?: boolean;
  /** Maximum array length (default: 1000) */
  maxArrayLength?: number;
}

const DANGEROUS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__'
]);

const DEFAULT_OPTIONS: Required<SanitizeOptions> = {
  maxDepth: 10,
  maxKeys: 100,
  allowedTypes: ['string', 'number', 'boolean', 'null'],
  maxStringLength: 10000,
  allowArrays: true,
  maxArrayLength: 1000
};

/**
 * Sanitizes an object by removing dangerous keys and enforcing depth/size limits.
 * Returns a deep copy of the object with only safe values.
 *
 * @param obj - The object to sanitize
 * @param options - Sanitization options
 * @returns Sanitized copy of the object
 * @throws Error if the object exceeds configured limits
 */
export function sanitizeObject<T extends Record<string, unknown>>(
  obj: T,
  options: SanitizeOptions = {}
): Record<string, unknown> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return sanitizeValue(obj, opts, 0) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, options: Required<SanitizeOptions>, depth: number): unknown {
  // Check depth limit
  if (depth > options.maxDepth) {
    throw new Error(`Object exceeds maximum depth of ${options.maxDepth}`);
  }

  // Handle null
  if (value === null) {
    if (!options.allowedTypes.includes('null')) {
      throw new Error('Null values are not allowed');
    }
    return null;
  }

  // Handle undefined - convert to null for JSON compatibility
  if (value === undefined) {
    return null;
  }

  // Handle primitives
  const valueType = typeof value;

  if (valueType === 'string') {
    if (!options.allowedTypes.includes('string')) {
      throw new Error('String values are not allowed');
    }
    if ((value as string).length > options.maxStringLength) {
      throw new Error(`String exceeds maximum length of ${options.maxStringLength}`);
    }
    return value;
  }

  if (valueType === 'number') {
    if (!options.allowedTypes.includes('number')) {
      throw new Error('Number values are not allowed');
    }
    // Reject NaN and Infinity as they're not valid JSON
    if (!Number.isFinite(value as number)) {
      return null;
    }
    return value;
  }

  if (valueType === 'boolean') {
    if (!options.allowedTypes.includes('boolean')) {
      throw new Error('Boolean values are not allowed');
    }
    return value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (!options.allowArrays) {
      throw new Error('Arrays are not allowed');
    }
    if (value.length > options.maxArrayLength) {
      throw new Error(`Array exceeds maximum length of ${options.maxArrayLength}`);
    }
    return value.map((item) => sanitizeValue(item, options, depth + 1));
  }

  // Handle objects
  if (valueType === 'object') {
    const keys = Object.keys(value as object);

    if (keys.length > options.maxKeys) {
      throw new Error(`Object exceeds maximum key count of ${options.maxKeys}`);
    }

    const result: Record<string, unknown> = {};

    for (const key of keys) {
      // Skip dangerous keys
      if (DANGEROUS_KEYS.has(key)) {
        continue;
      }

      // Skip keys that could be used for prototype pollution
      if (key.startsWith('__') || key.includes('constructor')) {
        continue;
      }

      const sanitizedValue = sanitizeValue((value as Record<string, unknown>)[key], options, depth + 1);
      result[key] = sanitizedValue;
    }

    return result;
  }

  // Reject functions, symbols, and other non-JSON types
  throw new Error(`Unsupported value type: ${valueType}`);
}

/**
 * Checks if an object is safe without modifying it.
 * Returns true if the object passes all sanitization checks.
 *
 * @param obj - The object to check
 * @param options - Sanitization options
 * @returns true if the object is safe, false otherwise
 */
export function isObjectSafe(obj: unknown, options: SanitizeOptions = {}): boolean {
  try {
    sanitizeObject(obj as Record<string, unknown>, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Escapes SQL LIKE wildcard characters (%, _, \) in user input
 * to prevent wildcard injection in ILIKE/LIKE queries.
 */
export function escapeLikeWildcards(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}
