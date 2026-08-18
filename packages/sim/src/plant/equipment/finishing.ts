/**
 * Cooling, finishing and decoration equipment.
 *
 * Three physical shapes cover every named machine in this file:
 *
 * - `holdAtTemperature` — spiral cooler, blast chiller, freezer, proofer and
 *   retarder are all, at the mass-and-energy-balance level, a product held
 *   at a new temperature. No mass moves except an optional real condensate
 *   stream when a humid product is cooled below its own moisture's dew
 *   point (the same "moisture leaves as a declared loss" shape `mill.ts`
 *   uses for drying, applied to cooling instead). Heating draws energy
 *   directly from a utility account exactly like `creamery.ts`'s
 *   pasteurisation hold; cooling draws less electrical energy than the heat
 *   actually removed, scaled by a real refrigeration coefficient of
 *   performance (COP), and both ultimately reject that energy to the same
 *   waste-heat account.
 * - `temperChocolate` — a self-contained three-stage energy balance (melt,
 *   cool, reheat) following the real chocolate tempering curve, moving no
 *   mass at all; see the function's own doc comment for the temperatures and
 *   their source.
 * - `applyFinish` — enrobing, spraying, airbrushing, glazing, icing
 *   depositing, edible-ink printing, sprinkle application and layering are
 *   all, at the mass-balance level, the same operation: a finishing
 *   substance is drawn from its own supply, a real fraction of it is
 *   retained on the product, and whatever is not retained is declared to a
 *   named account (a reclaim tray for sprinkles that miss and can be
 *   reworked, a filter or drain for oversprayed coating) rather than
 *   silently discarded.
 */

import type { Composition, Micrograms, Microjoules } from '../../core/commodity.js';
import { addComposition, compositionMass, emptyComposition } from '../../core/commodity.js';
import type { AccountId, Posting } from '../../core/ledger.js';
import type { Interlock } from '../../process/interlock.js';
import type { Machine, MachineDefinition } from '../../process/machine.js';
import type { SubstanceRegistry } from '../../substance/registry.js';
import { ProcessUnit, splitByProfile } from '../unit.js';
import { UNIFORM_PROFILE, sensibleHeatEnergy } from './shared.js';

// ---------------------------------------------------------------------------
// Spiral cooler, blast chiller, freezer, proofer and retarder: all a product
// held at a new temperature.
// ---------------------------------------------------------------------------

/**
 * Refrigeration coefficient of performance: real chilling/freezing plant
 * moves several joules of heat per joule of electrical work, not one-for-one
 * — a representative commercial range is roughly COP 2.5-3.5 for chilling
 * (small temperature lift) and COP 1.5-2.5 for freezing (larger lift, colder
 * evaporator), consistent with ASHRAE reference figures for vapour-compression
 * refrigeration. A heater's own "COP" is 1 — every joule of electrical
 * resistance heating becomes a joule of heat in the product, the same
 * assumption `creamery.ts`'s pasteurisation hold already makes.
 */
export const HEATING_COP = 1;
const CHILLING_COP = 3;
const FREEZING_COP = 2;
const RETARDING_COP = 2.5;

/** A cooling hold's default COP, by machine type, when the caller does not
 * override it — a freezer's larger temperature lift down to a colder
 * evaporator runs a lower COP than a chiller's or retarder's shallower one.
 * Proofing is a heating hold (`HEATING_COP` applies via `holdAtTemperature`
 * itself) and is not looked up here. */
const DEFAULT_COOLING_COP_BY_TYPE: Readonly<Record<string, number>> = {
  'spiral-cooler': CHILLING_COP,
  'blast-chiller': CHILLING_COP,
  freezer: FREEZING_COP,
  retarder: RETARDING_COP,
};

function holdTags(minTempC: number, maxTempC: number, initialTargetC: number) {
  return [
    {
      name: 'target-temperature-c',
      unit: 'C',
      kind: 'setpoint' as const,
      min: minTempC,
      max: maxTempC,
      initial: initialTargetC,
    },
    {
      name: 'condensate-fraction',
      unit: 'fraction',
      kind: 'setpoint' as const,
      min: 0,
      max: 0.05,
      initial: 0,
    },
    {
      name: 'product-temperature-c',
      unit: 'C',
      kind: 'measurement' as const,
      min: minTempC - 10,
      max: maxTempC + 10,
      initial: initialTargetC,
    },
  ];
}

