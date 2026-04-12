import { mapSlippageModelType } from './slippage-model-type.util';
import { SlippageModelType } from './slippage.interface';

describe('mapSlippageModelType', () => {
  it.each([
    ['none', SlippageModelType.NONE],
    ['volume-based', SlippageModelType.VOLUME_BASED],
    ['historical', SlippageModelType.HISTORICAL],
    ['spread-adjusted', SlippageModelType.SPREAD_ADJUSTED],
    ['fixed', SlippageModelType.FIXED]
  ])('should map "%s" to %s', (input, expected) => {
    expect(mapSlippageModelType(input)).toBe(expected);
  });

  it('should default to FIXED for undefined', () => {
    expect(mapSlippageModelType(undefined)).toBe(SlippageModelType.FIXED);
  });

  it('should default to FIXED for unknown string', () => {
    expect(mapSlippageModelType('unknown')).toBe(SlippageModelType.FIXED);
  });
});
