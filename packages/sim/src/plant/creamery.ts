/**
 * The creamery: whole milk separated into cream and skim milk, cream pasteurised,
 * then churned into butter and buttermilk. Every step is an exact mass-and-element
 * balance; pasteurisation is the one step that moves no mass at all — it only
 * costs real energy, drawn from a real account, exactly like every other
 * conserved quantity in this simulation.
 *
 * As with `mill.ts`, none of the four dairy substances (`cow-milk-whole`, `cream`,
 * `butter`, `buttermilk`) were derived from one another — each is an
 * independently sourced proximate composition. So separation and churning use
 * `splitByProfile` to divide the real input composition by relative
 * concentration, rather than assigning each output stream its own registry
 * composition directly (which would not reconcile, since these compositions do
 * not sum to each other's inputs exactly). Skim milk has no registry entry of
 * its own — real dairy skim milk is close to whole milk with its fat drawn off —
 * so its stream weighting reuses whole milk's own profile, the same technique
 * `mill.ts` uses for undifferentiated mill dust.
 */

import type { Composition, Micrograms, Microjoules } from '../core/commodity.js';
import { UG_PER_KG, UJ_PER_J, compositionMass, roundHalfEven } from '../core/commodity.js';
import type { AccountId, Posting } from '../core/ledger.js';
import { evaluateInterlock, type Interlock } from '../process/interlock.js';
import type { Machine, MachineDefinition } from '../process/machine.js';
import type { SubstanceRegistry } from '../substance/registry.js';
import { ProcessUnit, splitByProfile, type StreamProfile } from './unit.js';

/** Typical separator yield: cream is about 10% of whole milk's mass at
 * standard 3.25%-fat milk and ~37%-fat cream (the separator concentrates
 * essentially all the milk's fat into a small fraction of its mass). */
const DEFAULT_SEPARATION_RATE = 0.1;
const MIN_SEPARATION_RATE = 0.06;
const MAX_SEPARATION_RATE = 0.18;

/** Butter yield from cream tracks cream's own fat fraction closely — a
 * separator that concentrates butterfat to ~37% cream churns out close to
 * 37-38% of the cream's mass as butter, the rest as buttermilk. */
const DEFAULT_CHURN_YIELD_FRACTION = 0.38;
const MIN_CHURN_YIELD_FRACTION = 0.3;
const MAX_CHURN_YIELD_FRACTION = 0.45;

/** Standard HTST (high-temperature-short-time) pasteurisation hold point. */
export const PASTEURIZATION_HOLD_TEMP_C = 72;

/** Approximate specific heat of milk/cream, dominated by their high water
 * content: real dairy fluids run 3.8-3.95 kJ/(kg K); this uses water's own
 * figure as a representative constant for the mass-weighted heating cost. */
const SPECIFIC_HEAT_J_PER_KG_K = 3_900;

export const CREAMERY_MACHINE_DEFINITION: MachineDefinition = {
  type: 'creamery',
  tags: [
    {
      name: 'separation-rate',
      unit: 'fraction',
      kind: 'setpoint',
      min: MIN_SEPARATION_RATE,
      max: MAX_SEPARATION_RATE,
      initial: DEFAULT_SEPARATION_RATE,
    },
    {
      name: 'churn-yield-fraction',
      unit: 'fraction',
      kind: 'setpoint',
      min: MIN_CHURN_YIELD_FRACTION,
      max: MAX_CHURN_YIELD_FRACTION,
      initial: DEFAULT_CHURN_YIELD_FRACTION,
    },
    {
      name: 'pasteurization-temperature-c',
      unit: 'C',
      kind: 'measurement',
      min: 0,
      max: 100,
      initial: 4,
    },
    {
      name: 'vat-level-kg',
      unit: 'kg',
      kind: 'measurement',
      min: 0,
      max: 20_000,
      initial: 0,
    },
  ],
  maintenanceIntervalHours: 600,
  components: [
    { kind: 'bearing', label: 'separator bowl bearing', wearRatePerHour: 0.0005, dutyExponent: 1.4 },
    { kind: 'heating-element', label: 'pasteuriser plate heater', wearRatePerHour: 0.0003, dutyExponent: 1.0 },
    { kind: 'belt', label: 'churn drive belt', wearRatePerHour: 0.0005, dutyExponent: 1.2 },
  ],
};

