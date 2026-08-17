/**
 * The sugar refinery: sugar beet in, refined sucrose out, with the pulp and
 * molasses streams accounted for rather than discarded, plus a tracked
 * evaporation loss from concentrating the extracted juice.
 *
 * `sucrose.json` is essentially pure C12H22O11 — none of the beet's other
 * elements (N, P, K, S, Na, Ca, Mg, Ash) belong in refined sugar at all. Pulp
 * and molasses have no dedicated registry entries (there is no separately
 * sourced elemental profile for either), so — exactly like `mill.ts`'s mill
 * dust and `creamery.ts`'s skim milk — both draw their stream weighting from
 * the beet's own profile: everything the extraction does not carry off as
 * sucrose is, element for element, still beet residue, just split by mass
 * between the fibrous (pulp) and liquid (molasses) byproduct streams.
 */

import type { Composition, Micrograms } from '../core/commodity.js';
import { compositionMass } from '../core/commodity.js';
import type { AccountId, Posting } from '../core/ledger.js';
import type { MachineDefinition } from '../process/machine.js';
import type { SubstanceRegistry } from '../substance/registry.js';
import { ProcessUnit, splitByProfile, type StreamProfile } from './unit.js';

/** Real sugar beet root is roughly 15-18% extractable sucrose by mass; process
 * losses keep actual recovery a little below the root's raw sucrose content. */
const DEFAULT_EXTRACTION_RATE = 0.15;
const MIN_EXTRACTION_RATE = 0.1;
const MAX_EXTRACTION_RATE = 0.18;

/** Of whatever mass is not extracted as sucrose, roughly how much leaves as
 * fibrous pulp rather than as liquid molasses. */
const DEFAULT_PULP_FRACTION = 0.55;
const MIN_PULP_FRACTION = 0.3;
const MAX_PULP_FRACTION = 0.7;

/** Concentrating the thin juice down to molasses flashes off some of the
 * beet's own water as vapour; this is a small fraction of the root's total
 * mass, not the bulk of its ~75% water content (most of that leaves inside the
 * pulp and molasses streams themselves, not as vapour). */
const DEFAULT_EVAPORATION_LOSS_FRACTION = 0.02;
const MAX_EVAPORATION_LOSS_FRACTION = 0.05;

export const REFINERY_MACHINE_DEFINITION: MachineDefinition = {
  type: 'sugar-refinery',
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
      name: 'pulp-fraction',
      unit: 'fraction',
      kind: 'setpoint',
      min: MIN_PULP_FRACTION,
      max: MAX_PULP_FRACTION,
      initial: DEFAULT_PULP_FRACTION,
    },
    {
      name: 'evaporation-loss-fraction',
      unit: 'fraction',
      kind: 'setpoint',
      min: 0,
      max: MAX_EVAPORATION_LOSS_FRACTION,
      initial: DEFAULT_EVAPORATION_LOSS_FRACTION,
    },
    {
      name: 'hopper-level-kg',
      unit: 'kg',
      kind: 'measurement',
      min: 0,
      max: 50_000,
      initial: 0,
    },
  ],
  maintenanceIntervalHours: 900,
  components: [
    { kind: 'bearing', label: 'diffuser drive bearing', wearRatePerHour: 0.0004, dutyExponent: 1.3 },
    { kind: 'heating-element', label: 'evaporator steam coil', wearRatePerHour: 0.0003, dutyExponent: 1.1 },
  ],
};

/** A refinery refuses to run its diffuser with nothing loaded — an equipment
 * condition, never anything about a person. */
export function createRefinery(id: string, label: string): ProcessUnit {
  return new ProcessUnit({
    id,
    label,
    definition: REFINERY_MACHINE_DEFINITION,
    interlocks: (machine) => [
      {
        id: 'refinery.diffuser-charge',
        label: 'diffuser charge interlock',
        protects: 'diffuser and evaporator train',
        conditions: [
          {
            id: 'hopper-charged',
            description: 'beet hopper is empty',
            isSatisfied: () => machine.getTag('hopper-level-kg') > 0,
          },
        ],
      },
    ],
  });
}

