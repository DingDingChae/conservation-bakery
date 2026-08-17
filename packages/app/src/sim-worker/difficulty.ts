/**
 * Difficulty: four presets over seven individually adjustable knobs.
 *
 * Every knob here changes how *forgiving* the plant is — prices, lead times,
 * equipment wear, spec tolerance, spoilage pace, regulatory response and how
 * much help the operator gets — and nothing else. None of them touch mass,
 * energy or money arithmetic directly: they only parameterise numbers that
 * `world.ts` then uses to build an ordinary balanced `Posting`, so no preset
 * and no knob combination can ever create or destroy a conserved quantity.
 * `difficulty.spec.ts` asserts the ledger still closes under every preset.
 */

import { roundHalfEven } from '@conservation-bakery/sim';

/** Every knob is a plain 0..1 dial: 0 is the most forgiving end, 1 the most
 * demanding. Presets are just named points in this space; a player may move
 * any knob individually, which is why the type carries no "preset" field of
 * its own — `DifficultySettings.preset` tracks that separately. */
export interface DifficultyKnobs {
  /** 0 = cheap deliveries and a generous cash cushion, 1 = real-world pricing pressure. */
  readonly economyPressure: number;
  /** 0 = equipment rarely wears out, 1 = realistic wear-to-failure pace. */
  readonly breakdownRate: number;
  /** 0 = a wide forgiving spec band, 1 = a strict one. */
  readonly qualityTolerance: number;
  /** 0 = goods barely spoil, 1 = real spoilage pace. */
  readonly spoilage: number;
  /** 0 = a lenient regulatory response to a non-conformance, 1 = a strict one. */
  readonly regulatorStrictness: number;
  /** 0 = generous lead times and deadlines, 1 = tight, realistic ones. */
  readonly timePressure: number;
  /** 0 = no operator assistance, 1 = full assistance, including call-a-supplier. */
  readonly assistance: number;
}

export type DifficultyPresetName = 'freePlay' | 'easy' | 'realistic' | 'punishing';

export interface DifficultySettings {
  /** `'custom'` once any knob has been moved off its preset's own value. */
  readonly preset: DifficultyPresetName | 'custom';
  readonly knobs: DifficultyKnobs;
}

/** One difficulty change, stamped with the world tick it took effect on —
 * `save.ts` records these alongside the command journal so a mid-run knob
 * change replays exactly, the same way a command does. */
export interface DifficultyChangeRecord {
  readonly tick: number;
  readonly knobs: DifficultyKnobs;
}

const KNOB_NAMES: readonly (keyof DifficultyKnobs)[] = [
  'economyPressure',
  'breakdownRate',
  'qualityTolerance',
  'spoilage',
  'regulatorStrictness',
  'timePressure',
  'assistance',
];