/**
 * Create a creamery unit. Unlike the mill (a single continuous roller train),
 * this machine runs three distinct operations — separate, pasteurise, churn —
 * each gating on a different equipment or product-integrity condition, so
 * those interlocks are evaluated per-operation (see `vatInterlock` and
 * `churnInterlock`) rather than baked into the machine's own always-on gate:
 * a full vat is only meaningful before separation, and a pasteurisation hold
 * is only meaningful before churning.
 */
export function createCreamery(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: CREAMERY_MACHINE_DEFINITION });
}

/** The interlock guarding separation: a creamery refuses to separate with an
 * empty intake vat — an equipment condition, never anything about a person. */
function vatInterlock(machine: Machine): Interlock {
  return {
    id: 'creamery.vat-charge',
    label: 'vat charge interlock',
    protects: 'separator bowl',
    conditions: [
      {
        id: 'vat-charged',
        description: 'intake vat is empty',
        isSatisfied: () => machine.getTag('vat-level-kg') > 0,
      },
    ],
  };
}

/** The interlock guarding churning: cream that has not reached the
 * pasteurisation hold temperature cannot proceed to the churn, so an
 * under-processed batch is refused rather than turned into a specification
 * failure downstream. Built fresh per call because it reads the machine's own
 * tag at evaluation time. */
function churnInterlock(machine: Machine): Interlock {
  return {
    id: 'creamery.pasteurization-hold',
    label: 'pasteurisation hold interlock',
    protects: 'butter and buttermilk specification',
    conditions: [
      {
        id: 'pasteurized',
        description: `cream has not reached the ${PASTEURIZATION_HOLD_TEMP_C} C pasteurisation hold temperature`,
        isSatisfied: () => machine.getTag('pasteurization-temperature-c') >= PASTEURIZATION_HOLD_TEMP_C,
      },
    ],
  };
}

function heatEnergy(massUg: Micrograms, deltaTCelsius: number): Microjoules {
  if (deltaTCelsius <= 0) return 0n;
  const massKg = Number(massUg) / Number(UG_PER_KG);
  const joules = massKg * SPECIFIC_HEAT_J_PER_KG_K * deltaTCelsius;
  return roundHalfEven(joules * Number(UJ_PER_J));
}

export interface SeparateMilkParams {
  readonly milkAccount: AccountId;
  /** The exact composition of the milk being separated this batch. */
  readonly milkComposition: Composition;
  readonly creamAccount: AccountId;
  readonly skimAccount: AccountId;
  readonly process?: string;
}

export interface SeparateMilkYields {
  readonly cream: Micrograms;
  readonly skim: Micrograms;
}

/** The actual exact composition posted for each stream — see `MillCompositions`
 * in `mill.ts` for why a caller chaining a further step should use these
 * rather than a nominal registry composition. */
export interface SeparateMilkCompositions {
  readonly cream: Composition;
  readonly skim: Composition;
}

/** Separate one batch of whole milk into cream and skim milk. */
export function separateMilk(
  unit: ProcessUnit,
  registry: SubstanceRegistry,
  params: SeparateMilkParams,
): {
  readonly posting: Posting;
  readonly yields: SeparateMilkYields;
  readonly compositions: SeparateMilkCompositions;
} {
  const gate = evaluateInterlock(vatInterlock(unit.machine));
  if (!gate.ok) {
    throw new Error(`"${unit.machine.id}" refused batch "creamery:separate": ${gate.reason}`);
  }

  const separationRate = unit.machine.getTag('separation-rate');

  const streams: readonly StreamProfile[] = [
    { id: 'cream', elements: registry.get('cream').elements, targetShare: separationRate },
    {
      id: 'skim',
      elements: registry.get('cow-milk-whole').elements,
      targetShare: 1 - separationRate,
    },
  ];

  const [creamComposition, skimComposition] = splitByProfile(params.milkComposition, streams) as [
    Composition,
    Composition,
  ];

  const posting = unit.buildBatch({
    process: params.process ?? 'creamery:separate',
    inputs: [{ account: params.milkAccount, composition: params.milkComposition }],
    outputs: [
      { account: params.creamAccount, composition: creamComposition },
      { account: params.skimAccount, composition: skimComposition },
    ],
  });

  const milkMassKg = Number(compositionMass(params.milkComposition)) / 1e9;
  unit.machine.setTag('vat-level-kg', unit.machine.getTag('vat-level-kg') - milkMassKg);

  return {
    posting,
    yields: { cream: compositionMass(creamComposition), skim: compositionMass(skimComposition) },
    compositions: { cream: creamComposition, skim: skimComposition },
  };
}

