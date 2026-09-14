import { describe, expect, it } from 'vitest';

import { SAN_TELMO_SEED, createRng } from './prng.ts';

describe('createRng', () => {
  it('gives the same stream for the same seed', () => {
    // This is the whole contract of the synthetic adapter: clone the repo, get the video's answers.
    const a = Array.from({ length: 16 }, () => createRng(SAN_TELMO_SEED).next());
    const b = Array.from({ length: 16 }, () => createRng(SAN_TELMO_SEED).next());

    expect(a).toEqual(b);
  });

  it('gives a different stream for a different seed', () => {
    const one = createRng('san-telmo-2026').next();
    const other = createRng('san-telmo-2027').next();

    expect(one).not.toBe(other);
  });

  it('keeps derived streams independent, so a draw here cannot shift values there', () => {
    // Deriving per concern is why adding a random choice to the timetable does not silently
    // renumber every seeded incident.
    const rooms = createRng(`${SAN_TELMO_SEED}:rooms`);
    const timetable = createRng(`${SAN_TELMO_SEED}:timetable`);

    const timetableFirst = timetable.next();
    rooms.next();
    rooms.next();
    rooms.next();

    expect(createRng(`${SAN_TELMO_SEED}:timetable`).next()).toBe(timetableFirst);
  });

  it('produces floats inside [0, 1)', () => {
    const rng = createRng(SAN_TELMO_SEED);

    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('int', () => {
  it('stays within both bounds, inclusive', () => {
    const rng = createRng(SAN_TELMO_SEED);

    for (let i = 0; i < 1000; i++) {
      const value = rng.int(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('reaches both ends of the range', () => {
    const rng = createRng(SAN_TELMO_SEED);
    const seen = new Set(Array.from({ length: 200 }, () => rng.int(0, 2)));

    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('accepts a single-value range', () => {
    expect(createRng(SAN_TELMO_SEED).int(5, 5)).toBe(5);
  });

  it('rejects an inverted or non-integer range instead of returning nonsense', () => {
    const rng = createRng(SAN_TELMO_SEED);

    expect(() => rng.int(7, 3)).toThrow(RangeError);
    expect(() => rng.int(0.5, 3)).toThrow(RangeError);
  });
});

describe('pick and shuffle', () => {
  it('picks an element of the array', () => {
    const rng = createRng(SAN_TELMO_SEED);
    const items = ['MEN', 'SCL', 'FAR'];

    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
  });

  it('throws on an empty array rather than returning undefined', () => {
    expect(() => createRng(SAN_TELMO_SEED).pick([])).toThrow(RangeError);
  });

  it('shuffles without mutating the input and keeps every element', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = createRng(SAN_TELMO_SEED).shuffle(input);

    expect(out).not.toBe(input);
    expect([...out].sort((x, y) => x - y)).toEqual([...input]);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('shuffles the same way for the same seed', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];

    expect(createRng('fixed').shuffle(input)).toEqual(createRng('fixed').shuffle(input));
  });
});
