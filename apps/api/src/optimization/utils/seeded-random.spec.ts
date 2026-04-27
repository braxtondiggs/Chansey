import { makeRandom, resolveSeed } from './seeded-random';

describe('seeded-random', () => {
  describe('resolveSeed', () => {
    it('returns caller-provided non-negative integers as-is', () => {
      expect(resolveSeed(42)).toBe(42);
      expect(resolveSeed(0)).toBe(0);
      expect(resolveSeed(123456789)).toBe(123456789);
    });

    it('floors floating-point caller seeds', () => {
      expect(resolveSeed(3.7)).toBe(3);
    });

    it.each<[string, number | undefined]>([
      ['undefined', undefined],
      ['negative', -1],
      ['NaN', NaN],
      ['Infinity', Infinity]
    ])('generates a fresh 32-bit seed when input is %s', (_label, input) => {
      const seed = resolveSeed(input);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(0x100000000);
    });
  });

  describe('makeRandom', () => {
    it('produces identical sequences for the same seed', () => {
      const a = makeRandom(42);
      const b = makeRandom(42);
      const aValues = Array.from({ length: 1000 }, () => a());
      const bValues = Array.from({ length: 1000 }, () => b());
      expect(aValues).toEqual(bValues);
    });

    it('produces different sequences for different seeds', () => {
      const a = makeRandom(42);
      const b = makeRandom(43);
      const aValues = [a(), a(), a(), a(), a()];
      const bValues = [b(), b(), b(), b(), b()];
      expect(aValues).not.toEqual(bValues);
    });

    it('produces values in [0, 1)', () => {
      const r = makeRandom(7);
      for (let i = 0; i < 1000; i++) {
        const v = r();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });
});
