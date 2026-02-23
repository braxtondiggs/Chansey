/**
 * O(1) incremental Simple Moving Average backed by a circular `Float64Array`.
 *
 * Replaces the per-bar `SMA.calculate()` call in `computeCompositeRegime`
 * which allocated a full array and recomputed all values on every iteration.
 *
 * - `push(value)`: O(1) — updates running sum, evicts oldest via circular buffer.
 * - `value`:       O(1) — returns `sum / count`.
 * - `filled`:      true when `count >= period`.
 */
export class IncrementalSma {
  private readonly buf: Float64Array;
  private head = 0;
  private count = 0;
  private sum = 0;

  constructor(private readonly period: number) {
    if (!Number.isInteger(period) || period < 1) {
      throw new Error('IncrementalSma period must be a positive integer');
    }
    this.buf = new Float64Array(period);
  }

  /** Feed a new value into the SMA. O(1). */
  push(value: number): void {
    if (this.count >= this.period) {
      // Evict the oldest value
      this.sum -= this.buf[this.head];
    }
    this.buf[this.head] = value;
    this.sum += value;
    this.head = (this.head + 1) % this.period;
    if (this.count < this.period) {
      this.count++;
    }
  }

  /** Current SMA value. Returns NaN if no values have been pushed. */
  get value(): number {
    return this.count === 0 ? NaN : this.sum / this.count;
  }

  /** True when at least `period` values have been pushed. */
  get filled(): boolean {
    return this.count >= this.period;
  }
}