/** A holding chamber refuses to run with its door open — an equipment
 * interlock (an open door cannot hold a set temperature), never anything
 * about a person. */
function doorInterlock(machine: Machine, protects: string): Interlock {
  return {
    id: 'hold.door-closed',
    label: 'chamber door interlock',
    protects,
    conditions: [
      {
        id: 'door-closed',
        description: 'chamber door is open',
        isSatisfied: () => machine.getTag('door-closed') >= 1,
      },
    ],
  };
}

function holdTagsWithDoor(minTempC: number, maxTempC: number, initialTargetC: number) {
  return [
    ...holdTags(minTempC, maxTempC, initialTargetC),
    { name: 'door-closed', unit: 'bool', kind: 'measurement' as const, min: 0, max: 1, initial: 0 },
  ];
}

export const SPIRAL_COOLER_DEFINITION: MachineDefinition = {
  type: 'spiral-cooler',
  tags: holdTagsWithDoor(0, 25, 15),
  maintenanceIntervalHours: 1_500,
  components: [{ kind: 'belt', label: 'spiral conveyor belt', wearRatePerHour: 0.0003, dutyExponent: 1.1 }],
};

export const BLAST_CHILLER_DEFINITION: MachineDefinition = {
  type: 'blast-chiller',
  tags: holdTagsWithDoor(-5, 10, 3),
  maintenanceIntervalHours: 1_800,
  components: [{ kind: 'bearing', label: 'evaporator fan bearing', wearRatePerHour: 0.0004, dutyExponent: 1.2 }],
};

export const FREEZER_DEFINITION: MachineDefinition = {
  type: 'freezer',
  tags: holdTagsWithDoor(-30, -10, -18),
  maintenanceIntervalHours: 2_000,
  components: [{ kind: 'bearing', label: 'evaporator fan bearing', wearRatePerHour: 0.0004, dutyExponent: 1.3 }],
};

export const PROOFER_DEFINITION: MachineDefinition = {
  type: 'proofer',
  tags: holdTagsWithDoor(25, 40, 35),
  maintenanceIntervalHours: 1_200,
  components: [{ kind: 'heating-element', label: 'proof box steam element', wearRatePerHour: 0.0003, dutyExponent: 1.0 }],
};

export const RETARDER_DEFINITION: MachineDefinition = {
  type: 'retarder',
  tags: holdTagsWithDoor(-2, 8, 4),
  maintenanceIntervalHours: 1_800,
  components: [{ kind: 'bearing', label: 'evaporator fan bearing', wearRatePerHour: 0.0003, dutyExponent: 1.1 }],
};

function createHoldUnit(id: string, label: string, definition: MachineDefinition, protects: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition, interlocks: (machine) => [doorInterlock(machine, protects)] });
}

export function createSpiralCooler(id: string, label: string): ProcessUnit {
  return createHoldUnit(id, label, SPIRAL_COOLER_DEFINITION, 'spiral conveyor');
}
export function createBlastChiller(id: string, label: string): ProcessUnit {
  return createHoldUnit(id, label, BLAST_CHILLER_DEFINITION, 'evaporator coil');
}
export function createFreezer(id: string, label: string): ProcessUnit {
  return createHoldUnit(id, label, FREEZER_DEFINITION, 'evaporator coil');
}
export function createProofer(id: string, label: string): ProcessUnit {
  return createHoldUnit(id, label, PROOFER_DEFINITION, 'proof box steam element');
}
export function createRetarder(id: string, label: string): ProcessUnit {
  return createHoldUnit(id, label, RETARDER_DEFINITION, 'evaporator coil');
}

export interface HoldAtTemperatureParams {
  readonly productAccount: AccountId;
  readonly productComposition: Composition;
  readonly utilityAccount: AccountId;
  readonly wasteHeatAccount: AccountId;
  /** Where condensed moisture is credited when cooling a humid product below
   * its own dew point — a real drain/pan account, never omitted if
   * `condensate-fraction` is non-zero. */
  readonly condensateAccount: AccountId;
  readonly startTempC: number;
  readonly specificHeatJPerKgK?: number;
  /** Refrigeration COP for a cooling hold; ignored (treated as `HEATING_COP`)
   * when this call is a heating hold. */
  readonly cop?: number;
  readonly process?: string;
}

