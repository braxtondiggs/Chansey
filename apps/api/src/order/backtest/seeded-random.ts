/**
 * A deterministic pseudo-random number generator with state save/restore capability.
 * Uses a hash-based algorithm that produces identical sequences from the same seed.
 *
 * This is essential for checkpoint/resume functionality - by saving and restoring
 * the internal state, we can ensure that resumed backtests produce identical results
 * to uninterrupted runs.
 */
export class SeededRandom {
  private h: number;

  /**
   * Create a new SeededRandom generator from a seed string.
   * @param seed The seed string to initialize the generator
   */
  constructor(seed: string) {
    // Initialize hash with seed length XOR'd with a large prime
    this.h = 1779033703 ^ seed.length;

    // Hash each character of the seed
    for (let i = 0; i < seed.length; i++) {
      this.h = Math.imul(this.h ^ seed.charCodeAt(i), 3432918353);
      this.h = (this.h << 13) | (this.h >>> 19);
    }
  }

  /**
   * Generate the next random number in the sequence.
   * @returns A number in the range [0, 1)
   */
  next(): number {
    // Xorshift-based mixing
    this.h = Math.imul(this.h ^ (this.h >>> 16), 2246822507);
    this.h = Math.imul(this.h ^ (this.h >>> 13), 3266489909);
    this.h ^= this.h >>> 16;

    // Convert to [0, 1) range
    return (this.h >>> 0) / 4294967296;
  }

  /**
   * Generate a random number in a specified range.
   * @param min Minimum value (inclusive)
   * @param max Maximum value (exclusive)
   * @returns A number in the range [min, max)
   */
  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Generate a random integer in a specified range.
   * @param min Minimum value (inclusive)
   * @param max Maximum value (exclusive)
   * @returns An integer in the range [min, max)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.nextRange(min, max));
  }

  /**
   * Get the internal state for checkpointing.
   * This allows the generator to be restored to exactly this point in the sequence.
   * @returns The internal hash state
   */
  getState(): number {
    return this.h;
  }

  /**
   * Restore a generator from a checkpointed state.
   * The restored generator will produce the same sequence as if
   * the original generator had continued from that point.
   * @param state The internal state to restore
   * @returns A new SeededRandom instance at the given state
   */
  static fromState(state: number): SeededRandom {
    const instance = Object.create(SeededRandom.prototype) as SeededRandom;
    instance.h = state;
    return instance;
  }
}

/**
 * Create a SeededRandom generator from a seed string.
 * Convenience function that matches the old createSeededGenerator signature.
 * @param seed The seed string
 * @returns A SeededRandom instance
 */
export const createSeededRandom = (seed: string): SeededRandom => {
  return new SeededRandom(seed);
};
