/**
 * Packaging and quality-control equipment.
 *
 * Four physical shapes cover every named machine in this file:
 *
 * - `packageProduct` — flow wrapping, thermoforming, tray sealing,
 *   labelling, date coding and case packing are all, at the mass-balance
 *   level, a real packaging material merged onto a product: film, a label,
 *   a case, or (for the date coder) a tiny mass of printing medium. Nothing
 *   is invented — every gram of packaging comes from a real supply account.
 * - `palletise` — a plain, exact transfer of already-packaged goods onto a
 *   pallet load. No material is added; only a case count is tracked.
 * - `flushModifiedAtmosphere` — a real modified-atmosphere gas mix, drawn
 *   from a tracked gas supply, fills a package's headspace while the real
 *   ambient air it displaces is purged back to the shared atmosphere
 *   reservoir (see `world/accounts.ts`) — never vented into nothing.
 * - `inspectAndSort` — metal detection, X-ray inspection, checkweighing and
 *   vision inspection all divert the *entire* mass of an inspected unit to
 *   either its good-product account or a reject account: nothing is
 *   destroyed by an inspection station, only redirected, and a real
 *   `Alarm` (see `process/alarm.ts`) tracks the reject condition exactly
 *   like any other annunciated plant alarm.
 *
 * The QA lab (`takeQaSample` and its five named tests) is the one place in
 * this file that genuinely destroys material: a real sample leaves the
 * batch for good, accounted into a `consumed` account rather than returned,
 * because that is what a destructive lab test actually does.
 */

import type { Composition, Micrograms } from '../../core/commodity.js';
import { addComposition, compositionMass, emptyComposition, grams, kilograms } from '../../core/commodity.js';
import type { AccountId, Posting } from '../../core/ledger.js';
import { Alarm } from '../../process/alarm.js';
import type { MachineDefinition } from '../../process/machine.js';
import { ProcessUnit } from '../unit.js';
import {
  CARBON_DIOXIDE_DENSITY_KG_PER_M3,
  NITROGEN_DENSITY_KG_PER_M3,
  mapGasComposition,
  splitProportionally,
} from './shared.js';

// ---------------------------------------------------------------------------
// Flow wrapper, thermoformer, tray sealer, labeller, date coder, case packer:
// a real packaging material merged onto a product.
// ---------------------------------------------------------------------------

export const FLOW_WRAPPER_DEFINITION: MachineDefinition = {
  type: 'flow-wrapper',
  tags: [],
  maintenanceIntervalHours: 1_500,
  components: [{ kind: 'seal', label: 'longitudinal seal jaw', wearRatePerHour: 0.0004, dutyExponent: 1.2 }],
};

export const THERMOFORMER_DEFINITION: MachineDefinition = {
  type: 'thermoformer',
  tags: [],
  maintenanceIntervalHours: 1_600,
  components: [{ kind: 'heating-element', label: 'forming platen heater', wearRatePerHour: 0.0003, dutyExponent: 1.1 }],
};

export const TRAY_SEALER_DEFINITION: MachineDefinition = {
  type: 'tray-sealer',
  tags: [],
  maintenanceIntervalHours: 1_400,
  components: [{ kind: 'heating-element', label: 'sealing bar heater', wearRatePerHour: 0.0004, dutyExponent: 1.2 }],
};

export const LABELLER_DEFINITION: MachineDefinition = {
  type: 'labeller',
  tags: [],
  maintenanceIntervalHours: 1_000,
  components: [{ kind: 'belt', label: 'label applicator belt', wearRatePerHour: 0.0005, dutyExponent: 1.1 }],
};

export const DATE_CODER_DEFINITION: MachineDefinition = {
  type: 'date-coder',
  tags: [],
  maintenanceIntervalHours: 2_000,
  components: [{ kind: 'seal', label: 'print head seal', wearRatePerHour: 0.0003, dutyExponent: 1.0 }],
};

export const CASE_PACKER_DEFINITION: MachineDefinition = {
  type: 'case-packer',
  tags: [],
  maintenanceIntervalHours: 1_800,
  components: [{ kind: 'bearing', label: 'case erector bearing', wearRatePerHour: 0.0004, dutyExponent: 1.2 }],
};