export interface HoldAtTemperatureResult {
  readonly posting: Posting;
  readonly energy: Microjoules;
  readonly condensateMass: Micrograms;
  readonly heating: boolean;
}

const DEFAULT_HOLD_SPECIFIC_HEAT_J_PER_KG_K = 3_200; // representative baked-goods figure, water-diluted by starch and fat

/**
 * Hold a product at the unit's own `target-temperature-c` setpoint. Heating
 * (target above start) draws sensible-heat energy directly from the utility
 * account. Cooling (target below start) draws the same sensible heat divided
 * by a refrigeration COP — real compression refrigeration moves more heat
 * than the electrical work it consumes — and, if the unit's
 * `condensate-fraction` setpoint is non-zero, credits a real condensate mass
 * (split proportionally from the product's own composition, standing in for
 * "the moisture that leaves the product") to `condensateAccount`.
 */
export function holdAtTemperature(
  unit: ProcessUnit,
  registry: SubstanceRegistry,
  params: HoldAtTemperatureParams,
): HoldAtTemperatureResult {
  const targetTempC = unit.machine.getTag('target-temperature-c');
  const deltaT = targetTempC - params.startTempC;
  const specificHeat = params.specificHeatJPerKgK ?? DEFAULT_HOLD_SPECIFIC_HEAT_J_PER_KG_K;
  const heating = deltaT >= 0;
  const defaultCop = DEFAULT_COOLING_COP_BY_TYPE[unit.machine.definition.type] ?? CHILLING_COP;
  const cop = heating ? HEATING_COP : (params.cop ?? defaultCop);

  const heatMagnitude = sensibleHeatEnergy(compositionMass(params.productComposition), specificHeat, deltaT);
  const energy = heatMagnitude === 0n ? 0n : (heatMagnitude * 1_000_000n) / BigInt(Math.round(cop * 1_000_000));

  const condensateFraction = heating ? 0 : unit.machine.getTag('condensate-fraction');
  let condensateComposition: Composition = emptyComposition();
  if (condensateFraction > 0) {
    const flourWaterProfile = registry.get('water-liquid').elements;
    const streams = [
      { id: 'remaining', elements: UNIFORM_PROFILE, targetShare: 1 - condensateFraction },
      { id: 'condensate', elements: flourWaterProfile, targetShare: condensateFraction },
    ];
    const [, condensate] = splitByProfile(params.productComposition, streams) as [Composition, Composition];
    condensateComposition = condensate;
  }
  const condensateMass = compositionMass(condensateComposition);

  const posting = unit.buildBatch({
    process: params.process ?? `${unit.machine.definition.type}:hold`,
    inputs: condensateMass > 0n ? [{ account: params.productAccount, composition: condensateComposition }] : [],
    outputs: condensateMass > 0n ? [{ account: params.condensateAccount, composition: condensateComposition }] : [],
    energyInputs: energy > 0n ? [{ account: params.utilityAccount, amount: energy }] : [],
    energyOutputs: energy > 0n ? [{ account: params.wasteHeatAccount, amount: energy }] : [],
  });

  unit.machine.setTag('product-temperature-c', targetTempC);

  return { posting, energy, condensateMass, heating };
}

// ---------------------------------------------------------------------------
// Chocolate tempering: a real crystal-form curve, no mass movement.
// ---------------------------------------------------------------------------

/**
 * The real dark-chocolate tempering curve (Beckett, "Industrial Chocolate
 * Manufacture and Use"; standard confectionery-technology reference figures):
 * fully melt at 45-50 C (every one of cocoa butter's polymorphic crystal
 * forms melts out), cool to 27-28 C to nucleate the stable Form V crystal
 * alongside unstable forms, then reheat to 31-32 C to melt out everything
 * but Form V, leaving the stable crystal that gives tempered chocolate its
 * snap and gloss. Milk and white chocolate temper 2-4 C lower at every stage
 * (more milk fat, a lower melting point overall) — the constants below are
 * the dark-chocolate figures and are overridable per call.
 */
export const CHOCOLATE_MELT_TEMP_C = 47;
export const CHOCOLATE_SEED_TEMP_C = 27.5;
export const CHOCOLATE_WORK_TEMP_C = 31.5;

const CHOCOLATE_SPECIFIC_HEAT_J_PER_KG_K = 1_300; // real cocoa-butter-continuous confectionery figure, ~1.3 kJ/(kg K)

