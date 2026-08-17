/**
 * Deterministic, seeded PRNG.
 *
 * xoshiro128** (Blackman & Vigna), reimplemented here using only 32-bit integer
 * operations — `Math.imul` and `>>> 0` throughout — so the exact same sequence is
 * produced on every platform this ever runs on. State is four `number`s that are
 * always kept in normalised uint32 range; floating point never enters the state,
 * only the convenience output methods (`nextFloat`) touch a float, and only to
 * *present* a draw that was itself produced with exact integer arithmetic.
 */

export interface RngState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * splitmix32 — used only to expand a single 32-bit seed (or a single draw taken
 * from another generator) into the four words xoshiro128** needs for its state.
 * It is never used as the generator itself: it has weaker statistical properties
 * than xoshiro128**, but "expand one 32-bit number into a good starting state" is
 * exactly the job it is designed for, and it sidesteps the all-zero-state hazard
 * that xoshiro has.
 */
function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z;
  };
}

function stateFromSeed(seed: number): RngState {
  const draw = splitmix32(seed);
  const s0 = draw();
  const s1 = draw();
  const s2 = draw();
  const s3 = draw();
  // xoshiro128** is undefined for the all-zero state. splitmix32 landing on it is
  // astronomically unlikely, but this module's whole job is exactness rather than
  // probability, so the case is handled rather than merely assumed away.
  if ((s0 | s1 | s2 | s3) === 0) return { s0: 1, s1: 0, s2: 0, s3: 0 };
  return { s0, s1, s2, s3 };
}

/**
 * A seeded, forkable 32-bit PRNG with exact, serialisable state.
 *
 * Two `Rng` instances constructed from the same seed — or restored from the same
 * `RngState` — produce, draw for draw, the same sequence forever, on any platform.
 * That property is the entire reason this module exists: it is what makes a
 * recorded run replayable.
 */
export class Rng {
  #s0: number;
  #s1: number;
  #s2: number;
  #s3: number;

  private constructor(state: RngState) {
    this.#s0 = state.s0 >>> 0;
    this.#s1 = state.s1 >>> 0;
    this.#s2 = state.s2 >>> 0;
    this.#s3 = state.s3 >>> 0;
  }

  static fromSeed(seed: number): Rng {
    return new Rng(stateFromSeed(seed));
  }

  static fromState(state: RngState): Rng {
    return new Rng(state);
  }

  /** Exact, JSON-serialisable snapshot of the generator's state. */
  getState(): RngState {
    return { s0: this.#s0, s1: this.#s1, s2: this.#s2, s3: this.#s3 };
  }

  /** Reset this generator in place to a previously captured state. */
  setState(state: RngState): void {
    this.#s0 = state.s0 >>> 0;
    this.#s1 = state.s1 >>> 0;
    this.#s2 = state.s2 >>> 0;
    this.#s3 = state.s3 >>> 0;
  }

  /** An independent generator starting from the same state as this one. */
  clone(): Rng {
    return new Rng(this.getState());
  }

  /**
   * Derive a new, independent generator from this one, without disturbing this
   * generator's own future sequence beyond the single draw the derivation costs.
   *
   * Use this to give each subsystem (weather, a market, a single mixer) its own
   * stream, so that adding or removing a draw in one subsystem never shifts the
   * sequence another subsystem sees. The draw consumed from `this` is itself
   * deterministic, so forking twice from equal states always yields two equal
   * child generators.
   */
  fork(): Rng {
    // Expand one 32-bit draw from this generator into a fresh 128 bits of state,
    // exactly as a new seed would be expanded. A true xoshiro "jump" would need a
    // precomputed jump polynomial for this generator's exact parameters; deriving
    // a fresh, independently-expanded seed is simpler and sufficient for treating
    // subsystems as uncoupled random streams.
    return new Rng(stateFromSeed(this.nextUint32()));
  }

  /** The next raw 32-bit unsigned integer, uniform over [0, 2^32). */
  nextUint32(): number {
    const s0 = this.#s0;
    const s1 = this.#s1;
    const s2 = this.#s2;
    const s3 = this.#s3;

    const rotated = rotl(Math.imul(s1, 5) >>> 0, 7);
    const result = Math.imul(rotated, 9) >>> 0;

    const t = (s1 << 9) >>> 0;

    let ns2 = (s2 ^ s0) >>> 0;
    const ns3 = (s3 ^ s1) >>> 0;
    const ns1 = (s1 ^ ns2) >>> 0;
    const ns0 = (s0 ^ ns3) >>> 0;
    ns2 = (ns2 ^ t) >>> 0;
    const finalS3 = rotl(ns3, 11);

    this.#s0 = ns0;
    this.#s1 = ns1;
    this.#s2 = ns2;
    this.#s3 = finalS3;

    return result;
  }

  /** A float in [0, 1), built from 32 bits of exact integer state. */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /**
   * A uniformly distributed integer in [0, exclusiveMax).
   *
   * Uses rejection sampling rather than a plain modulo, so that every outcome is
   * exactly as likely as every other one — a naive `nextUint32() % exclusiveMax`
   * biases the low outcomes whenever `exclusiveMax` does not divide 2^32 evenly.
   */
  nextInt(exclusiveMax: number): number {
    if (!Number.isInteger(exclusiveMax) || exclusiveMax <= 0) {
      throw new RangeError(`nextInt requires a positive integer bound, got ${exclusiveMax}`);
    }
    if (exclusiveMax > 0x100000000) {
      throw new RangeError(`nextInt bound ${exclusiveMax} exceeds 32-bit range`);
    }
    const limit = Math.floor(0x100000000 / exclusiveMax) * exclusiveMax;
    let draw = this.nextUint32();
    while (draw >= limit) draw = this.nextUint32();
    return draw % exclusiveMax;
  }

  nextBool(): boolean {
    return (this.nextUint32() & 1) === 1;
  }
}
