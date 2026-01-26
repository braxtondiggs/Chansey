/* eslint-disable @typescript-eslint/no-empty-function */
import { isObjectSafe, sanitizeObject } from './sanitize.util';

describe('sanitizeObject', () => {
  it('should pass through valid simple objects', () => {
    const input = { name: 'test', value: 123, active: true, empty: null };
    const result = sanitizeObject(input);
    expect(result).toEqual(input);
  });

  it('should handle nested objects within depth limit', () => {
    const input = { level1: { level2: { level3: 'value' } } };
    const result = sanitizeObject(input, { maxDepth: 5 });
    expect(result).toEqual(input);
  });

  it('should throw on objects exceeding max depth', () => {
    const input = { l1: { l2: { l3: { l4: 'value' } } } };
    expect(() => sanitizeObject(input, { maxDepth: 2 })).toThrow('exceeds maximum depth');
  });

  it('should remove __proto__ keys (prototype pollution prevention)', () => {
    // Create object with __proto__ as own property using Object.defineProperty
    const input = Object.create(null);
    input.valid = 'data';
    Object.defineProperty(input, '__proto__', { value: { polluted: true }, enumerable: true });

    const result = sanitizeObject(input);
    expect(result).toEqual({ valid: 'data' });
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
  });

  it('should remove constructor keys', () => {
    const input = { valid: 'data', constructor: { prototype: {} } };
    const result = sanitizeObject(input);
    expect(result).toEqual({ valid: 'data' });
  });

  it('should remove keys starting with __', () => {
    const input = { valid: 'data', __defineGetter__: () => {}, __lookupSetter__: () => {} };
    const result = sanitizeObject(input);
    expect(result).toEqual({ valid: 'data' });
  });

  it('should throw on objects with too many keys', () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < 101; i++) {
      input[`key${i}`] = i;
    }
    expect(() => sanitizeObject(input, { maxKeys: 100 })).toThrow('exceeds maximum key count');
  });

  it('should throw on strings exceeding max length', () => {
    const input = { text: 'a'.repeat(1001) };
    expect(() => sanitizeObject(input, { maxStringLength: 1000 })).toThrow('exceeds maximum length');
  });

  it('should handle arrays when allowed', () => {
    const input = { items: [1, 2, 3], names: ['a', 'b'] };
    const result = sanitizeObject(input, { allowArrays: true });
    expect(result).toEqual(input);
  });

  it('should throw when arrays are not allowed', () => {
    const input = { items: [1, 2, 3] };
    expect(() => sanitizeObject(input, { allowArrays: false })).toThrow('Arrays are not allowed');
  });

  it('should throw on arrays exceeding max length', () => {
    const input = { items: Array(101).fill(1) };
    expect(() => sanitizeObject(input, { maxArrayLength: 100 })).toThrow('exceeds maximum length');
  });

  it('should convert NaN and Infinity to null', () => {
    const input = { nan: NaN, inf: Infinity, negInf: -Infinity };
    const result = sanitizeObject(input);
    expect(result).toEqual({ nan: null, inf: null, negInf: null });
  });

  it('should convert undefined to null', () => {
    const input = { value: undefined };
    const result = sanitizeObject(input);
    expect(result).toEqual({ value: null });
  });

  it('should throw on function values', () => {
    const input = { fn: () => {} };
    expect(() => sanitizeObject(input as any)).toThrow('Unsupported value type');
  });

  it('should throw when number type is not allowed', () => {
    const input = { value: 123 };
    expect(() => sanitizeObject(input, { allowedTypes: ['string'] })).toThrow('Number values are not allowed');
  });

  it('should sanitize nested arrays', () => {
    const input = {
      matrix: [
        [1, 2],
        [3, 4]
      ]
    };
    const result = sanitizeObject(input, { maxDepth: 5 });
    expect(result).toEqual(input);
  });

  it('should sanitize array of objects', () => {
    const input = { items: [{ a: 1 }, { b: 2 }] };
    const result = sanitizeObject(input);
    expect(result).toEqual(input);
  });

  it('should remove dangerous keys from nested objects', () => {
    const input = { outer: { __proto__: { bad: true }, valid: 'ok' } };
    const result = sanitizeObject(input);
    expect(result).toEqual({ outer: { valid: 'ok' } });
  });
});

describe('isObjectSafe', () => {
  it('should return true for valid objects', () => {
    expect(isObjectSafe({ name: 'test', value: 123 })).toBe(true);
  });

  it('should return false for objects exceeding limits', () => {
    const deepObject = { l1: { l2: { l3: { l4: { l5: 'deep' } } } } };
    expect(isObjectSafe(deepObject, { maxDepth: 3 })).toBe(false);
  });

  it('should return false for objects with forbidden types', () => {
    const objWithFunction = { fn: () => {} };
    expect(isObjectSafe(objWithFunction as any)).toBe(false);
  });
});
