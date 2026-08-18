/**
 * Mixing, forming and dosing equipment.
 *
 * Four physical shapes cover every named machine in this file:
 *
 * - `mixBatch` — a mixer does real mechanical work on a batch. The mass and
 *   elemental composition in the bowl do not change; the motor's mechanical
 *   energy is drawn from a real utility account and, exactly like
 *   `creamery.ts`'s pasteurisation hold, credited to a waste-heat account —
 *   almost all of it ends up as sensible heat in the product (the same real
 *   effect `bake/batter.ts` documents: a long-mixed dough comes out
 *   measurably warmer). The implied temperature rise is reported and also
 *   recorded on the machine's own temperature tag.
 * - `aerateBatch` — a pressure-whisk aerator folds a real, ledgered mass of
 *   air (drawn from the `atmosphere` reservoir, see `world/accounts.ts`)
 *   into a batch to reach a measured target air volume fraction. Air is
 *   roughly 800x less dense than a typical batter, so this is a small mass
 *   addition for a large volume effect — real, not a shortcut.
 * - `formPortions` — sheeting, extruding, moulding, depositing, dividing,
 *   cutting and sieving are all, at the mass-balance level, the same
 *   operation: an input stream is split, by `unit.ts`'s `splitByProfile`
 *   technique, into a product stream and a second stream (trim, screenings,
 *   fines) that keeps the input's own elemental ratios exactly. Where real
 *   trim is reworked rather than discarded, the caller names a rework
 *   account for it — see each machine's own doc comment for which is real.
 * - `doseFromSilo` — metered silo dosing is a plain, exact transfer: a
 *   declared mass moves from a silo stock account into a batch account, with
 *   no split and no loss, gated by the same "hopper/silo must be charged"
 *   interlock shape `mill.ts` and `refinery.ts` already use.
 */

import type { Composition, Micrograms, Microjoules } from '../../core/commodity.js';
import { UG_PER_KG, compositionMass, joules } from '../../core/commodity.js';
import type { AccountId, Posting } from '../../core/ledger.js';
import type { Interlock } from '../../process/interlock.js';
import type { Machine, MachineDefinition } from '../../process/machine.js';
import { ProcessUnit, splitByProfile } from '../unit.js';
import { UNIFORM_PROFILE, airMassForVolumeFraction, airComposition } from './shared.js';

// ---------------------------------------------------------------------------
// Mixers: planetary, spiral, continuous.
// ---------------------------------------------------------------------------

/** Representative composite specific heat for a flour-based dough or batter —
 * water-dominated but diluted by flour's own much lower figure; see
 * `creamery.ts`'s `SPECIFIC_HEAT_J_PER_KG_K` for the analogous dairy
 * constant. Callers with a more specific mixture may override it. */
export const DEFAULT_MIX_SPECIFIC_HEAT_J_PER_KG_K = 3_500;

/** Mixing-energy engineering figures (Wh/kg converted to J/kg): conventional
 * planetary/spiral bulk fermentation mixing runs roughly 3-15 kJ/kg;
 * high-intensity mixing (the Chorleywood Bread Process's defining technique)
 * runs to roughly 11 Wh/kg = 39.6 kJ/kg (Cauvain & Young, "Technology of
 * Breadmaking"); a continuous mixer's shorter residence time keeps it toward
 * the low end of the same range. These are the setpoint ranges below, not a
 * literal universal constant — a real mixer's specific energy also depends
 * on dough consistency and batch size. */
const MIN_SPECIFIC_WORK_J_PER_KG = 2_000;
const MAX_SPECIFIC_WORK_J_PER_KG = 42_000;

function mixerTags(defaultSpecificWorkJPerKg: number) {
  return [
    {
      name: 'specific-work-j-per-kg',
      unit: 'J/kg',
      kind: 'setpoint' as const,
      min: MIN_SPECIFIC_WORK_J_PER_KG,
      max: MAX_SPECIFIC_WORK_J_PER_KG,
      initial: defaultSpecificWorkJPerKg,
    },
    {
      name: 'bowl-guard-closed',
      unit: 'bool',
      kind: 'measurement' as const,
      min: 0,
      max: 1,
      initial: 0,
    },
    {
      name: 'product-temperature-c',
      unit: 'C',
      kind: 'measurement' as const,
      min: -20,
      max: 120,
      initial: 20,
    },
  ];
}