/** Clamp a single knob into its legal 0..1 range — the only legal range, at every preset. */
export function clampKnob(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampKnobs(knobs: DifficultyKnobs): DifficultyKnobs {
  return {
    economyPressure: clampKnob(knobs.economyPressure),
    breakdownRate: clampKnob(knobs.breakdownRate),
    qualityTolerance: clampKnob(knobs.qualityTolerance),
    spoilage: clampKnob(knobs.spoilage),
    regulatorStrictness: clampKnob(knobs.regulatorStrictness),
    timePressure: clampKnob(knobs.timePressure),
    assistance: clampKnob(knobs.assistance),
  };
}

export const DIFFICULTY_PRESETS: Readonly<Record<DifficultyPresetName, DifficultyKnobs>> = {
  freePlay: {
    economyPressure: 0,
    breakdownRate: 0,
    qualityTolerance: 0,
    spoilage: 0,
    regulatorStrictness: 0,
    timePressure: 0,
    assistance: 1,
  },
  easy: {
    economyPressure: 0.2,
    breakdownRate: 0.2,
    qualityTolerance: 0.2,
    spoilage: 0.2,
    regulatorStrictness: 0.2,
    timePressure: 0.2,
    assistance: 0.75,
  },
  realistic: {
    economyPressure: 0.6,
    breakdownRate: 0.6,
    qualityTolerance: 0.6,
    spoilage: 0.6,
    regulatorStrictness: 0.6,
    timePressure: 0.6,
    assistance: 0.25,
  },
  punishing: {
    economyPressure: 1,
    breakdownRate: 1,
    qualityTolerance: 1,
    spoilage: 1,
    regulatorStrictness: 1,
    timePressure: 1,
    assistance: 0,
  },
};

export function presetSettings(preset: DifficultyPresetName): DifficultySettings {
  return { preset, knobs: DIFFICULTY_PRESETS[preset] };
}

/** The default a fresh world boots with, absent an explicit choice. */
export function defaultDifficultySettings(): DifficultySettings {
  return presetSettings('easy');
}

function knobsEqual(a: DifficultyKnobs, b: DifficultyKnobs): boolean {
  return KNOB_NAMES.every((name) => a[name] === b[name]);
}

function matchingPreset(knobs: DifficultyKnobs): DifficultyPresetName | 'custom' {
  for (const name of Object.keys(DIFFICULTY_PRESETS) as DifficultyPresetName[]) {
    if (knobsEqual(knobs, DIFFICULTY_PRESETS[name])) return name;
  }
  return 'custom';
}

/**
 * Apply a partial knob change mid-run. `preset` is re-derived from the
 * resulting knobs rather than trusted from the caller, so it can never claim
 * to be "Easy" while actually holding knobs the player has since moved.
 */
export function withKnobs(current: DifficultySettings, patch: Partial<DifficultyKnobs>): DifficultySettings {
  const knobs = clampKnobs({ ...current.knobs, ...patch });
  return { preset: matchingPreset(knobs), knobs };
}

// ---------------------------------------------------------------------------
// Derived economics. Every one of these is a pure function of the knobs plus
// its own explicit inputs — never of wall-clock time or randomness — so a
// replay under a recorded knob history reproduces the exact same numbers.
// ---------------------------------------------------------------------------

const BASE_STARTING_CASH_MINOR = 500_000n; // $5,000.00 at economyPressure 0.5 (the midpoint)

/** The plant's opening cash balance, in minor currency units. Generous under
 * Free Play and Easy, tighter as economic pressure rises — never zero or
 * negative, so a fresh world is never unable to ever call a supplier. */
export function startingCashMinor(knobs: DifficultyKnobs): bigint {
  const multiplier = 1.6 - knobs.economyPressure; // 1.6x .. 0.6x
  return roundHalfEven(Number(BASE_STARTING_CASH_MINOR) * multiplier);
}

const BASE_PRICE_MINOR_PER_KG: Readonly<Record<string, number>> = {
  'wheat-flour-white': 120,
  butter: 650,
  sucrose: 90,
  'sodium-bicarbonate': 300,
  'hen-egg-whole': 400,
  'water-liquid': 1,
  cardboard: 80,
  'polypropylene-film': 200,
  'sugar-beet': 40,
};
const DEFAULT_BASE_PRICE_MINOR_PER_KG = 200;

/** The cost of a call-a-supplier delivery, in minor currency units. Computed
 * once in floating point from a real-world-shaped per-kilogram price and
 * rounded exactly once at the boundary — see CONTRACT.md's "float computes,
 * integer stores" rule. */
export function supplierPriceMinor(substanceId: string, massUg: bigint, knobs: DifficultyKnobs): bigint {
  const basePerKg = BASE_PRICE_MINOR_PER_KG[substanceId] ?? DEFAULT_BASE_PRICE_MINOR_PER_KG;
  const massKg = Number(massUg) / 1_000_000_000;
  const pressureMultiplier = 1 + knobs.economyPressure; // 1x .. 2x
  return roundHalfEven(basePerKg * massKg * pressureMultiplier);
}

const BASE_LEAD_TIME_SECONDS = 600; // ten simulated minutes at economyPressure/timePressure 0

/** How many simulated ticks (seconds) a call-a-supplier delivery takes to
 * arrive. Always at least one tick — a delivery is never instantaneous, even
 * under Free Play, because "real lead time" is part of what makes it a real
 * delivery and not a spawn. */
export function supplierLeadTimeTicks(knobs: DifficultyKnobs): number {
  const assistanceRelief = 1 - knobs.assistance * 0.6; // fuller assistance shortens the wait
  const pressureStretch = 1 + knobs.timePressure * 2; // more time pressure stretches it
  const seconds = BASE_LEAD_TIME_SECONDS * assistanceRelief * pressureStretch;
  return Math.max(1, Math.round(seconds));
}

/** Call-a-supplier is the easy-mode delivery action: available only while
 * `assistance` is generous enough, refused with a clear reason otherwise. */
export function supplierCallsPermitted(knobs: DifficultyKnobs): boolean {
  return knobs.assistance >= 0.5;
}

/** How much difficulty accelerates equipment wear, applied to the *hours*
 * `WearComponent.advance` is fed rather than to any conserved quantity — wear
 * is an abstract 0..1 condition scalar, never mass, energy or money, so this
 * multiplier cannot violate CONTRACT.md rule 1 no matter its value. */
export function breakdownHazardMultiplier(knobs: DifficultyKnobs): number {
  return 0.15 + knobs.breakdownRate * 1.35; // 0.15x .. 1.5x
}