export const TEMPERING_KETTLE_DEFINITION: MachineDefinition = {
  type: 'chocolate-tempering-kettle',
  tags: [
    { name: 'melt-temperature-c', unit: 'C', kind: 'setpoint', min: 40, max: 55, initial: CHOCOLATE_MELT_TEMP_C },
    { name: 'seed-temperature-c', unit: 'C', kind: 'setpoint', min: 24, max: 29, initial: CHOCOLATE_SEED_TEMP_C },
    { name: 'work-temperature-c', unit: 'C', kind: 'setpoint', min: 28, max: 34, initial: CHOCOLATE_WORK_TEMP_C },
    { name: 'crystal-form-v-fraction', unit: 'fraction', kind: 'measurement', min: 0, max: 1, initial: 0 },
    { name: 'product-temperature-c', unit: 'C', kind: 'measurement', min: 0, max: 60, initial: 20 },
  ],
  maintenanceIntervalHours: 1_500,
  components: [{ kind: 'bearing', label: 'tempering screw bearing', wearRatePerHour: 0.0003, dutyExponent: 1.1 }],
};

export function createTemperingKettle(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: TEMPERING_KETTLE_DEFINITION });
}

export interface TemperChocolateParams {
  readonly massUg: Micrograms;
  readonly startTempC: number;
  readonly utilityAccount: AccountId;
  readonly wasteHeatAccount: AccountId;
  readonly specificHeatJPerKgK?: number;
  readonly coolingCop?: number;
  readonly process?: string;
}

export interface TemperChocolateResult {
  readonly posting: Posting;
  /** Net heating energy in (melt + reheat), drawn from `utilityAccount`. */
  readonly heatingEnergy: Microjoules;
  /** Cooling energy out (electrical draw for the cooling stage, after COP). */
  readonly coolingEnergy: Microjoules;
  readonly crystalFormVFraction: number;
}

/** How close the seed/reheat pair sits to the ideal nucleation and working
 * bands determines how much of the batch actually ends up as stable Form V —
 * a deliberately simple triangular model of a real, well-documented
 * sensitivity (miss the seed band and too little Form V nucleates to seed
 * the reheat; miss the work band and either too much unstable crystal
 * survives, or the seed crystal itself remelts), not a full nucleation
 * kinetics simulation. */
function crystalFormVFraction(seedTempC: number, workTempC: number): number {
  const seedError = Math.abs(seedTempC - CHOCOLATE_SEED_TEMP_C);
  const workError = Math.abs(workTempC - CHOCOLATE_WORK_TEMP_C);
  const seedFactor = Math.max(0, 1 - seedError / 2.5);
  const workFactor = Math.max(0, 1 - workError / 2.5);
  return Math.max(0, Math.min(1, seedFactor * workFactor));
}

/**
 * Run one full melt-cool-reheat tempering cycle. Moves no mass at all — only
 * energy, in two directions (heating for melt and reheat, cooling for the
 * seed stage) — and reports the resulting Form V crystal fraction, which is
 * also recorded on the machine's own tag.
 */
export function temperChocolate(unit: ProcessUnit, params: TemperChocolateParams): TemperChocolateResult {
  const meltTempC = unit.machine.getTag('melt-temperature-c');
  const seedTempC = unit.machine.getTag('seed-temperature-c');
  const workTempC = unit.machine.getTag('work-temperature-c');
  const specificHeat = params.specificHeatJPerKgK ?? CHOCOLATE_SPECIFIC_HEAT_J_PER_KG_K;
  const cop = params.coolingCop ?? CHILLING_COP;

  const meltEnergy = sensibleHeatEnergy(params.massUg, specificHeat, meltTempC - params.startTempC);
  const reheatEnergy = sensibleHeatEnergy(params.massUg, specificHeat, workTempC - seedTempC);
  const heatingEnergy = meltEnergy + reheatEnergy;

  const coolMagnitude = sensibleHeatEnergy(params.massUg, specificHeat, meltTempC - seedTempC);
  const coolingEnergy = coolMagnitude === 0n ? 0n : (coolMagnitude * 1_000_000n) / BigInt(Math.round(cop * 1_000_000));

  const netEnergy = heatingEnergy + coolingEnergy;

  const posting = unit.buildBatch({
    process: params.process ?? 'chocolate-tempering-kettle:temper',
    inputs: [],
    outputs: [],
    energyInputs: netEnergy > 0n ? [{ account: params.utilityAccount, amount: netEnergy }] : [],
    energyOutputs: netEnergy > 0n ? [{ account: params.wasteHeatAccount, amount: netEnergy }] : [],
  });

  const formV = crystalFormVFraction(seedTempC, workTempC);
  unit.machine.setTag('crystal-form-v-fraction', formV);
  unit.machine.setTag('product-temperature-c', workTempC);

  return { posting, heatingEnergy, coolingEnergy, crystalFormVFraction: formV };
}

