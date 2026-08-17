/**
 * Balanced processes that move material between the planetary reservoirs opened by
 * `accounts.ts` and the accounts that belong to equipment, stock and biology
 * elsewhere in the simulation.
 *
 * Every function here only *builds* a `Posting` — it never touches a `Ledger`
 * directly. That keeps the physics testable in isolation from the accounts it will
 * eventually be posted against, and keeps this module honest: there is no way for
 * it to slip material into the world outside a balanced entry set.
 *
 * The chemistry is real, balanced by real molar masses, and every reaction below
 * conserves each element exactly: whatever mass of carbon, hydrogen or oxygen goes
 * in as a reactant comes out, unchanged in amount, as part of a product. The only
 * float arithmetic is the stoichiometric *ratio* between reactants and products;
 * the result is rounded exactly once, per RULE 1, and the matching entry is its
 * negation, so rounding is shared between the two sides rather than leaked.
 */

import type { Element, Micrograms, Microjoules } from '../core/commodity.js';
import { ENERGY, elementCommodity, roundHalfEven } from '../core/commodity.js';
import type { AccountId, Entry, Posting } from '../core/ledger.js';
import { MOLAR_MASS, WORLD_ACCOUNTS, splitMolecule } from './accounts.js';

const CH4_FORMULA = [
  { element: 'C', atoms: 1 },
  { element: 'H', atoms: 4 },
] as const;

const GLUCOSE_FORMULA = [
  { element: 'C', atoms: 6 },
  { element: 'H', atoms: 12 },
  { element: 'O', atoms: 6 },
] as const;

const H2O_FORMULA = [
  { element: 'H', atoms: 2 },
  { element: 'O', atoms: 1 },
] as const;

const CH4_MOLAR_MASS = MOLAR_MASS.C + 4 * MOLAR_MASS.H;
const GLUCOSE_MOLAR_MASS = 6 * MOLAR_MASS.C + 12 * MOLAR_MASS.H + 6 * MOLAR_MASS.O;

/**
 * Standard enthalpy of combustion, methane, gaseous water product (lower heating
 * value): ~802.3 kJ/mol.
 */
const METHANE_COMBUSTION_J_PER_MOL = 802_300;

/** Standard enthalpy of combustion, glucose: ~2,803 kJ/mol. Respiration releases
 * this; photosynthesis, being the reverse reaction, absorbs the same magnitude. */
const GLUCOSE_COMBUSTION_J_PER_MOL = 2_803_000;

function entry(account: AccountId, commodity: `el:${Element}` | 'energy:uJ', delta: bigint): Entry {
  return { account, commodity, delta };
}

/**
 * Energy released or absorbed per unit mass reacted, in exact microjoules per
 * microgram. `enthalpy` is J/mol, `molarMass` is g/mol; a joule per gram is
 * numerically identical to a microjoule per microgram (both scale factors are
 * 1,000,000), so no unit-conversion constant is needed here — only the one
 * rounding this function performs.
 */
function reactionEnergy(mass: Micrograms, enthalpyJPerMol: number, molarMass: number): Microjoules {
  return roundHalfEven(Number(mass) * (enthalpyJPerMol / molarMass));
}

/**
 * The elemental oxygen mass required to fully oxidise `massC` micrograms of carbon
 * to CO2 and `massH` micrograms of hydrogen to H2O — i.e. the total oxygen mass
 * present across both products, from real stoichiometry. Computed once as a single
 * real number and rounded once, so the two contributions cannot round separately
 * and drift apart.
 */
function productOxygenMass(massC: Micrograms, massH: Micrograms): Micrograms {
  const forCarbonDioxide = Number(massC) * ((2 * MOLAR_MASS.O) / MOLAR_MASS.C);
  const forWater = Number(massH) * (MOLAR_MASS.O / (2 * MOLAR_MASS.H));
  return roundHalfEven(forCarbonDioxide + forWater);
}

