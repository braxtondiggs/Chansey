import { ColumnNumericTransformer } from '../utils/transformers/columnNumeric.transformer';

describe('Coin entity numeric column transformer', () => {
  const transformer = new ColumnNumericTransformer();

  it('coerces decimal-string values (like THETA currentPrice) to finite numbers', () => {
    const result = transformer.from('0.22200000');
    expect(typeof result).toBe('number');
    expect(result).toBe(0.222);
  });

  it('passes through null without coercing to NaN', () => {
    expect(transformer.from(null)).toBeNull();
  });
});
