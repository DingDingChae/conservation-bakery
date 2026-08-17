/**
 * Equipment degradation.
 *
 * Bearings, belts, seals and heating elements wear as a function of run hours and
 * duty, and eventually fail. A failure here is always an equipment or product
 * event — a component is "condemned" and taken out of service — never anything
 * that happens to a person. See CONTRACT.md rule 2.
 *
 * All randomness is drawn from an `Rng` supplied by the caller. Nothing in this
 * file reads `Math.random` or the clock, so two runs that make the same sequence
 * of `advance()` calls with the same seed fail at exactly the same run hour, on
 * every replay.
 */

/** A source of numbers in `[0, 1)`. The only sanctioned source of randomness here. */
export interface Rng {
  next(): number;
}

/**
 * A small, dependency-free deterministic PRNG (mulberry32) for reproducible wear
 * and failure. Not cryptographic — it exists to make simulated equipment history
 * replayable, not to keep a secret.
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export type ComponentKind = 'bearing' | 'belt' | 'seal' | 'heating-element';

export interface ComponentDefinition {
  readonly kind: ComponentKind;
  readonly label: string;
  /** Wear accumulated per run-hour at full duty (duty = 1), on a 0..1 scale to failure. */
  readonly wearRatePerHour: number;
  /**
   * How strongly duty (0..1 load factor) accelerates wear: the wear rate is scaled
   * by `duty ** dutyExponent`, so a value above 1 makes light duty disproportionately
   * gentle and heavy duty disproportionately punishing.
   */
  readonly dutyExponent: number;
}

/** An equipment event only — no person is ever a party to anything in this file. */
export interface EquipmentEvent {
  readonly componentKind: ComponentKind;
  readonly label: string;
  readonly kind: 'condemned';
  readonly runHoursAtFailure: number;
}

/** Wear above this fraction carries a chance of failure on every subsequent advance. */
const AT_RISK_WEAR = 0.8;

export class WearComponent {
  readonly #definition: ComponentDefinition;
  #wear = 0;
  #failed = false;

  constructor(definition: ComponentDefinition) {
    this.#definition = definition;
  }

  get kind(): ComponentKind {
    return this.#definition.kind;
  }

  get label(): string {
    return this.#definition.label;
  }

  /** 0 = new, 1 = worn out. */
  get wear(): number {
    return this.#wear;
  }

  get failed(): boolean {
    return this.#failed;
  }

  /**
   * Advance wear by `hours` of run time at load `duty` (0..1). Wear itself is a
   * deterministic function of hours and duty; `rng` is consulted only for the
   * independent chance of an early failure once wear has passed `AT_RISK_WEAR`, and
   * is drawn exactly once per call, so the failure hour depends only on the
   * sequence of calls and the seed, never on wall-clock time.
   */
  advance(hours: number, duty: number, rng: Rng, runHoursTotal: number): EquipmentEvent | undefined {
    if (hours < 0) throw new RangeError(`cannot advance wear by negative hours ${hours}`);
    if (this.#failed) return undefined;

    const clampedDuty = Math.min(1, Math.max(0, duty));
    const multiplier = Math.pow(clampedDuty, this.#definition.dutyExponent);
    this.#wear = Math.min(1, this.#wear + this.#definition.wearRatePerHour * hours * multiplier);

    let failed = this.#wear >= 1;
    if (!failed && this.#wear > AT_RISK_WEAR) {
      const riskFraction = (this.#wear - AT_RISK_WEAR) / (1 - AT_RISK_WEAR);
      const chance = riskFraction * riskFraction; // quadratic ramp: rare early, near-certain by wear=1
      failed = rng.next() < chance;
    }

    if (!failed) return undefined;
    this.#failed = true;
    this.#wear = 1;
    return {
      componentKind: this.#definition.kind,
      label: this.#definition.label,
      kind: 'condemned',
      runHoursAtFailure: runHoursTotal,
    };
  }

  /** Scheduled maintenance replaces the component. An equipment event only. */
  replace(): void {
    this.#wear = 0;
    this.#failed = false;
  }
}
