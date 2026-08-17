/**
 * The flour mill: wheat grain in, white flour, bran, germ and mill dust out, plus
 * a tracked moisture loss to drying.
 *
 * White flour, bran and germ each have their own independently sourced
 * elemental profile in the registry (see `packages/data/substances/wheat-*`),
 * and — as `wheat-flour-white.json`'s own notes say — those three profiles do
 * not sum back to the grain's profile exactly, because they are each closed
 * independently rather than derived from one another. So this mill does not
 * assign each stream *its own* registry composition directly; it uses each
 * substance's per-kilogram profile only as a *weighting* for `splitByProfile`,
 * which divides the grain's actual, exact composition across the streams in
 * that ratio. The result is always exact by construction (see `unit.ts`) and
 * only approximately matches each substance's nominal profile — exactly as
 * real milling approximates a target extraction rate rather than hitting it
 * to the microgram.
 */

import type { Composition, Micrograms } from '../core/commodity.js';
import { compositionMass } from '../core/commodity.js';
import type { AccountId, Posting } from '../core/ledger.js';
import type { MachineDefinition } from '../process/machine.js';
import type { LotCreationSpec } from '../provenance/lot.js';
import type { SubstanceRegistry } from '../substance/registry.js';
import { ProcessUnit, splitByProfile, type StreamProfile } from './unit.js';

/** Typical extraction rate for a white flour mill: roughly 76% of the grain's
 * mass becomes flour, the rest is millfeed (bran, germ, dust) plus drying loss. */
const DEFAULT_EXTRACTION_RATE = 0.76;
const MIN_EXTRACTION_RATE = 0.6;
const MAX_EXTRACTION_RATE = 0.85;

/** Typical drying loss during milling — grain arrives at ~13% moisture and is
 * conditioned down before rolling; only a few percent of the grain's total mass
 * actually leaves as vapour during the mill pass itself. */
const DEFAULT_MOISTURE_LOSS_FRACTION = 0.03;
const MAX_MOISTURE_LOSS_FRACTION = 0.08;

/**
 * Of whatever mass is *not* flour, roughly how much becomes bran, germ and mill
 * dust respectively (the rest is the moisture-loss setpoint). These ratios are
 * fixed rather than settable — extraction rate is the one operationally
 * meaningful knob a mill operator turns; the millfeed split is a consequence of
 * wheat's own anatomy, not a control choice.
 */
const BRAN_SHARE_OF_MILLFEED = 0.65;
const GERM_SHARE_OF_MILLFEED = 0.12;
const DUST_SHARE_OF_MILLFEED = 0.23;

export const MILL_MACHINE_DEFINITION: MachineDefinition = {
  type: 'flour-mill',
  tags: [
    {
      name: 'extraction-rate',
      unit: 'fraction',
      kind: 'setpoint',
      min: MIN_EXTRACTION_RATE,
      max: MAX_EXTRACTION_RATE,
      initial: DEFAULT_EXTRACTION_RATE,
    },
    {
      name: 'moisture-loss-fraction',
      unit: 'fraction',
      kind: 'setpoint',
      min: 0,
      max: MAX_MOISTURE_LOSS_FRACTION,
      initial: DEFAULT_MOISTURE_LOSS_FRACTION,
    },
    {
      name: 'hopper-level-kg',
      unit: 'kg',
      kind: 'measurement',
      min: 0,
      max: 20_000,
      initial: 0,
    },
  ],
  maintenanceIntervalHours: 750,
  components: [
    { kind: 'bearing', label: 'break roll bearing', wearRatePerHour: 0.0004, dutyExponent: 1.3 },
    { kind: 'belt', label: 'sifter drive belt', wearRatePerHour: 0.0006, dutyExponent: 1.1 },
  ],
};

/** A mill refuses to grind with nothing loaded — an equipment condition (an
 * empty pass would run the rollers dry), never anything about a person. */
export function createMill(id: string, label: string): ProcessUnit {
  return new ProcessUnit({
    id,
    label,
    definition: MILL_MACHINE_DEFINITION,
    interlocks: (machine) => [
      {
        id: 'mill.feed-hopper',
        label: 'feed hopper interlock',
        protects: 'mill rollers',
        conditions: [
          {
            id: 'hopper-charged',
            description: 'feed hopper is empty',
            isSatisfied: () => machine.getTag('hopper-level-kg') > 0,
          },
        ],
      },
    ],
  });
}

export interface MillBatchParams {
  readonly grainAccount: AccountId;
  /** The exact composition of the grain being milled this batch, drawn from
   * `grainAccount` (typically `substanceRegistry.getComposition('wheat-grain', mass)`). */
  readonly grainComposition: Composition;
  readonly flourAccount: AccountId;
  readonly branAccount: AccountId;
  readonly germAccount: AccountId;
  readonly dustAccount: AccountId;
  /** Where moisture driven off during milling is credited — typically the
   * atmosphere reservoir (see `world/accounts.ts`). */
  readonly moistureAccount: AccountId;
  readonly process?: string;
  /** Optional provenance ancestry for the grain lot(s) being consumed, and the
   * lot id this batch's grain was drawn from — enables lot-graph tracking. When
   * omitted, this batch posts to the ledger without creating any lots. */
  readonly grainLotId?: string;
}

