/**
 * Exactness tests for commodity.ts.
 *
 * This suite is the proof that rule 1 of CONTRACT.md holds at the lowest level:
 * partitioning and rounding never gain or lose a unit. See ledger.spec.ts for the
 * end-to-end conservation proof over a running ledger.
 */

import { describe, expect, it } from 'vitest';
import {
  addComposition,
  compositionMass,
  compositionsEqual,
  emptyComposition,
  grams,
  kilograms,
  partition,
  roundHalfEven,
  scale,
  type Composition,
  type Element,
} from './commodity.js';

/**
 * A tiny deterministic PRNG (mulberry32) so the property tests below are
 * reproducible byte-for-byte across machines and CI runs. Do NOT use Math.random.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random bigint in [0, maxExclusive), for maxExclusive > 0. */
function randomBigInt(rng: () => number, maxExclusive: bigint): bigint {
  if (maxExclusive <= 0n) return 0n;
  // Build up entropy in 32-bit chunks so we can reach huge bigints, then reduce.
  let bits = 32n;
  let range = maxExclusive;
  while (range > 0xffffffffn) {
    range >>= 32n;
    bits += 32n;
  }
  let value = 0n;
  for (let consumed = 0n; consumed < bits; consumed += 32n) {
    value = (value << 32n) | BigInt(Math.floor(rng() * 4294967296));
  }
  return value % maxExclusive;
}

/** A random signed bigint with magnitude below `maxMagnitudeExclusive`. */
function randomSignedBigInt(rng: () => number, maxMagnitudeExclusive: bigint): bigint {
  const magnitude = randomBigInt(rng, maxMagnitudeExclusive);
  return rng() < 0.5 ? -magnitude : magnitude;
}