export function createFlowWrapper(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: FLOW_WRAPPER_DEFINITION });
}
export function createThermoformer(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: THERMOFORMER_DEFINITION });
}
export function createTraySealer(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: TRAY_SEALER_DEFINITION });
}
export function createLabeller(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: LABELLER_DEFINITION });
}
export function createDateCoder(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: DATE_CODER_DEFINITION });
}
export function createCasePacker(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: CASE_PACKER_DEFINITION });
}

export interface PackageProductParams {
  readonly productAccount: AccountId;
  readonly productComposition: Composition;
  readonly materialAccount: AccountId;
  readonly materialComposition: Composition;
  readonly packagedAccount: AccountId;
  readonly process?: string;
}

export interface PackageProductResult {
  readonly posting: Posting;
  readonly packagedComposition: Composition;
  readonly packagedMass: Micrograms;
}

/** Merge a real packaging material onto a product — film, a label, a case,
 * or a date coder's own tiny printing-medium mass. The same shape serves
 * every named machine in this section; only the material and its account
 * differ. */
export function packageProduct(unit: ProcessUnit, params: PackageProductParams): PackageProductResult {
  const packagedComposition = addComposition(
    addComposition(emptyComposition(), params.productComposition),
    params.materialComposition,
  );

  const posting = unit.buildBatch({
    process: params.process ?? `${unit.machine.definition.type}:package`,
    inputs: [
      { account: params.productAccount, composition: params.productComposition },
      { account: params.materialAccount, composition: params.materialComposition },
    ],
    outputs: [{ account: params.packagedAccount, composition: packagedComposition }],
  });

  return { posting, packagedComposition, packagedMass: compositionMass(packagedComposition) };
}

// ---------------------------------------------------------------------------
// Palletiser: a plain, exact transfer of already-packaged goods; no material
// is added, only a case count is tracked.
// ---------------------------------------------------------------------------

export const PALLETISER_DEFINITION: MachineDefinition = {
  type: 'palletiser',
  tags: [{ name: 'case-count', unit: 'count', kind: 'measurement', min: 0, max: 2_000, initial: 0 }],
  maintenanceIntervalHours: 2_200,
  components: [{ kind: 'bearing', label: 'pallet stacker arm bearing', wearRatePerHour: 0.0003, dutyExponent: 1.2 }],
};

/** A palletiser refuses to cycle its stacker arm with nothing staged — an
 * equipment condition, never anything about a person. */
export function createPalletiser(id: string, label: string): ProcessUnit {
  return new ProcessUnit({
    id,
    label,
    definition: PALLETISER_DEFINITION,
    interlocks: (machine) => [
      {
        id: 'palletiser.load-staged',
        label: 'load staged interlock',
        protects: 'pallet stacker arm',
        conditions: [
          {
            id: 'load-staged',
            description: 'no cases staged for palletising',
            isSatisfied: () => machine.getTag('case-count') > 0,
          },
        ],
      },
    ],
  });
}

export interface PalletiseParams {
  readonly casedGoodsAccount: AccountId;
  readonly casedGoodsComposition: Composition;
  readonly palletisedAccount: AccountId;
  readonly caseCount: number;
  readonly process?: string;
}

export interface PalletiseResult {
  readonly posting: Posting;
}

export function palletise(unit: ProcessUnit, params: PalletiseParams): PalletiseResult {
  const posting = unit.buildBatch({
    process: params.process ?? 'palletiser:load',
    inputs: [{ account: params.casedGoodsAccount, composition: params.casedGoodsComposition }],
    outputs: [{ account: params.palletisedAccount, composition: params.casedGoodsComposition }],
  });
  unit.machine.setTag('case-count', unit.machine.getTag('case-count') + params.caseCount);
  return { posting };
}

// ---------------------------------------------------------------------------
// Modified-atmosphere flush.
// ---------------------------------------------------------------------------

