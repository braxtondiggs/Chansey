import { RingBuffer } from './ring-buffer';

describe('RingBuffer', () => {
  it('should start empty', () => {
    const buf = new RingBuffer<number>(5);
    expect(buf.length).toBe(0);
    expect(buf.last()).toBeUndefined();
    expect(buf.get(0)).toBeUndefined();
    expect(buf.toArray()).toEqual([]);
    expect(buf.mapToArray((x) => x)).toEqual([]);
  });

  it('should push and retrieve elements before reaching capacity', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(10);
    buf.push(20);
    buf.push(30);

    expect(buf.length).toBe(3);
    expect(buf.get(0)).toBe(10);
    expect(buf.get(1)).toBe(20);
    expect(buf.get(2)).toBe(30);
    expect(buf.last()).toBe(30);
    expect(buf.toArray()).toEqual([10, 20, 30]);
  });

  it('should overwrite oldest elements when at capacity', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);

    buf.push(4); // evicts 1
    expect(buf.length).toBe(3);
    expect(buf.toArray()).toEqual([2, 3, 4]);
    expect(buf.get(0)).toBe(2);
    expect(buf.last()).toBe(4);

    buf.push(5); // evicts 2
    expect(buf.toArray()).toEqual([3, 4, 5]);
  });

  it('should handle wrapping around multiple times', () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 1; i <= 10; i++) {
      buf.push(i);
    }
    // Should contain [8, 9, 10]
    expect(buf.length).toBe(3);
    expect(buf.toArray()).toEqual([8, 9, 10]);
    expect(buf.get(0)).toBe(8);
    expect(buf.get(1)).toBe(9);
    expect(buf.get(2)).toBe(10);
    expect(buf.last()).toBe(10);
  });

  it('should return undefined for out-of-range indices', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);

    expect(buf.get(-1)).toBeUndefined();
    expect(buf.get(2)).toBeUndefined();
    expect(buf.get(100)).toBeUndefined();
  });

  it('should handle capacity of 1', () => {
    const buf = new RingBuffer<number>(1);
    buf.push(42);
    expect(buf.length).toBe(1);
    expect(buf.last()).toBe(42);
    expect(buf.toArray()).toEqual([42]);

    buf.push(99);
    expect(buf.length).toBe(1);
    expect(buf.last()).toBe(99);
    expect(buf.toArray()).toEqual([99]);
  });

  it('should clear all elements', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.clear();

    expect(buf.length).toBe(0);
    expect(buf.last()).toBeUndefined();
    expect(buf.toArray()).toEqual([]);
  });

  it('should work correctly after clear and re-push', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.clear();
    buf.push(10);
    buf.push(20);

    expect(buf.length).toBe(2);
    expect(buf.toArray()).toEqual([10, 20]);
    expect(buf.last()).toBe(20);
  });

  it('should throw on non-positive capacity', () => {
    expect(() => new RingBuffer<number>(0)).toThrow('RingBuffer capacity must be a positive integer');
    expect(() => new RingBuffer<number>(-1)).toThrow('RingBuffer capacity must be a positive integer');
  });

  it('should map elements without intermediate array via mapToArray', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);

    expect(buf.mapToArray((x) => x * 10)).toEqual([10, 20, 30]);
  });

  it('should mapToArray correctly after wrap-around', () => {
    const buf = new RingBuffer<{ close?: number; avg: number }>(3);
    buf.push({ avg: 1 });
    buf.push({ close: 20, avg: 2 });
    buf.push({ avg: 3 });
    buf.push({ close: 40, avg: 4 }); // evicts first

    expect(buf.mapToArray((p) => p.close ?? p.avg)).toEqual([20, 3, 40]);
  });
});