export interface MillYields {
  readonly flour: Micrograms;
  readonly bran: Micrograms;
  readonly germ: Micrograms;
  readonly dust: Micrograms;
  readonly moistureLoss: Micrograms;
}

/** The actual exact composition posted for each stream — not the registry's
 * nominal profile for that substance, but what `splitByProfile` actually
 * assigned this batch. A caller chaining a further process step onto one of
 * these streams (e.g. baking with this batch's flour) should consume this
 * composition, not re-derive one from the substance registry. */
export interface MillCompositions {
  readonly flour: Composition;
  readonly bran: Composition;
  readonly germ: Composition;
  readonly dust: Composition;
  readonly moistureLoss: Composition;
}

export interface MillBatchResult {
  readonly posting: Posting;
  readonly yields: MillYields;
  readonly compositions: MillCompositions;
}

/**
 * Grind one batch of grain. Reads its extraction rate and moisture-loss
 * fraction from `unit.machine`'s own setpoint tags, so turning those tags is
 * how a caller actually changes the mill's behaviour — exactly like any other
 * setpoint-driven machine in this simulation.
 */
export function millGrain(
  unit: ProcessUnit,
  registry: SubstanceRegistry,
  params: MillBatchParams,
): MillBatchResult {
  const extractionRate = unit.machine.getTag('extraction-rate');
  const moistureLossFraction = unit.machine.getTag('moisture-loss-fraction');
  const millfeedFraction = Math.max(0, 1 - extractionRate - moistureLossFraction);

  const streams: readonly StreamProfile[] = [
    { id: 'flour', elements: registry.get('wheat-flour-white').elements, targetShare: extractionRate },
    {
      id: 'bran',
      elements: registry.get('wheat-bran').elements,
      targetShare: millfeedFraction * BRAN_SHARE_OF_MILLFEED,
    },
    {
      id: 'germ',
      elements: registry.get('wheat-germ').elements,
      targetShare: millfeedFraction * GERM_SHARE_OF_MILLFEED,
    },
    // Mill dust is undifferentiated fine grain particulate — no dedicated
    // registry profile exists for it, so it draws on the grain's own profile,
    // scaled to its (small) target share.
    {
      id: 'dust',
      elements: registry.get('wheat-grain').elements,
      targetShare: millfeedFraction * DUST_SHARE_OF_MILLFEED,
    },
    {
      id: 'moisture',
      elements: registry.get('water-liquid').elements,
      targetShare: moistureLossFraction,
    },
  ];

  const [flourComposition, branComposition, germComposition, dustComposition, moistureComposition] =
    splitByProfile(params.grainComposition, streams) as [
      Composition,
      Composition,
      Composition,
      Composition,
      Composition,
    ];

  // A split conserves mass one-to-one per stream: the parent's contribution to
  // each output lot is exactly that output's own mass, not the whole grain's
  // mass. (The moisture driven off is a real, ledger-conserved loss, but it is
  // not part of any *lot's* own closure record — it never became a lot at all,
  // just as `closure.ts` distinguishes ledger-level conservation, which
  // `Ledger.audit()` already guarantees, from the lot graph's own closure.)
  const grainLotId = params.grainLotId;
  const lots: { outputs: readonly LotCreationSpec[] } | undefined = grainLotId
    ? {
        outputs: [
          {
            substance: 'wheat-flour-white',
            mass: compositionMass(flourComposition),
            parents: [{ lotId: grainLotId, mass: compositionMass(flourComposition) }],
          },
          {
            substance: 'wheat-bran',
            mass: compositionMass(branComposition),
            parents: [{ lotId: grainLotId, mass: compositionMass(branComposition) }],
          },
          {
            substance: 'wheat-germ',
            mass: compositionMass(germComposition),
            parents: [{ lotId: grainLotId, mass: compositionMass(germComposition) }],
          },
          {
            substance: 'wheat-grain',
            mass: compositionMass(dustComposition),
            parents: [{ lotId: grainLotId, mass: compositionMass(dustComposition) }],
          },
        ],
      }
    : undefined;

  const posting = unit.buildBatch({
    process: params.process ?? 'mill:grind',
    inputs: [{ account: params.grainAccount, composition: params.grainComposition }],
    outputs: [
      { account: params.flourAccount, composition: flourComposition },
      { account: params.branAccount, composition: branComposition },
      { account: params.germAccount, composition: germComposition },
      { account: params.dustAccount, composition: dustComposition },
    ],
    losses: [{ account: params.moistureAccount, composition: moistureComposition }],
    ...(lots ? { lots } : {}),
  });

  // Hopper level is a bookkeeping measurement, not a conserved ledger quantity —
  // it just tracks how much grain remains staged for the next batch.
  const grainMassKg = Number(compositionMass(params.grainComposition)) / 1e9;
  unit.machine.setTag('hopper-level-kg', unit.machine.getTag('hopper-level-kg') - grainMassKg);

  return {
    posting,
    yields: {
      flour: compositionMass(flourComposition),
      bran: compositionMass(branComposition),
      germ: compositionMass(germComposition),
      dust: compositionMass(dustComposition),
      moistureLoss: compositionMass(moistureComposition),
    },
    compositions: {
      flour: flourComposition,
      bran: branComposition,
      germ: germComposition,
      dust: dustComposition,
      moistureLoss: moistureComposition,
    },
  };
}
