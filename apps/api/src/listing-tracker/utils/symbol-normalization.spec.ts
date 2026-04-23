import { normalizeBaseSymbol, stripPairSuffix } from './symbol-normalization';

describe('symbol-normalization', () => {
  describe('stripPairSuffix', () => {
    it.each(['USD', 'USDC', 'USDT', 'EUR', 'GBP', 'JPY'])('strips %s when appended to a base', (suffix) => {
      expect(stripPairSuffix(`BTC${suffix}`)).toBe('BTC');
    });

    it('prefers the longer suffix (USDT over USD)', () => {
      expect(stripPairSuffix('BTCUSDT')).toBe('BTC');
    });

    it.each([
      ['foo', 'FOO'],
      ['BTC', 'BTC']
    ])('upper-cases %s to %s when no known suffix matches', (input, expected) => {
      expect(stripPairSuffix(input)).toBe(expected);
    });

    it('does not strip when the suffix would leave an empty string', () => {
      expect(stripPairSuffix('USD')).toBe('USD');
    });
  });

  describe('normalizeBaseSymbol', () => {
    it('upper-cases and aliases XBT → BTC', () => {
      expect(normalizeBaseSymbol('XBT')).toBe('BTC');
    });

    it('aliases XDG → DOGE (case-insensitive input)', () => {
      expect(normalizeBaseSymbol('xdg')).toBe('DOGE');
    });

    it('strips quote suffix before applying aliases', () => {
      expect(normalizeBaseSymbol('APXUSD')).toBe('APX');
    });

    it('composes suffix stripping and alias lookup (xbtusd → BTC)', () => {
      expect(normalizeBaseSymbol('xbtusd')).toBe('BTC');
    });

    it('returns a clean base for coinbase-style symbols', () => {
      expect(normalizeBaseSymbol('chip')).toBe('CHIP');
    });
  });
});