// ---------------------------------------------------------------------------
// Enrober: a coating drawn onto a product, excess recirculated rather than
// lost, so only the mass actually retained ever leaves the coating supply.
// ---------------------------------------------------------------------------

export const ENROBER_DEFINITION: MachineDefinition = {
  type: 'enrober',
  tags: [
    { name: 'coating-temperature-c', unit: 'C', kind: 'measurement', min: 0, max: 60, initial: 31 },
  ],
  maintenanceIntervalHours: 1_400,
  components: [{ kind: 'belt', label: 'enrober bed belt', wearRatePerHour: 0.0004, dutyExponent: 1.1 }],
};

export function createEnrober(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: ENROBER_DEFINITION });
}

export interface EnrobeParams {
  readonly productAccount: AccountId;
  readonly productComposition: Composition;
  readonly coatingAccount: AccountId;
  /** Only the coating mass actually retained on the product this batch — the
   * enrober's recirculating curtain returns everything else to
   * `coatingAccount` itself, so it never leaves that account at all and does
   * not need to be named here. */
  readonly retainedCoatingComposition: Composition;
  readonly coatedProductAccount: AccountId;
  readonly process?: string;
}

export interface EnrobeResult {
  readonly posting: Posting;
  readonly coatedComposition: Composition;
  readonly coatedMass: Micrograms;
}

export function enrobe(unit: ProcessUnit, params: EnrobeParams): EnrobeResult {
  const coatedComposition = addComposition(
    addComposition(emptyComposition(), params.productComposition),
    params.retainedCoatingComposition,
  );

  const posting = unit.buildBatch({
    process: params.process ?? 'enrober:coat',
    inputs: [
      { account: params.productAccount, composition: params.productComposition },
      { account: params.coatingAccount, composition: params.retainedCoatingComposition },
    ],
    outputs: [{ account: params.coatedProductAccount, composition: coatedComposition }],
  });

  return { posting, coatedComposition, coatedMass: compositionMass(coatedComposition) };
}

// ---------------------------------------------------------------------------
// Spray, airbrush, glazing, icing depositor, edible-ink printer, sprinkle
// applicator, layering line: a finishing substance applied to a product,
// with whatever is not retained declared to a named account.
// ---------------------------------------------------------------------------

function finishTags(minRetained: number, defaultRetained: number) {
  return [
    {
      name: 'retained-fraction',
      unit: 'fraction',
      kind: 'setpoint' as const,
      min: minRetained,
      max: 1,
      initial: defaultRetained,
    },
  ];
}

export const SPRAY_DEFINITION: MachineDefinition = {
  type: 'spray-applicator',
  // Manual and automated spray systems without full reclaim commonly lose a
  // substantial share of coating as overspray — a real, well-known figure in
  // spray-finishing engineering, distinct from a curtain/waterfall enrober's
  // recirculated excess.
  tags: finishTags(0.4, 0.65),
  maintenanceIntervalHours: 600,
  components: [{ kind: 'seal', label: 'spray nozzle seal', wearRatePerHour: 0.0008, dutyExponent: 1.4 }],
};

export const AIRBRUSH_DEFINITION: MachineDefinition = {
  type: 'airbrush-applicator',
  tags: finishTags(0.35, 0.6),
  maintenanceIntervalHours: 500,
  components: [{ kind: 'seal', label: 'airbrush needle seal', wearRatePerHour: 0.0007, dutyExponent: 1.3 }],
};

export const GLAZING_DEFINITION: MachineDefinition = {
  type: 'glazer',
  tags: finishTags(0.85, 0.95),
  maintenanceIntervalHours: 1_000,
  components: [{ kind: 'belt', label: 'glaze curtain conveyor belt', wearRatePerHour: 0.0004, dutyExponent: 1.1 }],
};

