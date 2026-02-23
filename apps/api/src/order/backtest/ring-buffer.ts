/**
 * Fixed-capacity circular buffer backed by a pre-allocated array.
 *
 * Replaces the `Array.push() + Array.splice(0, excess)` pattern in
 * `advancePriceWindows` — turning O(K) splice into O(1) push.
 *
 * - `push(item)`: O(1) — overwrites oldest when full.
 * - `get(index)`: O(1) — logical-to-physical index mapping.
 * - `last()`: O(1) — most recent element.
 * - `toArray()`: O(K) — snapshot in insertion order (oldest → newest).
 * - `length`: current number of elements (≤ capacity).
 */
export class RingBuffer<T> {
  private readonly buf: (T | undefined)[];
  private head = 0; // next write position
  private count = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new Error('RingBuffer capacity must be a positive integer');
    this.buf = new Array<T | undefined>(capacity);
  }

  /** Number of elements currently stored. */
  get length(): number {
    return this.count;
  }

  /** Add an element. If at capacity, overwrites the oldest element. O(1). */
  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Retrieve element by logical index (0 = oldest, length-1 = newest). O(1).
   * Returns undefined if index is out of range.
   */
  get(index: number): T | undefined {
    if (index < 0 || index >= this.count) {
      return undefined;
    }
    // Oldest element starts at `head - count` (wrapped)
    const physicalIndex = (this.head - this.count + index + this.capacity) % this.capacity;
    return this.buf[physicalIndex];
  }

  /** Return the most recently pushed element. O(1). */
  last(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return this.buf[(this.head - 1 + this.capacity) % this.capacity];
  }

  /** Return all elements as an array in insertion order (oldest → newest). O(K). */
  toArray(): T[] {
    if (this.count === 0) {
      return [];
    }
    const result = new Array<T>(this.count);
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(start + i) % this.capacity] as T;
    }
    return result;
  }

  /** Map elements to a new array in insertion order without creating an intermediate array. O(K). */
  mapToArray<U>(mapper: (value: T) => U): U[] {
    if (this.count === 0) {
      return [];
    }
    const result = new Array<U>(this.count);
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      result[i] = mapper(this.buf[(start + i) % this.capacity] as T);
    }
    return result;
  }

  /** Clear all elements. */
  clear(): void {
    this.head = 0;
    this.count = 0;
    // Zero out references to allow GC
    this.buf.fill(undefined);
  }
}