export interface RefineBatchParams {
  readonly beetAccount: AccountId;
  /** The exact composition of the beet being processed this batch. */
  readonly beetComposition: Composition;
  readonly sucroseAccount: AccountId;
  readonly pulpAccount: AccountId;
  readonly molassesAccount: AccountId;
  /** Where evaporated process water is credited — typically the atmosphere
   * reservoir (see `world/accounts.ts`). */
  readonly evaporationAccount: AccountId;
  readonly process?: string;
}

export interface RefineYields {
  readonly sucrose: Micrograms;
  readonly pulp: Micrograms;
  readonly molasses: Micrograms;
  readonly evaporationLoss: Micrograms;
}

/** The actual exact composition posted for each stream — see `MillCompositions`
 * in `mill.ts` for why a caller chaining a further step should use these
 * rather than a nominal registry composition. */
export interface RefineCompositions {
  readonly sucrose: Composition;
  readonly pulp: Composition;
  readonly molasses: Composition;
  readonly evaporationLoss: Composition;
}

export interface RefineBatchResult {
  readonly posting: Posting;
  readonly yields: RefineYields;
  readonly compositions: RefineCompositions;
}

/**
 * Process one batch of sugar beet. Reads its extraction rate, pulp/molasses
 * split and evaporation loss from `unit.machine`'s own setpoint tags.
 */
export function refineSugarBeet(
  unit: ProcessUnit,
  registry: SubstanceRegistry,
  params: RefineBatchParams,
): RefineBatchResult {
  const extractionRate = unit.machine.getTag('extraction-rate');
  const pulpFraction = unit.machine.getTag('pulp-fraction');
  const evaporationLossFraction = unit.machine.getTag('evaporation-loss-fraction');
  const residueFraction = Math.max(0, 1 - extractionRate);

  const beetProfile = registry.get('sugar-beet').elements;

  const streams: readonly StreamProfile[] = [
    { id: 'sucrose', elements: registry.get('sucrose').elements, targetShare: extractionRate },
    { id: 'pulp', elements: beetProfile, targetShare: residueFraction * pulpFraction },
    { id: 'molasses', elements: beetProfile, targetShare: residueFraction * (1 - pulpFraction) },
    {
      id: 'evaporation-loss',
      elements: registry.get('water-liquid').elements,
      targetShare: evaporationLossFraction,
    },
  ];

  const [sucroseComposition, pulpComposition, molassesComposition, evaporationComposition] =
    splitByProfile(params.beetComposition, streams) as [Composition, Composition, Composition, Composition];

  const posting = unit.buildBatch({
    process: params.process ?? 'refinery:extract',
    inputs: [{ account: params.beetAccount, composition: params.beetComposition }],
    outputs: [
      { account: params.sucroseAccount, composition: sucroseComposition },
      { account: params.pulpAccount, composition: pulpComposition },
      { account: params.molassesAccount, composition: molassesComposition },
    ],
    losses: [{ account: params.evaporationAccount, composition: evaporationComposition }],
  });

  const beetMassKg = Number(compositionMass(params.beetComposition)) / 1e9;
  unit.machine.setTag('hopper-level-kg', unit.machine.getTag('hopper-level-kg') - beetMassKg);

  return {
    posting,
    yields: {
      sucrose: compositionMass(sucroseComposition),
      pulp: compositionMass(pulpComposition),
      molasses: compositionMass(molassesComposition),
      evaporationLoss: compositionMass(evaporationComposition),
    },
    compositions: {
      sucrose: sucroseComposition,
      pulp: pulpComposition,
      molasses: molassesComposition,
      evaporationLoss: evaporationComposition,
    },
  };
}