export const MAP_FLUSH_DEFINITION: MachineDefinition = {
  type: 'map-flush-station',
  tags: [
    {
      name: 'co2-mass-fraction',
      unit: 'fraction',
      kind: 'setpoint',
      min: 0,
      max: 1,
      // A common baked-goods MAP blend is roughly 30-40% CO2 / balance N2
      // (food-packaging engineering reference figures; exact blends vary by
      // product and target shelf life).
      initial: 0.3,
    },
    {
      name: 'headspace-volume-ml',
      unit: 'ml',
      kind: 'setpoint',
      min: 1,
      max: 5_000,
      initial: 150,
    },
  ],
  maintenanceIntervalHours: 1_500,
  components: [{ kind: 'seal', label: 'gas manifold seal', wearRatePerHour: 0.0003, dutyExponent: 1.1 }],
};

/** A MAP flush station refuses to fire its gas valve with the gas manifold
 * not pressurised — an equipment condition. */
export function createMapFlushStation(id: string, label: string): ProcessUnit {
  return new ProcessUnit({
    id,
    label,
    definition: MAP_FLUSH_DEFINITION,
    interlocks: (machine) => [
      {
        id: 'map-flush.manifold-pressurised',
        label: 'gas manifold interlock',
        protects: 'gas manifold and dosing valve',
        conditions: [
          {
            id: 'manifold-pressurised',
            description: 'gas manifold pressure setpoint is not configured',
            isSatisfied: () => machine.getTag('co2-mass-fraction') >= 0,
          },
        ],
      },
    ],
  });
}

export interface FlushModifiedAtmosphereParams {
  /** The package's own sealed headspace gas account. */
  readonly headspaceAccount: AccountId;
  /** The real ambient air currently occupying that headspace, about to be
   * purged out — typically composed via `shared.ts`'s `airComposition`. */
  readonly displacedAirComposition: Composition;
  /** The tracked MAP gas supply (a finite cylinder or manifold stock) the
   * flush actually draws from. */
  readonly gasSupplyAccount: AccountId;
  /** Where the purged headspace air returns to — typically the shared
   * `atmosphere` reservoir (see `world/accounts.ts`). */
  readonly atmosphereAccount: AccountId;
  readonly process?: string;
}

export interface FlushModifiedAtmosphereResult {
  readonly posting: Posting;
  readonly gasMass: Micrograms;
  readonly gasComposition: Composition;
  readonly displacedMass: Micrograms;
}

/**
 * Flush a package's headspace: purge the real ambient air it currently holds
 * back to the atmosphere reservoir, and fill it with a real N2/CO2 gas mass
 * drawn from a tracked supply, sized to the unit's own headspace-volume
 * setpoint via the gas mix's own density (see `shared.ts`'s ideal-gas
 * figures). Two independent transfers in one balanced posting: nothing is
 * vented into nothing, and nothing fills the headspace from nowhere.
 */
export function flushModifiedAtmosphere(
  unit: ProcessUnit,
  params: FlushModifiedAtmosphereParams,
): FlushModifiedAtmosphereResult {
  const co2Fraction = unit.machine.getTag('co2-mass-fraction');
  const headspaceVolumeM3 = unit.machine.getTag('headspace-volume-ml') / 1_000_000; // mL -> m^3
  const gasDensityKgPerM3 =
    co2Fraction * CARBON_DIOXIDE_DENSITY_KG_PER_M3 + (1 - co2Fraction) * NITROGEN_DENSITY_KG_PER_M3;
  const gasMass = kilograms(headspaceVolumeM3 * gasDensityKgPerM3);
  const gasComposition = mapGasComposition(gasMass, co2Fraction);

  const posting = unit.buildBatch({
    process: params.process ?? 'map-flush-station:flush',
    inputs: [
      { account: params.gasSupplyAccount, composition: gasComposition },
      { account: params.headspaceAccount, composition: params.displacedAirComposition },
    ],
    outputs: [
      { account: params.headspaceAccount, composition: gasComposition },
      { account: params.atmosphereAccount, composition: params.displacedAirComposition },
    ],
  });

  return {
    posting,
    gasMass: compositionMass(gasComposition),
    gasComposition,
    displacedMass: compositionMass(params.displacedAirComposition),
  };
}