/** A mixer refuses to run its beater with the bowl guard open — an equipment
 * interlock (it protects the beater and drive train from an open guard),
 * never anything about a person. */
function bowlGuardInterlock(machine: Machine): Interlock {
  return {
    id: 'mixer.bowl-guard',
    label: 'bowl guard interlock',
    protects: 'beater and drive train',
    conditions: [
      {
        id: 'guard-closed',
        description: 'bowl guard is open',
        isSatisfied: () => machine.getTag('bowl-guard-closed') >= 1,
      },
    ],
  };
}

export const PLANETARY_MIXER_DEFINITION: MachineDefinition = {
  type: 'planetary-mixer',
  tags: mixerTags(10_000),
  maintenanceIntervalHours: 1_200,
  components: [
    { kind: 'bearing', label: 'planetary head bearing', wearRatePerHour: 0.0004, dutyExponent: 1.3 },
    { kind: 'belt', label: 'main drive belt', wearRatePerHour: 0.0005, dutyExponent: 1.2 },
  ],
};

export const SPIRAL_MIXER_DEFINITION: MachineDefinition = {
  type: 'spiral-mixer',
  tags: mixerTags(25_000),
  maintenanceIntervalHours: 1_500,
  components: [
    { kind: 'bearing', label: 'spiral hook bearing', wearRatePerHour: 0.0005, dutyExponent: 1.4 },
    { kind: 'seal', label: 'bowl drive seal', wearRatePerHour: 0.0003, dutyExponent: 1.1 },
  ],
};

export const CONTINUOUS_MIXER_DEFINITION: MachineDefinition = {
  type: 'continuous-mixer',
  tags: mixerTags(6_000),
  maintenanceIntervalHours: 2_000,
  components: [
    { kind: 'bearing', label: 'mixing shaft bearing', wearRatePerHour: 0.0004, dutyExponent: 1.3 },
    { kind: 'seal', label: 'inlet throat seal', wearRatePerHour: 0.0004, dutyExponent: 1.2 },
  ],
};

function createMixer(id: string, label: string, definition: MachineDefinition): ProcessUnit {
  return new ProcessUnit({ id, label, definition, interlocks: (machine) => [bowlGuardInterlock(machine)] });
}

export function createPlanetaryMixer(id: string, label: string): ProcessUnit {
  return createMixer(id, label, PLANETARY_MIXER_DEFINITION);
}

export function createSpiralMixer(id: string, label: string): ProcessUnit {
  return createMixer(id, label, SPIRAL_MIXER_DEFINITION);
}

export function createContinuousMixer(id: string, label: string): ProcessUnit {
  return createMixer(id, label, CONTINUOUS_MIXER_DEFINITION);
}

export interface MixBatchParams {
  readonly productAccount: AccountId;
  /** The exact composition currently in the bowl. Unchanged by mixing — only
   * energy moves. */
  readonly productComposition: Composition;
  readonly utilityAccount: AccountId;
  readonly wasteHeatAccount: AccountId;
  readonly specificHeatJPerKgK?: number;
  readonly process?: string;
}

export interface MixBatchResult {
  readonly posting: Posting;
  readonly energy: Microjoules;
  readonly temperatureRiseC: number;
}

/**
 * Run one mixing pass. Reads specific mechanical work from the unit's own
 * `specific-work-j-per-kg` setpoint; the same function serves any of the
 * three mixer types above, which differ only in their machine definition
 * (setpoint range, wear components) — exactly the "no subclass per physical
 * machine" principle `process/machine.ts` states.
 */