export interface PasteurizeParams {
  /** The exact composition of the stream being held at pasteurisation
   * temperature — used only to size the energy cost; its mass and elements do
   * not change, so no material account needs to be named here at all. */
  readonly composition: Composition;
  readonly utilityAccount: AccountId;
  /** Where the heat used to hold the batch ultimately dissipates to, once it is
   * cooled back down after the hold — typically the radiative sink (see
   * `world/accounts.ts`'s `space` account). */
  readonly wasteHeatAccount: AccountId;
  /** Starting temperature before the hold. Defaults to a typical raw-milk
   * intake temperature. */
  readonly startTempC?: number;
  readonly process?: string;
}

/**
 * Hold a batch at the pasteurisation temperature. Moves no material at all —
 * only energy, debited from a real utility account and credited to where it is
 * ultimately lost as waste heat, so this step is auditable exactly like a
 * combustion or respiration reaction in `world/exchange.ts` even though nothing
 * here has an elemental commodity in play.
 */
export function pasteurize(
  unit: ProcessUnit,
  params: PasteurizeParams,
): { readonly posting: Posting; readonly energy: Microjoules } {
  const startTempC = params.startTempC ?? 4;
  const energy = heatEnergy(compositionMass(params.composition), PASTEURIZATION_HOLD_TEMP_C - startTempC);

  const posting = unit.buildBatch({
    process: params.process ?? 'creamery:pasteurize',
    inputs: [],
    outputs: [],
    energyInputs: [{ account: params.utilityAccount, amount: energy }],
    energyOutputs: [{ account: params.wasteHeatAccount, amount: energy }],
  });

  unit.machine.setTag('pasteurization-temperature-c', PASTEURIZATION_HOLD_TEMP_C);

  return { posting, energy };
}

export interface ChurnCreamParams {
  readonly creamAccount: AccountId;
  /** The exact composition of the cream being churned this batch. */
  readonly creamComposition: Composition;
  readonly butterAccount: AccountId;
  readonly buttermilkAccount: AccountId;
  readonly process?: string;
}

export interface ChurnCreamYields {
  readonly butter: Micrograms;
  readonly buttermilk: Micrograms;
}

export interface ChurnCreamCompositions {
  readonly butter: Composition;
  readonly buttermilk: Composition;
}

/**
 * Churn one batch of pasteurised cream into butter and buttermilk. Refused,
 * before any material moves, if the cream has not been held at pasteurisation
 * temperature — see `churnInterlock`.
 */
export function churnCream(
  unit: ProcessUnit,
  registry: SubstanceRegistry,
  params: ChurnCreamParams,
): {
  readonly posting: Posting;
  readonly yields: ChurnCreamYields;
  readonly compositions: ChurnCreamCompositions;
} {
  const gate = evaluateInterlock(churnInterlock(unit.machine));
  if (!gate.ok) {
    throw new Error(`"${unit.machine.id}" refused batch "creamery:churn": ${gate.reason}`);
  }

  const churnYieldFraction = unit.machine.getTag('churn-yield-fraction');

  const streams: readonly StreamProfile[] = [
    { id: 'butter', elements: registry.get('butter').elements, targetShare: churnYieldFraction },
    {
      id: 'buttermilk',
      elements: registry.get('buttermilk').elements,
      targetShare: 1 - churnYieldFraction,
    },
  ];

  const [butterComposition, buttermilkComposition] = splitByProfile(params.creamComposition, streams) as [
    Composition,
    Composition,
  ];

  const posting = unit.buildBatch({
    process: params.process ?? 'creamery:churn',
    inputs: [{ account: params.creamAccount, composition: params.creamComposition }],
    outputs: [
      { account: params.butterAccount, composition: butterComposition },
      { account: params.buttermilkAccount, composition: buttermilkComposition },
    ],
  });

  return {
    posting,
    yields: {
      butter: compositionMass(butterComposition),
      buttermilk: compositionMass(buttermilkComposition),
    },
    compositions: { butter: butterComposition, buttermilk: buttermilkComposition },
  };
}