describe('partition', () => {
  it('splits a positive amount into parts summing to exactly the input', () => {
    const parts = partition(100n, [1n, 1n, 1n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(parts).toHaveLength(3);
  });

  it('splits a negative amount into parts summing to exactly the input', () => {
    const parts = partition(-100n, [1n, 1n, 1n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(-100n);
  });

  it('splits zero into all-zero parts', () => {
    const parts = partition(0n, [3n, 5n, 7n]);
    expect(parts).toEqual([0n, 0n, 0n]);
  });

  it('handles zero weights (amount must be zero, and returns zero parts)', () => {
    expect(partition(0n, [0n, 0n])).toEqual([0n, 0n]);
  });

  it('throws when partitioning a nonzero amount across zero total weight', () => {
    expect(() => partition(1n, [0n, 0n])).toThrow(RangeError);
  });

  it('throws when partitioning a nonzero amount across zero parts', () => {
    expect(() => partition(1n, [])).toThrow(RangeError);
  });

  it('returns an empty array for zero amount and zero parts', () => {
    expect(partition(0n, [])).toEqual([]);
  });

  it('throws on a negative weight', () => {
    expect(() => partition(10n, [1n, -1n])).toThrow(RangeError);
  });

  it('handles a single weight by returning the whole amount', () => {
    expect(partition(77n, [5n])).toEqual([77n]);
    expect(partition(-77n, [5n])).toEqual([-77n]);
  });

  it('handles many equal weights, dividing evenly', () => {
    const weights = new Array(10).fill(1n);
    const parts = partition(1000n, weights);
    expect(parts).toEqual(new Array(10).fill(100n));
  });

  it('handles huge bigints without losing precision', () => {
    const amount = 10n ** 30n + 7n;
    const parts = partition(amount, [1n, 1n, 1n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(amount);
  });

  it('distributes the largest remainder to the parts with the biggest fractional share', () => {
    // 10 split across weights 1,1,1 -> floor shares 3,3,3, leftover 1 goes to
    // the lowest index among equal remainders (deterministic tie-break).
    const parts = partition(10n, [1n, 1n, 1n]);
    expect(parts).toEqual([4n, 3n, 3n]);
  });

  it('handles weights that do not divide evenly, still summing exactly', () => {
    const parts = partition(101n, [3n, 5n, 11n, 2n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(101n);
  });

  it('is deterministic: repeated calls with identical inputs give identical outputs', () => {
    const weights = [7n, 2n, 9n, 4n];
    const a = partition(12345n, weights);
    const b = partition(12345n, weights);
    expect(a).toEqual(b);
  });

  describe('property: 20000 random cases always sum to exactly the input', () => {
    const rng = mulberry32(0xc0ffee);
    const cases = 20_000;

    // All 20000 cases run inside a single `it`: a per-case `it` would register
    // 20k separate vitest tests, which is unnecessarily slow to report.
    it(`holds across ${cases} random amounts and weight vectors`, () => {
      for (let i = 0; i < cases; i += 1) {
        const weightCount = 1 + Math.floor(rng() * 8);
        const weights: bigint[] = [];
        let totalWeight = 0n;
        for (let w = 0; w < weightCount; w += 1) {
          // Occasionally allow a zero weight to exercise that edge case.
          const weight = rng() < 0.1 ? 0n : randomBigInt(rng, 10_000n) + 1n;
          weights.push(weight);
          totalWeight += weight;
        }

        let amount: bigint;
        if (totalWeight === 0n) {
          // Zero total weight requires a zero amount, or partition() throws.
          amount = 0n;
        } else {
          // Mix magnitudes: small, large, and occasionally huge bigints.
          const magnitudeRoll = rng();
          const maxMagnitude =
            magnitudeRoll < 0.6
              ? 1_000_000n
              : magnitudeRoll < 0.9
                ? 10n ** 15n
                : 10n ** 30n;
          amount = randomSignedBigInt(rng, maxMagnitude);
        }

        const parts = partition(amount, weights);
        const sum = parts.reduce((a, b) => a + b, 0n);
        expect(sum).toBe(amount);
        expect(parts).toHaveLength(weights.length);
      }
    });
  });
});

describe('roundHalfEven', () => {
  it('rounds ties to the nearest even integer, positive side', () => {
    expect(roundHalfEven(0.5)).toBe(0n);
    expect(roundHalfEven(1.5)).toBe(2n);
    expect(roundHalfEven(2.5)).toBe(2n);
    expect(roundHalfEven(3.5)).toBe(4n);
  });

  it('rounds ties to the nearest even integer, negative side', () => {
    expect(roundHalfEven(-0.5)).toBe(0n);
    expect(roundHalfEven(-1.5)).toBe(-2n);
    expect(roundHalfEven(-2.5)).toBe(-2n);
    expect(roundHalfEven(-3.5)).toBe(-4n);
  });

  it('rounds non-ties to the nearest integer normally', () => {
    expect(roundHalfEven(1.4)).toBe(1n);
    expect(roundHalfEven(1.6)).toBe(2n);
    expect(roundHalfEven(-1.4)).toBe(-1n);
    expect(roundHalfEven(-1.6)).toBe(-2n);
  });

  it('rounds an exact integer to itself', () => {
    expect(roundHalfEven(5)).toBe(5n);
    expect(roundHalfEven(0)).toBe(0n);
    expect(roundHalfEven(-5)).toBe(-5n);
  });

  it('shows no directional drift across a long run of .5 ties', () => {
    // roundHalfEven is an odd function of its argument: rounding -x to the
    // nearest even neighbour always gives exactly -(round(x)), because the
    // "even" target on the negative side mirrors the one on the positive side.
    // So pairing every tie n+0.5 (n >= 0) with its negation -(n+0.5) makes both
    // the exact sum and the rounded sum cancel to precisely zero — any
    // directional bias in the rounding would show up as a nonzero residual.
    let exactSum = 0;
    let roundedSum = 0n;
    for (let n = 0; n < 5000; n += 1) {
      const value = n + 0.5;
      for (const v of [value, -value]) {
        exactSum += v;
        roundedSum += roundHalfEven(v);
      }
    }
    expect(exactSum).toBe(0);
    expect(roundedSum).toBe(0n);
  });
});

describe('scale / grams / kilograms', () => {
  it('scales an exact bigint by simple multiplication, no rounding involved', () => {
    expect(scale(3n, 1_000_000n)).toBe(3_000_000n);
    expect(scale(-3n, 1_000_000n)).toBe(-3_000_000n);
    expect(scale(0n, 1_000_000n)).toBe(0n);
  });

  it('passes bigint input through untouched by float rounding, even huge values', () => {
    const huge = 10n ** 40n;
    expect(scale(huge, 1_000n)).toBe(huge * 1_000n);
  });

  it('rounds a number input once at the base unit', () => {
    expect(scale(1.5, 2n)).toBe(3n); // 1.5 * 2 = 3 exactly, no tie
    expect(scale(0.5, 1n)).toBe(0n); // tie, rounds to even (0)
  });

  it('rejects NaN', () => {
    expect(() => scale(NaN, 1_000n)).toThrow(RangeError);
  });

  it('rejects +Infinity and -Infinity', () => {
    expect(() => scale(Infinity, 1_000n)).toThrow(RangeError);
    expect(() => scale(-Infinity, 1_000n)).toThrow(RangeError);
  });

  it('grams() converts to exact micrograms', () => {
    expect(grams(1)).toBe(1_000_000n);
    expect(grams(2.5)).toBe(2_500_000n);
    expect(grams(1n)).toBe(1_000_000n);
  });

  it('kilograms() converts to exact micrograms', () => {
    expect(kilograms(1)).toBe(1_000_000_000n);
    expect(kilograms(1n)).toBe(1_000_000_000n);
  });

  it('grams() rejects non-finite input', () => {
    expect(() => grams(NaN)).toThrow(RangeError);
  });
});

describe('compositionMass', () => {
  it('sums an empty composition to zero', () => {
    expect(compositionMass(emptyComposition())).toBe(0n);
  });

  it('sums a composition with several elements', () => {
    const c: Composition = new Map<Element, bigint>([
      ['C', 100n],
      ['H', 20n],
      ['O', 80n],
    ]);
    expect(compositionMass(c)).toBe(200n);
  });

  it('sums correctly when a component is negative (a delta composition)', () => {
    const c: Composition = new Map<Element, bigint>([
      ['C', 100n],
      ['H', -30n],
    ]);
    expect(compositionMass(c)).toBe(70n);
  });
});

describe('addComposition', () => {
  it('adds a source composition into a target, key by key', () => {
    const target = new Map<Element, bigint>([['C', 10n]]);
    const source: Composition = new Map<Element, bigint>([
      ['C', 5n],
      ['H', 2n],
    ]);
    addComposition(target, source);
    expect(target.get('C')).toBe(15n);
    expect(target.get('H')).toBe(2n);
  });

  it('applies a multiplier to every term', () => {
    const target = emptyComposition();
    const source: Composition = new Map<Element, bigint>([['C', 3n]]);
    addComposition(target, source, -2n);
    expect(target.get('C')).toBe(-6n);
  });

  it('deletes a key when a term cancels to exactly zero', () => {
    const target = new Map<Element, bigint>([['C', 5n]]);
    const source: Composition = new Map<Element, bigint>([['C', -5n]]);
    addComposition(target, source);
    expect(target.has('C')).toBe(false);
    expect(target.get('C')).toBeUndefined();
  });

  it('does not delete a key whose result is nonzero', () => {
    const target = new Map<Element, bigint>([['C', 5n]]);
    const source: Composition = new Map<Element, bigint>([['C', -3n]]);
    addComposition(target, source);
    expect(target.get('C')).toBe(2n);
  });

  it('leaves the target untouched for an empty source', () => {
    const target = new Map<Element, bigint>([['C', 5n]]);
    addComposition(target, emptyComposition());
    expect(target.get('C')).toBe(5n);
  });

  it('returns the same target map instance it mutates', () => {
    const target = emptyComposition();
    const result = addComposition(target, new Map());
    expect(result).toBe(target);
  });

  it('adds a fresh key not previously present in the target', () => {
    const target = new Map<Element, bigint>([['C', 1n]]);
    const source: Composition = new Map<Element, bigint>([['N', 4n]]);
    addComposition(target, source);
    expect(target.get('N')).toBe(4n);
    expect(target.get('C')).toBe(1n);
  });
});

describe('compositionsEqual', () => {
  it('treats two empty compositions as equal', () => {
    expect(compositionsEqual(emptyComposition(), emptyComposition())).toBe(true);
  });

  it('treats identical compositions as equal regardless of key insertion order', () => {
    const a: Composition = new Map<Element, bigint>([
      ['C', 1n],
      ['H', 2n],
    ]);
    const b: Composition = new Map<Element, bigint>([
      ['H', 2n],
      ['C', 1n],
    ]);
    expect(compositionsEqual(a, b)).toBe(true);
  });

  it('treats a composition with an explicit zero as equal to one missing that key', () => {
    const a: Composition = new Map<Element, bigint>([['C', 0n]]);
    const b: Composition = emptyComposition();
    expect(compositionsEqual(a, b)).toBe(true);
  });

  it('detects a differing value for a shared key', () => {
    const a: Composition = new Map<Element, bigint>([['C', 1n]]);
    const b: Composition = new Map<Element, bigint>([['C', 2n]]);
    expect(compositionsEqual(a, b)).toBe(false);
  });

  it('detects a key present only on one side', () => {
    const a: Composition = new Map<Element, bigint>([['C', 1n]]);
    const b: Composition = new Map<Element, bigint>([
      ['C', 1n],
      ['H', 1n],
    ]);
    expect(compositionsEqual(a, b)).toBe(false);
  });
});