export function mixBatch(unit: ProcessUnit, params: MixBatchParams): MixBatchResult {
  const specificWorkJPerKg = unit.machine.getTag('specific-work-j-per-kg');
  const massUg = compositionMass(params.productComposition);
  const massKg = Number(massUg) / Number(UG_PER_KG);
  const specificHeat = params.specificHeatJPerKgK ?? DEFAULT_MIX_SPECIFIC_HEAT_J_PER_KG_K;

  const energyJ = specificWorkJPerKg * massKg;
  const energy = joules(energyJ);
  const temperatureRiseC = massKg > 0 ? energyJ / (massKg * specificHeat) : 0;

  const posting = unit.buildBatch({
    process: params.process ?? `${unit.machine.definition.type}:mix`,
    inputs: [],
    outputs: [],
    energyInputs: [{ account: params.utilityAccount, amount: energy }],
    energyOutputs: [{ account: params.wasteHeatAccount, amount: energy }],
  });

  unit.machine.setTag(
    'product-temperature-c',
    unit.machine.getTag('product-temperature-c') + temperatureRiseC,
  );

  return { posting, energy, temperatureRiseC };
}

// ---------------------------------------------------------------------------
// Pressure-whisk aerator.
// ---------------------------------------------------------------------------

const MIN_CHAMBER_PRESSURE_BAR = 1;
const MAX_CHAMBER_PRESSURE_BAR = 6;

/** A representative density for an unaerated cream/batter base — real values
 * run roughly 950-1,250 kg/m^3 depending on fat and sugar content; 1,050
 * kg/m^3 is used as a representative midpoint and is overridable per call. */
export const DEFAULT_BASE_DENSITY_KG_PER_M3 = 1_050;

const MAX_AIR_VOLUME_FRACTION_SETPOINT = 0.65; // above this the foam cannot hold its own structure

export const AERATOR_DEFINITION: MachineDefinition = {
  type: 'pressure-whisk-aerator',
  tags: [
    {
      name: 'target-air-volume-fraction',
      unit: 'fraction',
      kind: 'setpoint',
      min: 0,
      max: MAX_AIR_VOLUME_FRACTION_SETPOINT,
      initial: 0.35,
    },
    {
      name: 'chamber-pressure-bar',
      unit: 'bar',
      kind: 'measurement',
      min: 0,
      max: MAX_CHAMBER_PRESSURE_BAR,
      initial: 0,
    },
  ],
  maintenanceIntervalHours: 900,
  components: [{ kind: 'seal', label: 'pressure chamber seal', wearRatePerHour: 0.0006, dutyExponent: 1.3 }],
};

/** An aerator refuses to whisk outside its designed chamber pressure band —
 * bubble size (and so the foam's own structure) depends on running at
 * controlled positive pressure; an equipment/product-integrity condition. */
function chamberPressureInterlock(machine: Machine): Interlock {
  return {
    id: 'aerator.chamber-pressure',
    label: 'chamber pressure interlock',
    protects: 'foam structure and pressure chamber seal',
    conditions: [
      {
        id: 'pressure-in-band',
        description: `chamber pressure is outside the ${MIN_CHAMBER_PRESSURE_BAR}-${MAX_CHAMBER_PRESSURE_BAR} bar operating band`,
        isSatisfied: () => {
          const bar = machine.getTag('chamber-pressure-bar');
          return bar >= MIN_CHAMBER_PRESSURE_BAR && bar <= MAX_CHAMBER_PRESSURE_BAR;
        },
      },
    ],
  };
}

export function createAerator(id: string, label: string): ProcessUnit {
  return new ProcessUnit({
    id,
    label,
    definition: AERATOR_DEFINITION,
    interlocks: (machine) => [chamberPressureInterlock(machine)],
  });
}

export interface AerateBatchParams {
  readonly baseAccount: AccountId;
  readonly baseComposition: Composition;
  readonly atmosphereAccount: AccountId;
  readonly baseDensityKgPerM3?: number;
  readonly process?: string;
}

export interface AerateBatchResult {
  readonly posting: Posting;
  readonly airMass: Micrograms;
  readonly aeratedComposition: Composition;
}

/** Fold real air mass into a batch, drawn from the atmosphere reservoir, to
 * reach the unit's own `target-air-volume-fraction` setpoint. */