export interface CombustionParams {
  /** The account holding the methane's stored element mass and its chemical
   * potential energy — a fuel tank, not the market. */
  readonly fuelAccount: AccountId;
  readonly atmosphereAccount?: AccountId;
  /** Where the released heat is credited — the equipment doing the burning. */
  readonly energyAccount: AccountId;
  readonly methaneMass: Micrograms;
  readonly process?: string;
}

/**
 * CH4 + 2 O2 -> CO2 + 2 H2O.
 *
 * The fuel's carbon and hydrogen move, unchanged in mass, from `fuelAccount` into
 * `atmosphereAccount` (they are still there, just recombined as CO2 and H2O — a
 * flue vents into the same sky it drew its oxygen from). The oxygen drawn to
 * oxidise them is credited straight back for the same reason: this account tracks
 * elemental mass, not the molecule it happens to be part of. The energy released
 * is drawn from the fuel's own stored chemical potential, never conjured.
 */
export function combustMethane(params: CombustionParams): Posting {
  const atmosphere = params.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere;
  const byElement = splitMolecule(params.methaneMass, CH4_FORMULA);
  const massC = byElement.get('C') ?? 0n;
  const massH = byElement.get('H') ?? 0n;
  const massO = productOxygenMass(massC, massH);
  const energyReleased = reactionEnergy(params.methaneMass, METHANE_COMBUSTION_J_PER_MOL, CH4_MOLAR_MASS);

  return {
    process: params.process ?? 'combustion:methane',
    entries: [
      entry(params.fuelAccount, elementCommodity('C'), -massC),
      entry(params.fuelAccount, elementCommodity('H'), -massH),
      entry(atmosphere, elementCommodity('O'), -massO), // O2 drawn to oxidise the fuel
      entry(atmosphere, elementCommodity('C'), massC), // returns as CO2's carbon
      entry(atmosphere, elementCommodity('H'), massH), // returns as H2O's hydrogen
      entry(atmosphere, elementCommodity('O'), massO), // returns as CO2 + H2O's oxygen
      entry(params.fuelAccount, ENERGY, -energyReleased),
      entry(params.energyAccount, ENERGY, energyReleased),
    ],
  };
}

export interface RespirationParams {
  /** The account holding the glucose being metabolised and its stored energy —
   * a plant's or a culture's biomass, not the market. */
  readonly biomassAccount: AccountId;
  readonly atmosphereAccount?: AccountId;
  /** Where the released metabolic heat is credited. */
  readonly heatAccount: AccountId;
  readonly glucoseMass: Micrograms;
  readonly process?: string;
}

/**
 * C6H12O6 + 6 O2 -> 6 CO2 + 6 H2O.
 *
 * Only the oxygen actually drawn fresh from the air (the amount the glucose's own
 * oxygen does not already supply) debits `atmosphereAccount`; the rest of the
 * product oxygen is the glucose's own, simply repositioned into CO2 and H2O.
 */
export function respire(params: RespirationParams): Posting {
  const atmosphere = params.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere;
  const byElement = splitMolecule(params.glucoseMass, GLUCOSE_FORMULA);
  const massC = byElement.get('C') ?? 0n;
  const massH = byElement.get('H') ?? 0n;
  const massOInGlucose = byElement.get('O') ?? 0n;
  const totalProductOxygen = productOxygenMass(massC, massH);
  const massO2Drawn = totalProductOxygen - massOInGlucose;
  const energyReleased = reactionEnergy(params.glucoseMass, GLUCOSE_COMBUSTION_J_PER_MOL, GLUCOSE_MOLAR_MASS);

  return {
    process: params.process ?? 'respiration:glucose',
    entries: [
      entry(params.biomassAccount, elementCommodity('C'), -massC),
      entry(params.biomassAccount, elementCommodity('H'), -massH),
      entry(params.biomassAccount, elementCommodity('O'), -massOInGlucose),
      entry(atmosphere, elementCommodity('O'), -massO2Drawn), // O2 drawn to finish the oxidation
      entry(atmosphere, elementCommodity('C'), massC),
      entry(atmosphere, elementCommodity('H'), massH),
      entry(atmosphere, elementCommodity('O'), massOInGlucose + massO2Drawn),
      entry(params.biomassAccount, ENERGY, -energyReleased),
      entry(params.heatAccount, ENERGY, energyReleased),
    ],
  };
}