export const ICING_DEPOSITOR_DEFINITION: MachineDefinition = {
  type: 'icing-depositor',
  tags: finishTags(0.96, 0.99),
  maintenanceIntervalHours: 1_200,
  components: [{ kind: 'seal', label: 'depositor nozzle seal', wearRatePerHour: 0.0003, dutyExponent: 1.1 }],
};

export const EDIBLE_INK_PRINTER_DEFINITION: MachineDefinition = {
  type: 'edible-ink-printer',
  tags: finishTags(0.9, 0.97),
  maintenanceIntervalHours: 800,
  components: [{ kind: 'seal', label: 'print head seal', wearRatePerHour: 0.0004, dutyExponent: 1.2 }],
};

export const SPRINKLE_APPLICATOR_DEFINITION: MachineDefinition = {
  type: 'sprinkle-applicator',
  tags: finishTags(0.75, 0.9),
  maintenanceIntervalHours: 700,
  components: [{ kind: 'bearing', label: 'hopper vibrator bearing', wearRatePerHour: 0.0005, dutyExponent: 1.2 }],
};

export const LAYERING_LINE_DEFINITION: MachineDefinition = {
  type: 'layering-line',
  tags: finishTags(0.95, 0.99),
  maintenanceIntervalHours: 1_200,
  components: [{ kind: 'belt', label: 'layering conveyor belt', wearRatePerHour: 0.0003, dutyExponent: 1.1 }],
};

export function createSprayApplicator(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: SPRAY_DEFINITION });
}
export function createAirbrushApplicator(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: AIRBRUSH_DEFINITION });
}
export function createGlazer(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: GLAZING_DEFINITION });
}
export function createIcingDepositor(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: ICING_DEPOSITOR_DEFINITION });
}
export function createEdibleInkPrinter(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: EDIBLE_INK_PRINTER_DEFINITION });
}
export function createSprinkleApplicator(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: SPRINKLE_APPLICATOR_DEFINITION });
}
export function createLayeringLine(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: LAYERING_LINE_DEFINITION });
}

export interface ApplyFinishParams {
  readonly productAccount: AccountId;
  readonly productComposition: Composition;
  readonly finishAccount: AccountId;
  /** The total finish material drawn from supply this batch — some of it
   * will be retained on the product, the rest declared to `lossAccount`. */
  readonly finishComposition: Composition;
  readonly finishedProductAccount: AccountId;
  /** Where the unretained finish material goes — a reclaim tray for
   * sprinkles that miss and can be reworked, a filter or drain for
   * oversprayed coating. Never omitted: nothing is discarded outside the
   * ledger. */
  readonly lossAccount: AccountId;
  readonly process?: string;
}

export interface ApplyFinishResult {
  readonly posting: Posting;
  readonly finishedComposition: Composition;
  readonly retainedMass: Micrograms;
  readonly lossMass: Micrograms;
}

/** Apply a finishing material to a product, in the unit's own
 * `retained-fraction` ratio; the rest is declared, never discarded. */
export function applyFinish(unit: ProcessUnit, params: ApplyFinishParams): ApplyFinishResult {
  const retainedFraction = unit.machine.getTag('retained-fraction');

  const streams = [
    { id: 'retained', elements: UNIFORM_PROFILE, targetShare: retainedFraction },
    { id: 'loss', elements: UNIFORM_PROFILE, targetShare: 1 - retainedFraction },
  ];
  const [retainedComposition, lossComposition] = splitByProfile(params.finishComposition, streams) as [
    Composition,
    Composition,
  ];

  const finishedComposition = addComposition(
    addComposition(emptyComposition(), params.productComposition),
    retainedComposition,
  );

  const posting = unit.buildBatch({
    process: params.process ?? `${unit.machine.definition.type}:apply`,
    inputs: [
      { account: params.productAccount, composition: params.productComposition },
      { account: params.finishAccount, composition: params.finishComposition },
    ],
    outputs: [
      { account: params.finishedProductAccount, composition: finishedComposition },
      { account: params.lossAccount, composition: lossComposition },
    ],
  });

  return {
    posting,
    finishedComposition,
    retainedMass: compositionMass(retainedComposition),
    lossMass: compositionMass(lossComposition),
  };
}