export function aerateBatch(unit: ProcessUnit, params: AerateBatchParams): AerateBatchResult {
  const targetFraction = unit.machine.getTag('target-air-volume-fraction');
  const baseDensity = params.baseDensityKgPerM3 ?? DEFAULT_BASE_DENSITY_KG_PER_M3;
  const airMass = airMassForVolumeFraction(
    compositionMass(params.baseComposition),
    baseDensity,
    targetFraction,
  );
  const airMix = airComposition(airMass);

  const posting = unit.buildBatch({
    process: params.process ?? 'pressure-whisk-aerator:aerate',
    inputs: [{ account: params.atmosphereAccount, composition: airMix }],
    outputs: [{ account: params.baseAccount, composition: airMix }],
  });

  const aeratedComposition = new Map(params.baseComposition);
  for (const [element, amount] of airMix) {
    aeratedComposition.set(element, (aeratedComposition.get(element) ?? 0n) + amount);
  }

  return { posting, airMass, aeratedComposition };
}

// ---------------------------------------------------------------------------
// Forming, cutting and sieving: sheeter, extruder, wire-cut and rotary
// moulder, piston and volumetric depositor, divider, guillotine, ultrasonic
// cutter, sieve and sifter.
// ---------------------------------------------------------------------------

function formingTags(defaultYield: number, minYield: number) {
  return [
    {
      name: 'yield-fraction',
      unit: 'fraction',
      kind: 'setpoint' as const,
      min: minYield,
      max: 1,
      initial: defaultYield,
    },
    {
      name: 'feed-level-kg',
      unit: 'kg',
      kind: 'measurement' as const,
      min: 0,
      max: 5_000,
      initial: 0,
    },
  ];
}

/** A forming/cutting machine refuses to run with nothing fed — the same
 * equipment condition `mill.ts`'s feed hopper interlock guards, generalised
 * to any of the machines in this section. */
function feedChargedInterlock(machine: Machine, protects: string): Interlock {
  return {
    id: 'forming.feed-charge',
    label: 'feed charge interlock',
    protects,
    conditions: [
      {
        id: 'feed-charged',
        description: 'feed is empty',
        isSatisfied: () => machine.getTag('feed-level-kg') > 0,
      },
    ],
  };
}

function createFormingUnit(
  id: string,
  label: string,
  definition: MachineDefinition,
  protects: string,
): ProcessUnit {
  return new ProcessUnit({ id, label, definition, interlocks: (machine) => [feedChargedInterlock(machine, protects)] });
}

export const SHEETER_DEFINITION: MachineDefinition = {
  type: 'sheeter',
  tags: formingTags(0.97, 0.85),
  maintenanceIntervalHours: 1_000,
  components: [{ kind: 'bearing', label: 'sheeting roller bearing', wearRatePerHour: 0.0004, dutyExponent: 1.2 }],
};

export const EXTRUDER_DEFINITION: MachineDefinition = {
  type: 'extruder',
  tags: formingTags(0.98, 0.9),
  maintenanceIntervalHours: 1_100,
  components: [{ kind: 'seal', label: 'barrel screw seal', wearRatePerHour: 0.0005, dutyExponent: 1.4 }],
};

export const WIRE_CUT_MOULDER_DEFINITION: MachineDefinition = {
  type: 'wire-cut-moulder',
  tags: formingTags(0.96, 0.85),
  maintenanceIntervalHours: 900,
  components: [{ kind: 'belt', label: 'cutting wire drive belt', wearRatePerHour: 0.0006, dutyExponent: 1.3 }],
};

export const ROTARY_MOULDER_DEFINITION: MachineDefinition = {
  type: 'rotary-moulder',
  tags: formingTags(0.95, 0.85),
  maintenanceIntervalHours: 950,
  components: [{ kind: 'bearing', label: 'die roll bearing', wearRatePerHour: 0.0005, dutyExponent: 1.3 }],
};

export const PISTON_DEPOSITOR_DEFINITION: MachineDefinition = {
  type: 'piston-depositor',
  tags: formingTags(0.995, 0.95),
  maintenanceIntervalHours: 1_200,
  components: [{ kind: 'seal', label: 'piston cylinder seal', wearRatePerHour: 0.0003, dutyExponent: 1.1 }],
};