export interface PhotosynthesisParams {
  /** Where the synthesised glucose and its stored energy are deposited. */
  readonly biomassAccount: AccountId;
  readonly atmosphereAccount?: AccountId;
  readonly sunAccount?: AccountId;
  readonly glucoseMass: Micrograms;
  readonly process?: string;
}

/**
 * 6 CO2 + 6 H2O + light -> C6H12O6 + 6 O2. The exact reverse of `respire`, drawing
 * its energy from the finite `sun` account instead of releasing it.
 */
export function photosynthesize(params: PhotosynthesisParams): Posting {
  const atmosphere = params.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere;
  const sun = params.sunAccount ?? WORLD_ACCOUNTS.sun;
  const byElement = splitMolecule(params.glucoseMass, GLUCOSE_FORMULA);
  const massC = byElement.get('C') ?? 0n;
  const massH = byElement.get('H') ?? 0n;
  const massOInGlucose = byElement.get('O') ?? 0n;
  const totalReactantOxygen = productOxygenMass(massC, massH);
  const massO2Released = totalReactantOxygen - massOInGlucose;
  const energyAbsorbed = reactionEnergy(params.glucoseMass, GLUCOSE_COMBUSTION_J_PER_MOL, GLUCOSE_MOLAR_MASS);

  return {
    process: params.process ?? 'photosynthesis:glucose',
    entries: [
      entry(atmosphere, elementCommodity('C'), -massC), // drawn as CO2
      entry(atmosphere, elementCommodity('H'), -massH), // drawn as H2O
      entry(atmosphere, elementCommodity('O'), -(massOInGlucose + massO2Released)), // CO2 + H2O oxygen drawn
      entry(atmosphere, elementCommodity('O'), massO2Released), // O2 released as by-product
      entry(params.biomassAccount, elementCommodity('C'), massC),
      entry(params.biomassAccount, elementCommodity('H'), massH),
      entry(params.biomassAccount, elementCommodity('O'), massOInGlucose),
      entry(sun, ENERGY, -energyAbsorbed),
      entry(params.biomassAccount, ENERGY, energyAbsorbed),
    ],
  };
}

export interface WaterTransferParams {
  /** `groundwater`, `surface-water`, or a `soil.<field>` account. */
  readonly waterAccount: AccountId;
  readonly atmosphereAccount?: AccountId;
  readonly waterMass: Micrograms;
  readonly process?: string;
}

/** Liquid water leaves a water body and joins the atmosphere as vapour, element
 * mass unchanged, split into H and O in exact H2O molar-mass ratio. */
export function evaporate(params: WaterTransferParams): Posting {
  const atmosphere = params.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere;
  const byElement = splitMolecule(params.waterMass, H2O_FORMULA);
  const massH = byElement.get('H') ?? 0n;
  const massO = byElement.get('O') ?? 0n;

  return {
    process: params.process ?? 'evaporation:water',
    entries: [
      entry(params.waterAccount, elementCommodity('H'), -massH),
      entry(params.waterAccount, elementCommodity('O'), -massO),
      entry(atmosphere, elementCommodity('H'), massH),
      entry(atmosphere, elementCommodity('O'), massO),
    ],
  };
}

/** Water vapour leaves the atmosphere and joins a water body as liquid — the
 * reverse of `evaporate`. */
export function condense(params: WaterTransferParams): Posting {
  const atmosphere = params.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere;
  const byElement = splitMolecule(params.waterMass, H2O_FORMULA);
  const massH = byElement.get('H') ?? 0n;
  const massO = byElement.get('O') ?? 0n;

  return {
    process: params.process ?? 'condensation:water',
    entries: [
      entry(atmosphere, elementCommodity('H'), -massH),
      entry(atmosphere, elementCommodity('O'), -massO),
      entry(params.waterAccount, elementCommodity('H'), massH),
      entry(params.waterAccount, elementCommodity('O'), massO),
    ],
  };
}