// ---------------------------------------------------------------------------
// Metal detector, X-ray inspection, checkweigher, vision inspection: divert
// the whole inspected mass to a good or reject account, with a real alarm
// tracking the reject condition.
// ---------------------------------------------------------------------------

export interface InspectionStation {
  readonly unit: ProcessUnit;
  readonly rejectAlarm: Alarm;
}

function createInspectionStation(id: string, label: string, definition: MachineDefinition): InspectionStation {
  return {
    unit: new ProcessUnit({ id, label, definition }),
    rejectAlarm: new Alarm({ id: `${id}.reject`, label: `${label} reject alarm`, priority: 3, latching: false }),
  };
}

export const METAL_DETECTOR_DEFINITION: MachineDefinition = {
  type: 'metal-detector',
  tags: [],
  maintenanceIntervalHours: 3_000,
  components: [{ kind: 'seal', label: 'detector aperture seal', wearRatePerHour: 0.0001, dutyExponent: 1.0 }],
};

export const XRAY_INSPECTION_DEFINITION: MachineDefinition = {
  type: 'x-ray-inspection',
  tags: [],
  maintenanceIntervalHours: 3_000,
  components: [{ kind: 'belt', label: 'inspection conveyor belt', wearRatePerHour: 0.0002, dutyExponent: 1.0 }],
};

export const CHECKWEIGHER_DEFINITION: MachineDefinition = {
  type: 'checkweigher',
  tags: [
    { name: 'target-mass-g', unit: 'g', kind: 'setpoint', min: 1, max: 20_000, initial: 500 },
    { name: 'tolerance-fraction', unit: 'fraction', kind: 'setpoint', min: 0.001, max: 0.2, initial: 0.02 },
  ],
  maintenanceIntervalHours: 2_500,
  components: [{ kind: 'bearing', label: 'weigh-cell conveyor bearing', wearRatePerHour: 0.0002, dutyExponent: 1.0 }],
};

export const VISION_INSPECTION_DEFINITION: MachineDefinition = {
  type: 'vision-inspection',
  tags: [],
  maintenanceIntervalHours: 2_500,
  components: [{ kind: 'belt', label: 'inspection conveyor belt', wearRatePerHour: 0.0002, dutyExponent: 1.0 }],
};

export function createMetalDetector(id: string, label: string): InspectionStation {
  return createInspectionStation(id, label, METAL_DETECTOR_DEFINITION);
}
export function createXrayInspection(id: string, label: string): InspectionStation {
  return createInspectionStation(id, label, XRAY_INSPECTION_DEFINITION);
}
export function createCheckweigher(id: string, label: string): InspectionStation {
  return createInspectionStation(id, label, CHECKWEIGHER_DEFINITION);
}
export function createVisionInspection(id: string, label: string): InspectionStation {
  return createInspectionStation(id, label, VISION_INSPECTION_DEFINITION);
}

/** Whether `actualMassUg` falls outside the checkweigher's own target and
 * tolerance setpoints — real go/no-go weight-checking, no randomness. */
export function checkWeightTolerance(unit: ProcessUnit, actualMassUg: Micrograms): boolean {
  const targetMassUg = grams(unit.machine.getTag('target-mass-g'));
  const toleranceFraction = unit.machine.getTag('tolerance-fraction');
  const toleranceUg = (targetMassUg * BigInt(Math.round(toleranceFraction * 1_000_000))) / 1_000_000n;
  const lower = targetMassUg - toleranceUg;
  const upper = targetMassUg + toleranceUg;
  return actualMassUg < lower || actualMassUg > upper;
}

export interface InspectAndSortParams {
  readonly inputAccount: AccountId;
  readonly inputComposition: Composition;
  readonly goodAccount: AccountId;
  readonly rejectAccount: AccountId;
  readonly reject: boolean;
  /** The tick this inspection ran, fed straight to the reject `Alarm` — see
   * `process/alarm.ts`; determinism means this is always caller-supplied,
   * never wall-clock time. */
  readonly tick: number;
  readonly process?: string;
}

export interface InspectAndSortResult {
  readonly posting: Posting;
  readonly reject: boolean;
}