export const VOLUMETRIC_DEPOSITOR_DEFINITION: MachineDefinition = {
  type: 'volumetric-depositor',
  tags: formingTags(0.995, 0.95),
  maintenanceIntervalHours: 1_200,
  components: [{ kind: 'seal', label: 'metering pump seal', wearRatePerHour: 0.0003, dutyExponent: 1.1 }],
};

export const DIVIDER_DEFINITION: MachineDefinition = {
  type: 'divider',
  tags: formingTags(0.99, 0.9),
  maintenanceIntervalHours: 1_000,
  components: [{ kind: 'bearing', label: 'divider ram bearing', wearRatePerHour: 0.0004, dutyExponent: 1.2 }],
};

export const GUILLOTINE_DEFINITION: MachineDefinition = {
  type: 'guillotine',
  tags: formingTags(0.94, 0.8),
  maintenanceIntervalHours: 800,
  components: [{ kind: 'bearing', label: 'guillotine blade bearing', wearRatePerHour: 0.0006, dutyExponent: 1.4 }],
};

/** Ultrasonic cutting reduces drag on the blade edge and the resulting crumb
 * loss compared with a plain guillotine cut on the same product (a real,
 * documented advantage of ultrasonic food cutting — less product deforms or
 * tears at the cut line), so its yield-fraction setpoint sits higher. */
export const ULTRASONIC_CUTTER_DEFINITION: MachineDefinition = {
  type: 'ultrasonic-cutter',
  tags: formingTags(0.985, 0.92),
  maintenanceIntervalHours: 1_000,
  components: [{ kind: 'heating-element', label: 'ultrasonic transducer', wearRatePerHour: 0.0004, dutyExponent: 1.2 }],
};

export const SIEVE_DEFINITION: MachineDefinition = {
  type: 'sieve',
  tags: formingTags(0.9, 0.6),
  maintenanceIntervalHours: 700,
  components: [{ kind: 'belt', label: 'sieve deck drive belt', wearRatePerHour: 0.0005, dutyExponent: 1.1 }],
};

export const SIFTER_DEFINITION: MachineDefinition = {
  type: 'sifter',
  tags: formingTags(0.92, 0.6),
  maintenanceIntervalHours: 700,
  components: [{ kind: 'belt', label: 'sifter deck drive belt', wearRatePerHour: 0.0005, dutyExponent: 1.1 }],
};

export function createSheeter(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, SHEETER_DEFINITION, 'sheeting rollers');
}
export function createExtruder(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, EXTRUDER_DEFINITION, 'barrel screw');
}
export function createWireCutMoulder(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, WIRE_CUT_MOULDER_DEFINITION, 'cutting wire');
}
export function createRotaryMoulder(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, ROTARY_MOULDER_DEFINITION, 'moulding die roll');
}
export function createPistonDepositor(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, PISTON_DEPOSITOR_DEFINITION, 'piston cylinder');
}
export function createVolumetricDepositor(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, VOLUMETRIC_DEPOSITOR_DEFINITION, 'metering pump');
}
export function createDivider(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, DIVIDER_DEFINITION, 'divider ram');
}
export function createGuillotine(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, GUILLOTINE_DEFINITION, 'guillotine blade');
}
export function createUltrasonicCutter(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, ULTRASONIC_CUTTER_DEFINITION, 'ultrasonic transducer');
}
export function createSieve(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, SIEVE_DEFINITION, 'sieve deck');
}
export function createSifter(id: string, label: string): ProcessUnit {
  return createFormingUnit(id, label, SIFTER_DEFINITION, 'sifter deck');
}

export interface FormPortionsParams {
  readonly inputAccount: AccountId;
  readonly inputComposition: Composition;
  readonly productAccount: AccountId;
  /** Where the mass not retained as product goes — real trim reworked into
   * the next batch, screenings from a sieve, or scrap: whichever this
   * particular machine's second stream actually is. Never discarded outside
   * the ledger. */
  readonly secondaryAccount: AccountId;
  readonly process?: string;
}

