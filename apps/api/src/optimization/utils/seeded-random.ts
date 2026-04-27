import * as seedrandom from 'seedrandom';

/**
 * A seeded pseudo-random number generator producing values in [0, 1).
 *
 * Drop-in replacement for `Math.random` so deterministic code paths can swap
 * the global generator for one keyed off a stored seed.
 */
export type RandomFn = () => number;

/**
 * Resolve a seed: caller-provided wins, otherwise a fresh 32-bit random integer.
 *
 * Negative, non-finite, or undefined inputs all fall through to a fresh seed.
 * Floating values are floored so the persisted seed is always an integer.
 */
export function resolveSeed(seed: number | undefined): number {
  if (typeof seed === 'number' && Number.isFinite(seed) && seed >= 0) {
    return Math.floor(seed);
  }
  return Math.floor(Math.random() * 0x100000000);
}

/**
 * Build a `[0, 1)` PRNG from a numeric seed. Same input → same sequence.
 */
export function makeRandom(seed: number): RandomFn {
  return seedrandom(String(seed));
}

/**
 * Decimals-of-precision required to round-trip a step cleanly.
 * Floors at 4 to preserve current behavior for steps ≥ 0.0001.
 */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step >= 1) return 0;
  return Math.max(4, Math.ceil(-Math.log10(step)));
}
