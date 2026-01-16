import { SeededRandom } from './seeded-random';

describe('SeededRandom', () => {
  it('produces deterministic sequences for the same seed', () => {
    const first = new SeededRandom('seed-123');
    const second = new SeededRandom('seed-123');

    const sequenceA = Array.from({ length: 5 }, () => first.next());
    const sequenceB = Array.from({ length: 5 }, () => second.next());

    expect(sequenceA).toEqual(sequenceB);
  });

  it('restores state to resume the same sequence', () => {
    const rng = new SeededRandom('checkpoint-seed');
    rng.next();
    rng.next();
    const state = rng.getState();

    const expected = [rng.next(), rng.next(), rng.next()];
    const resumed = SeededRandom.fromState(state);
    const actual = [resumed.next(), resumed.next(), resumed.next()];

    expect(actual).toEqual(expected);
  });

  it('produces different sequences for different seeds', () => {
    const first = new SeededRandom('seed-a');
    const second = new SeededRandom('seed-b');

    const sequenceA = Array.from({ length: 5 }, () => first.next());
    const sequenceB = Array.from({ length: 5 }, () => second.next());

    expect(sequenceA).not.toEqual(sequenceB);
  });
});