export interface FormPortionsResult {
  readonly posting: Posting;
  readonly productMass: Micrograms;
  readonly secondaryMass: Micrograms;
  readonly productComposition: Composition;
  readonly secondaryComposition: Composition;
}

/**
 * Split an input stream into a product stream and a second stream (trim,
 * screenings, scrap) in the unit's own `yield-fraction` ratio, preserving the
 * input's own elemental ratios in both — the shared shape behind every named
 * machine in this section. `unit.buildBatch` gates on the feed-charge
 * interlock and on the machine being in a running mode before any
 * composition math runs.
 */
export function formPortions(unit: ProcessUnit, params: FormPortionsParams): FormPortionsResult {
  const yieldFraction = unit.machine.getTag('yield-fraction');

  const streams = [
    { id: 'product', elements: UNIFORM_PROFILE, targetShare: yieldFraction },
    { id: 'secondary', elements: UNIFORM_PROFILE, targetShare: 1 - yieldFraction },
  ];
  const [productComposition, secondaryComposition] = splitByProfile(params.inputComposition, streams) as [
    Composition,
    Composition,
  ];

  const posting = unit.buildBatch({
    process: params.process ?? `${unit.machine.definition.type}:form`,
    inputs: [{ account: params.inputAccount, composition: params.inputComposition }],
    outputs: [
      { account: params.productAccount, composition: productComposition },
      { account: params.secondaryAccount, composition: secondaryComposition },
    ],
  });

  const feedMassKg = Number(compositionMass(params.inputComposition)) / Number(UG_PER_KG);
  unit.machine.setTag('feed-level-kg', unit.machine.getTag('feed-level-kg') - feedMassKg);

  return {
    posting,
    productMass: compositionMass(productComposition),
    secondaryMass: compositionMass(secondaryComposition),
    productComposition,
    secondaryComposition,
  };
}

// ---------------------------------------------------------------------------
// Metered silo dosing.
// ---------------------------------------------------------------------------

export const SILO_DOSER_DEFINITION: MachineDefinition = {
  type: 'silo-doser',
  tags: [
    {
      name: 'silo-level-kg',
      unit: 'kg',
      kind: 'measurement',
      min: 0,
      max: 50_000,
      initial: 0,
    },
  ],
  maintenanceIntervalHours: 2_000,
  components: [{ kind: 'seal', label: 'metering valve seal', wearRatePerHour: 0.0002, dutyExponent: 1.0 }],
};

export function createSiloDoser(id: string, label: string): ProcessUnit {
  return new ProcessUnit({
    id,
    label,
    definition: SILO_DOSER_DEFINITION,
    interlocks: (machine) => [
      {
        id: 'silo-doser.silo-charge',
        label: 'silo charge interlock',
        protects: 'metering valve',
        conditions: [
          {
            id: 'silo-charged',
            description: 'silo is empty',
            isSatisfied: () => machine.getTag('silo-level-kg') > 0,
          },
        ],
      },
    ],
  });
}

export interface DoseFromSiloParams {
  readonly siloAccount: AccountId;
  readonly doseComposition: Composition;
  readonly batchAccount: AccountId;
  readonly process?: string;
}

export interface DoseFromSiloResult {
  readonly posting: Posting;
  readonly doseMass: Micrograms;
}

/** Meter one exact dose from a silo into a batch — a plain balanced
 * transfer, no split, no loss. */
export function doseFromSilo(unit: ProcessUnit, params: DoseFromSiloParams): DoseFromSiloResult {
  const posting = unit.buildBatch({
    process: params.process ?? 'silo-doser:dose',
    inputs: [{ account: params.siloAccount, composition: params.doseComposition }],
    outputs: [{ account: params.batchAccount, composition: params.doseComposition }],
  });

  const doseMassKg = Number(compositionMass(params.doseComposition)) / Number(UG_PER_KG);
  unit.machine.setTag('silo-level-kg', unit.machine.getTag('silo-level-kg') - doseMassKg);

  return { posting, doseMass: compositionMass(params.doseComposition) };
}
