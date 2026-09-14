/**
 * Seeded pseudo-random number generator.
 *
 * The `synthetic` adapter is deterministic by contract: whoever clones the repository gets exactly
 * the answers in the demo video. That only holds if every arbitrary choice in the generator comes
 * from here and never from `Math.random()`.
 *
 * `xmur3` hashes the seed string into 32-bit state; `mulberry32` turns that state into a stream.
 * Both are small, well-known and have no dependencies — which matters for a distroless image.
 */

/** Hashes a seed string into a function producing 32-bit state values. */
function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** Turns 32-bit state into a stream of floats in [0, 1). */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** An element of `items`. Throws on an empty array rather than returning undefined. */
  pick<T>(items: readonly T[]): T;
  /** A new array, shuffled. Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * Creates a generator for `seed`.
 *
 * Derive a child stream per concern (`createRng('san-telmo-2026:timetable')`) rather than sharing
 * one: then adding a draw in one place cannot shift every value everywhere else, which would
 * silently change the answers the video recorded.
 */
export function createRng(seed: string): Rng {
  const state = xmur3(seed);
  const next = mulberry32(state());

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new RangeError(`int() needs integer bounds, got [${min}, ${max}]`);
    }
    if (max < min) throw new RangeError(`int() needs max >= min, got [${min}, ${max}]`);
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('pick() on an empty array');
      // Safe: int() is bounded by length - 1 and the array is non-empty.
      return items[int(0, items.length - 1)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        const a = out[i] as T;
        const b = out[j] as T;
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
  };
}

/** The seed the reference dataset is pinned to. Changing it changes every generated answer. */
export const SAN_TELMO_SEED = 'san-telmo-2026';
