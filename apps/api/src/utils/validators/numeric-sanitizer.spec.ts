import { sanitizeNumericValue, sanitizeNumericValues } from './numeric-sanitizer';

describe('sanitizeNumericValue', () => {
  describe('null/undefined handling', () => {
    it('should return null for null input', () => {
      expect(sanitizeNumericValue(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(sanitizeNumericValue(undefined)).toBeNull();
    });
  });

  describe('Infinity handling', () => {
    it('should return null for Infinity', () => {
      expect(sanitizeNumericValue(Infinity)).toBeNull();
    });

    it('should return null for -Infinity', () => {
      expect(sanitizeNumericValue(-Infinity)).toBeNull();
    });
  });

  describe('NaN handling', () => {
    it('should return null for NaN', () => {
      expect(sanitizeNumericValue(NaN)).toBeNull();
    });

    it('should return null for NaN from string', () => {
      expect(sanitizeNumericValue('not a number')).toBeNull();
    });
  });

  describe('valid number handling', () => {
    it('should pass through valid positive numbers', () => {
      expect(sanitizeNumericValue(123.456)).toBe(123.456);
    });

    it('should pass through valid negative numbers', () => {
      expect(sanitizeNumericValue(-123.456)).toBe(-123.456);
    });

    it('should pass through zero', () => {
      expect(sanitizeNumericValue(0)).toBe(0);
    });

    it('should pass through large valid numbers', () => {
      const largeValue = 1e20;
      expect(sanitizeNumericValue(largeValue)).toBe(largeValue);
    });

    it('should pass through very small decimals', () => {
      const smallValue = 0.00000001;
      expect(sanitizeNumericValue(smallValue)).toBe(smallValue);
    });
  });

  describe('string input handling', () => {
    it('should convert valid numeric strings to numbers', () => {
      expect(sanitizeNumericValue('123.456')).toBe(123.456);
    });

    it('should convert negative numeric strings', () => {
      expect(sanitizeNumericValue('-456.789')).toBe(-456.789);
    });

    it('should handle scientific notation strings', () => {
      expect(sanitizeNumericValue('1.5e10')).toBe(1.5e10);
    });
  });

  describe('overflow detection', () => {
    it('should reject values exceeding max integer digits', () => {
      // 31 digit integer exceeds default max of 30
      const overflowValue = 1e31;
      expect(sanitizeNumericValue(overflowValue)).toBeNull();
    });

    it('should accept values within max integer digits', () => {
      // 30 digit integer is within default max
      const validValue = 1e29;
      expect(sanitizeNumericValue(validValue)).toBe(validValue);
    });

    it('should respect custom maxIntegerDigits', () => {
      const value = 1e10; // 11 digits
      expect(sanitizeNumericValue(value, { maxIntegerDigits: 10 })).toBeNull();
      expect(sanitizeNumericValue(value, { maxIntegerDigits: 15 })).toBe(value);
    });
  });

  describe('negative value handling', () => {
    it('should reject negative values when allowNegative is false', () => {
      expect(sanitizeNumericValue(-100, { allowNegative: false })).toBeNull();
    });

    it('should accept negative values when allowNegative is true', () => {
      expect(sanitizeNumericValue(-100, { allowNegative: true })).toBe(-100);
    });

    it('should accept negative values by default', () => {
      expect(sanitizeNumericValue(-100)).toBe(-100);
    });

    it('should accept zero when allowNegative is false', () => {
      expect(sanitizeNumericValue(0, { allowNegative: false })).toBe(0);
    });
  });

  describe('invalid type handling', () => {
    it('should return null for object input', () => {
      expect(sanitizeNumericValue({})).toBeNull();
    });

    it('should return null for array input', () => {
      expect(sanitizeNumericValue([])).toBeNull();
    });

    it('should return null for boolean input', () => {
      expect(sanitizeNumericValue(true)).toBeNull();
    });
  });
});

describe('sanitizeNumericValues', () => {
  it('should sanitize multiple values', () => {
    const input = {
      valid: 100,
      infinity: Infinity,
      nan: NaN,
      negative: -50
    };

    const result = sanitizeNumericValues(input);

    expect(result.valid).toBe(100);
    expect(result.infinity).toBeNull();
    expect(result.nan).toBeNull();
    expect(result.negative).toBe(-50);
  });

  it('should apply base options to all values', () => {
    const input = {
      positive: 100,
      negative: -50
    };

    const result = sanitizeNumericValues(input, { allowNegative: false });

    expect(result.positive).toBe(100);
    expect(result.negative).toBeNull();
  });

  it('should handle empty object', () => {
    const result = sanitizeNumericValues({});
    expect(result).toEqual({});
  });
});