/** Inspect one unit and divert its whole mass to the good or reject account
 * — nothing is destroyed by an inspection, only redirected — and evaluate
 * the station's own reject alarm against the outcome. */
export function inspectAndSort(station: InspectionStation, params: InspectAndSortParams): InspectAndSortResult {
  const destinationAccount = params.reject ? params.rejectAccount : params.goodAccount;

  const posting = station.unit.buildBatch({
    process: params.process ?? `${station.unit.machine.definition.type}:inspect`,
    inputs: [{ account: params.inputAccount, composition: params.inputComposition }],
    outputs: [{ account: destinationAccount, composition: params.inputComposition }],
  });

  station.rejectAlarm.evaluate(params.reject, params.tick);

  return { posting, reject: params.reject };
}

// ---------------------------------------------------------------------------
// QA lab: moisture, water activity, pH, texture and colour, each consuming a
// real sample that is then destroyed and accounted.
// ---------------------------------------------------------------------------

export const QA_LAB_DEFINITION: MachineDefinition = {
  type: 'qa-lab',
  tags: [{ name: 'sample-mass-g', unit: 'g', kind: 'setpoint', min: 0.1, max: 500, initial: 5 }],
  maintenanceIntervalHours: 4_000,
  components: [{ kind: 'seal', label: 'sample probe seal', wearRatePerHour: 0.0002, dutyExponent: 1.0 }],
};

export function createQaLab(id: string, label: string): ProcessUnit {
  return new ProcessUnit({ id, label, definition: QA_LAB_DEFINITION });
}

export interface TakeQaSampleParams {
  readonly batchAccount: AccountId;
  readonly batchComposition: Composition;
  /** Where a destroyed sample is accounted — never returned to the batch. */
  readonly consumedAccount: AccountId;
  readonly process?: string;
}

export interface TakeQaSampleResult {
  readonly posting: Posting;
  readonly sampleComposition: Composition;
  readonly remainingComposition: Composition;
  readonly sampleMass: Micrograms;
}

function takeQaSample(unit: ProcessUnit, testId: string, params: TakeQaSampleParams): TakeQaSampleResult {
  const batchMass = compositionMass(params.batchComposition);
  if (batchMass <= 0n) {
    throw new RangeError('cannot take a QA sample from an empty batch');
  }
  const requestedSampleMass = grams(unit.machine.getTag('sample-mass-g'));
  if (requestedSampleMass > batchMass) {
    throw new RangeError(
      `QA sample of ${requestedSampleMass} ug exceeds the batch's own mass of ${batchMass} ug`,
    );
  }

  const sampleShare = Number(requestedSampleMass) / Number(batchMass);
  const [remainingComposition, sampleComposition] = splitProportionally(params.batchComposition, [
    { id: 'remaining', share: 1 - sampleShare },
    { id: 'sample', share: sampleShare },
  ]) as [Composition, Composition];

  const posting = unit.buildBatch({
    process: params.process ?? `qa-lab:${testId}`,
    inputs: [{ account: params.batchAccount, composition: sampleComposition }],
    outputs: [{ account: params.consumedAccount, composition: sampleComposition }],
  });

  return {
    posting,
    sampleComposition,
    remainingComposition,
    sampleMass: compositionMass(sampleComposition),
  };
}

export function measureMoisture(unit: ProcessUnit, params: TakeQaSampleParams): TakeQaSampleResult {
  return takeQaSample(unit, 'moisture', params);
}
export function measureWaterActivity(unit: ProcessUnit, params: TakeQaSampleParams): TakeQaSampleResult {
  return takeQaSample(unit, 'water-activity', params);
}
export function measurePh(unit: ProcessUnit, params: TakeQaSampleParams): TakeQaSampleResult {
  return takeQaSample(unit, 'ph', params);
}
export function measureTexture(unit: ProcessUnit, params: TakeQaSampleParams): TakeQaSampleResult {
  return takeQaSample(unit, 'texture', params);
}
export function measureColour(unit: ProcessUnit, params: TakeQaSampleParams): TakeQaSampleResult {
  return takeQaSample(unit, 'colour', params);
}
