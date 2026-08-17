import { describe, expect, it } from 'vitest';

import { compositionMass, UG_PER_KG, type Micrograms } from '../core/commodity.js';
import { defaultSubstanceRegistry, UnknownSubstanceError } from './registry.js';

/**
 * Deterministic PRNG (mulberry32) so the property test below is reproducible
 * across runs and machines rather than depending on Math.random.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random non-negative bigint up to (but not including) `maxExclusive`. */
function randomMass(rand: () => number, maxExclusive: bigint): bigint {
  // Build up a bigint from 32-bit chunks so the range can exceed Number range.
  let range = maxExclusive;
  let result = 0n;
  let place = 1n;
  while (range > 0n) {
    const chunk = range > 0xffffffffn ? 0x100000000n : range + 1n;
    const digit = BigInt(Math.floor(rand() * Number(chunk)));
    result += digit * place;
    place *= 0x100000000n;
    range /= 0x100000000n;
  }
  return result % (maxExclusive === 0n ? 1n : maxExclusive);
}

describe('SubstanceRegistry', () => {
  const registry = defaultSubstanceRegistry();

  it('loads and validates every shipped substance file', () => {
    const ids = registry.ids();
    // The floor the task requires; the registry is free to carry more.
    expect(ids.length).toBeGreaterThanOrEqual(27);
    for (const id of ids) {
      const record = registry.get(id);
      expect(record.id).toBe(id);
      let sum = 0n;
      for (const value of Object.values(record.elements)) {
        sum += BigInt(value as number);
      }
      expect(sum).toBe(UG_PER_KG);
    }
  });

  it('includes the substances the first closed chain requires', () => {
    const required = [
      'atmospheric-oxygen',
      'carbon-dioxide',
      'atmospheric-nitrogen',
      'water-vapour',
      'water-liquid',
      'wheat-grain',
      'wheat-flour-white',
      'wheat-bran',
      'wheat-germ',
      'sucrose',
      'sugar-beet',
      'cow-milk-whole',
      'cream',
      'butter',
      'buttermilk',
      'hen-egg-whole',
      'hen-egg-white',
      'hen-egg-yolk',
      'sodium-bicarbonate',
      'sodium-chloride',
      'methane',
      'soil-nitrate',
      'soil-phosphate',
      'soil-potash',
      'cattle-feed-maize-silage',
      'cardboard',
      'polypropylene-film',
    ];
    for (const id of required) {
      expect(registry.has(id), `missing required substance "${id}"`).toBe(true);
    }
  });

  it('throws UnknownSubstanceError for an id that does not exist', () => {
    expect(() => registry.get('unobtainium')).toThrow(UnknownSubstanceError);
  });

  it('returns a frozen record and a frozen elements map', () => {
    const record = registry.get('wheat-flour-white');
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.elements)).toBe(true);
  });

  describe('getComposition', () => {
    it('round-trips exactly for zero, one, and every substance at exactly 1 kg', () => {
      for (const id of registry.ids()) {
        for (const mass of [0n, 1n, UG_PER_KG] as Micrograms[]) {
          const composition = registry.getComposition(id, mass);
          expect(compositionMass(composition)).toBe(mass);
        }
      }
    });

    it('round-trips exactly for a battery of awkward primes across every substance', () => {
      const primes: Micrograms[] = [
        2n,
        3n,
        7n,
        97n,
        7919n,
        999983n,
        1000000007n,
        999999999989n,
        1000000000000000009n, // ~1e18, well past a tonne, still exact
      ];
      for (const id of registry.ids()) {
        for (const mass of primes) {
          const composition = registry.getComposition(id, mass);
          expect(compositionMass(composition)).toBe(mass);
        }
      }
    });

    it('round-trips exactly over 20000 random masses across every substance', () => {
      const rand = mulberry32(0xc0ffee);
      const ids = registry.ids();
      // Up to ~10 tonnes, expressed in micrograms, so both small parcels and
      // industrial-scale deliveries are exercised.
      const maxMass = 10_000_000_000_000n;

      let trials = 0;
      for (let i = 0; i < 20_000; i += 1) {
        const id = ids[i % ids.length] as string;
        const mass = randomMass(rand, maxMass);
        const composition = registry.getComposition(id, mass);
        expect(compositionMass(composition)).toBe(mass);
        trials += 1;
      }
      expect(trials).toBe(20_000);
    });
  });
});
