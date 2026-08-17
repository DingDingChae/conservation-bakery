import { describe, expect, it } from 'vitest';
import { Rng } from './rng.js';

function draw(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.nextUint32());
}

describe('Rng', () => {
  it('is deterministic: the same seed always produces the same sequence', () => {
    const a = Rng.fromSeed(12345);
    const b = Rng.fromSeed(12345);
    expect(draw(a, 200)).toEqual(draw(b, 200));
  });

  it('different seeds produce different sequences', () => {
    const a = Rng.fromSeed(1);
    const b = Rng.fromSeed(2);
    expect(draw(a, 32)).not.toEqual(draw(b, 32));
  });

  it('never produces a value outside uint32 range across a long run', () => {
    const rng = Rng.fromSeed(999);
    for (let i = 0; i < 100_000; i += 1) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('getState/setState round-trips exactly and resumes the same sequence', () => {
    const rng = Rng.fromSeed(42);
    draw(rng, 17); // burn some draws so state isn't the fresh-seed state
    const state = rng.getState();

    const continued = draw(rng, 10);

    const restored = Rng.fromState(state);
    expect(draw(restored, 10)).toEqual(continued);
  });

  it('fromState reproduces a generator byte-for-byte from a serialised state', () => {
    const rng = Rng.fromSeed(7);
    draw(rng, 5);
    const json = JSON.stringify(rng.getState());
    const restored = Rng.fromState(JSON.parse(json));
    expect(draw(rng, 50)).toEqual(draw(restored, 50));
  });

  it('clone produces an independent generator starting from the same state', () => {
    const rng = Rng.fromSeed(2024);
    draw(rng, 3);
    const clone = rng.clone();

    const fromOriginal = draw(rng, 20);
    const fromClone = draw(clone, 20);
    expect(fromClone).toEqual(fromOriginal);

    // They are independent afterwards: consuming one does not affect the other.
    rng.nextUint32();
    expect(draw(rng, 5)).not.toEqual(draw(clone, 5));
  });

  it('fork derives an independent stream without disturbing the parent beyond one draw', () => {
    const parent = Rng.fromSeed(2024);
    const parentContinuation = parent.clone();
    parentContinuation.nextUint32(); // account for the one draw fork() consumes

    const child = parent.fork();

    // The parent's own future sequence is exactly what it would have been after
    // one ordinary draw — forking costs one draw and nothing else.
    expect(draw(parent, 20)).toEqual(draw(parentContinuation, 20));

    // The child is not simply replaying the parent's sequence.
    const childDraws = draw(child, 20);
    const parentAgain = Rng.fromSeed(2024);
    parentAgain.nextUint32();
    expect(childDraws).not.toEqual(draw(parentAgain, 20));
  });

  it('fork is itself deterministic: equal parent states fork equal children', () => {
    const a = Rng.fromSeed(555);
    const b = Rng.fromState(a.getState());

    const childA = a.fork();
    const childB = b.fork();
    expect(draw(childA, 30)).toEqual(draw(childB, 30));
  });

  it('nextFloat stays within [0, 1)', () => {
    const rng = Rng.fromSeed(3);
    for (let i = 0; i < 10_000; i += 1) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('nextInt stays within [0, exclusiveMax) and covers more than one outcome', () => {
    const rng = Rng.fromSeed(9);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.nextInt(10);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10);
      seen.add(value);
    }
    expect(seen.size).toBe(10);
  });

  it('nextInt rejects a non-positive or non-integer bound', () => {
    const rng = Rng.fromSeed(1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-5)).toThrow(RangeError);
    expect(() => rng.nextInt(1.5)).toThrow(RangeError);
  });

  it('nextBool returns both outcomes over enough draws', () => {
    const rng = Rng.fromSeed(4);
    const seen = new Set<boolean>();
    for (let i = 0; i < 1000; i += 1) seen.add(rng.nextBool());
    expect(seen.size).toBe(2);
  });
});
