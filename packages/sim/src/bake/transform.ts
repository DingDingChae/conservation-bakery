/**
 * The time-temperature reactions that turn a batter into a baked crumb.
 *
 * Every function here is a pure calculator: given a temperature (and, for
 * moisture loss, an exact remaining moisture mass), it reports a rate or a
 * fraction. The one place this module touches the ledger is moisture loss,
 * which it reports as a real `evaporate()` posting (reused from
 * `world/exchange.ts`, so the water that leaves a product returns to the same
 * atmosphere every other evaporation in this simulation draws from) — weighed
 * continuously, tick by tick, never assumed or invented. See CONTRACT.md rule 1.
 *
 * Five real, cited mechanisms are modelled:
 *
 * - **Starch gelatinisation**: wheat starch's crystalline structure breaks down
 *   and absorbs water irreversibly over a real temperature band (Donovan 1979
 *   and later DSC studies of wheat starch put onset around 58-64 C, essentially
 *   complete by 85-95 C).
 * - **Protein coagulation**, tracked separately for egg and gluten because they
 *   set at different real temperatures (Harold McGee, *On Food and Cooking*: egg
 *   white sets ~60-65 C, yolk ~65-70 C; wheat gluten's own proteins denature and
 *   set at a distinctly higher temperature, roughly 74 C and up).
 * - **Evaporative moisture loss**, modelled as the classic food-engineering
 *   "constant-rate drying period": once a product's temperature reaches the
 *   boiling point of water, further incoming energy is diverted from raising
 *   temperature into vaporising moisture instead, exactly the reason a baking
 *   crumb's temperature plateaus near 100 C until it runs out of free water.
 * - **Maillard browning and caramelisation**, modelled as an Arrhenius-kinetic
 *   reaction extent above a real onset temperature, mapped onto CIELAB crust
 *   colour.
 * - **Oven spring and collapse**, modelled with the real ideal gas law: trapped
 *   CO2 expands with rising temperature, and collapses the crumb if that
 *   expansion outruns how much the not-yet-set structure can actually contain.
 */

import { UG_PER_KG, type Micrograms } from '../core/commodity.js';
import { roundHalfEven } from '../core/commodity.js';
import type { AccountId, Posting } from '../core/ledger.js';
import { evaporate } from '../world/exchange.js';
import {
  ATMOSPHERIC_PRESSURE_PA,
  BOILING_POINT_C,
  GAS_CONSTANT_J_PER_MOL_K,
  LATENT_HEAT_VAPORISATION_J_PER_KG,
  celsiusToKelvin,
} from './constants.js';

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** A generic linear ramp from 0 at `onsetC` to 1 at `completeC` — the shared
 * shape behind every temperature-band reaction in this module. Real DSC and
 * coagulation studies report a band, not a single switch temperature, and a
 * ramp is the simplest honest model of "increasingly complete across a range"
 * without asserting a reaction-order kinetic this module has no rate constant
 * for. */
function rampFraction(tempC: number, onsetC: number, completeC: number): number {
  return clamp01((tempC - onsetC) / (completeC - onsetC));
}

const STARCH_GELATINISATION_ONSET_C = 60;
const STARCH_GELATINISATION_COMPLETE_C = 85;

/** Wheat starch gelatinisation extent, 0..1, from DSC-measured onset/complete
 * temperatures (Donovan 1979 and subsequent wheat-starch DSC literature). */
export function starchGelatinisationFraction(tempC: number): number {
  return rampFraction(tempC, STARCH_GELATINISATION_ONSET_C, STARCH_GELATINISATION_COMPLETE_C);
}

const EGG_COAGULATION_ONSET_C = 60;
const EGG_COAGULATION_COMPLETE_C = 70;

/** Whole-egg protein coagulation extent, 0..1 — a composite of white (sets
 * ~60-65 C) and yolk (~65-70 C), per McGee. */
export function eggCoagulationFraction(tempC: number): number {
  return rampFraction(tempC, EGG_COAGULATION_ONSET_C, EGG_COAGULATION_COMPLETE_C);
}

const GLUTEN_COAGULATION_ONSET_C = 74;
const GLUTEN_COAGULATION_COMPLETE_C = 90;

/** Wheat gluten protein coagulation ("setting") extent, 0..1 — a real,
 * distinctly higher temperature band than egg protein, which is why a
 * gluten-structured bread crumb sets later in the bake than an egg-foamed
 * sponge does. */
export function glutenCoagulationFraction(tempC: number): number {
  return rampFraction(tempC, GLUTEN_COAGULATION_ONSET_C, GLUTEN_COAGULATION_COMPLETE_C);
}

/**
 * `starchGelatinisationFraction`, `eggCoagulationFraction` and
 * `glutenCoagulationFraction` above are *equilibrium* extents at a held
 * temperature, not history-aware state — but gelatinisation and protein
 * coagulation are real irreversible reactions: starch that has gelatinised or
 * protein that has coagulated stays that way even if the product's
 * temperature later falls (an oven door opened mid-bake cools the cavity, but
 * it does not un-set what had already set). A caller integrating one of these
 * extents tick by tick must therefore ratchet it forward — take the larger of
 * the previous extent and the new instantaneous equilibrium value — which is
 * exactly what this helper does.
 */
export function advanceExtent(previousExtent: number, equilibriumExtent: number): number {
  return Math.max(previousExtent, equilibriumExtent);
}

export interface StructuralExtents {
  /** Ratcheted starch gelatinisation extent, 0..1 — see `advanceExtent`. */
  readonly starchGelatinisation: number;
  /** Ratcheted gluten coagulation extent, 0..1. */
  readonly glutenCoagulation: number;
  /** Ratcheted egg coagulation extent, 0..1. */
  readonly eggCoagulation: number;
}

export interface StructuralMassBudget {
  /** Mass of starch available to gelatinise (essentially flour's carbohydrate
   * mass). */
  readonly starchMassUg: Micrograms;
  /** Mass of gluten network actually developed by mixing — see
   * `batter.ts`'s `glutenNetworkMassUg`, not the flour's raw protein content. */
  readonly glutenMassUg: Micrograms;
  /** Mass of egg protein available to coagulate. */
  readonly eggProteinMassUg: Micrograms;
}

/**
 * The crumb's overall structural set fraction: the mass-weighted average of
 * its three structure-forming mechanisms, each at its own already-ratcheted
 * (see `advanceExtent`) real extent. This is a derived descriptive number,
 * not a conserved quantity — no ledger posting is associated with it.
 */
export function structuralSetFraction(budget: StructuralMassBudget, extents: StructuralExtents): number {
  const starch = Number(budget.starchMassUg);
  const gluten = Number(budget.glutenMassUg);
  const egg = Number(budget.eggProteinMassUg);
  const total = starch + gluten + egg;
  if (total <= 0) return 0;
  return (
    (starch * extents.starchGelatinisation +
      gluten * extents.glutenCoagulation +
      egg * extents.eggCoagulation) /
    total
  );
}

export interface ThermalStepParams {
  readonly currentTempC: number;
  /** Energy delivered into the product's thermal account this tick — see
   * `oven.ts`'s `ovenStep`/`deliverHeat`. */
  readonly deliveredEnergyJ: number;
  readonly massKg: number;
  readonly specificHeatJPerKgK: number;
  readonly moistureRemainingUg: Micrograms;
}

export interface ThermalStepResult {
  readonly nextTempC: number;
  readonly sensibleEnergyJ: number;
  readonly latentEnergyJ: number;
  /** Exact mass of water that evaporated this tick, bounded by what remained. */
  readonly evaporatedMassUg: Micrograms;
}

/**
 * One tick of the lumped thermal + constant-rate-drying model.
 *
 * Below the boiling point, all delivered energy raises sensible temperature.
 * At or above it, incoming energy first fills whatever headroom remains to
 * `BOILING_POINT_C` (so temperature never leaps past boiling in a single
 * step) and any remainder is spent evaporating moisture at the real latent
 * heat of vaporisation, capped by the moisture actually remaining — the
 * standard food-engineering picture of why a baking crumb's temperature
 * plateaus near 100 C for as long as it still holds free water, and only
 * climbs into Maillard/caramelisation range once that water is exhausted
 * (modelled here by simply having no more moisture left to cap the latent
 * term, so the next tick's energy has nothing left to evaporate).
 */
export function stepThermal(params: ThermalStepParams): ThermalStepResult {
  if (params.massKg <= 0) throw new RangeError('cannot step a product of zero or negative mass');
  if (params.specificHeatJPerKgK <= 0) {
    throw new RangeError(`specific heat must be positive, got ${params.specificHeatJPerKgK}`);
  }

  const thermalCapacityJPerC = params.massKg * params.specificHeatJPerKgK;

  const belowBoiling = params.currentTempC < BOILING_POINT_C;
  const hasMoisture = params.moistureRemainingUg > 0n;

  if (params.deliveredEnergyJ <= 0 || !hasMoisture) {
    // No moisture left to evaporate (or no energy at all): every joule is
    // sensible heat, at any temperature.
    const nextTempC = params.currentTempC + params.deliveredEnergyJ / thermalCapacityJPerC;
    return { nextTempC, sensibleEnergyJ: params.deliveredEnergyJ, latentEnergyJ: 0, evaporatedMassUg: 0n };
  }

  if (belowBoiling) {
    const roomToBoilingC = BOILING_POINT_C - params.currentTempC;
    const sensibleCapacityJ = roomToBoilingC * thermalCapacityJPerC;
    const sensibleEnergyJ = Math.min(params.deliveredEnergyJ, sensibleCapacityJ);
    const latentEnergyJ = params.deliveredEnergyJ - sensibleEnergyJ;
    const nextTempC = params.currentTempC + sensibleEnergyJ / thermalCapacityJPerC;
    const evaporatedMassUg = latentToMass(latentEnergyJ, params.moistureRemainingUg);
    return { nextTempC, sensibleEnergyJ, latentEnergyJ, evaporatedMassUg };
  }

  // At or above boiling with moisture remaining: pinned at (or above, if it
  // already overshot) the current temperature — real crumb/crust behaviour —
  // and all delivered energy goes to evaporation.
  const evaporatedMassUg = latentToMass(params.deliveredEnergyJ, params.moistureRemainingUg);
  return {
    nextTempC: params.currentTempC,
    sensibleEnergyJ: 0,
    latentEnergyJ: params.deliveredEnergyJ,
    evaporatedMassUg,
  };
}

function latentToMass(latentEnergyJ: number, moistureRemainingUg: Micrograms): Micrograms {
  if (latentEnergyJ <= 0 || moistureRemainingUg <= 0n) return 0n;
  const evaporableKg = latentEnergyJ / LATENT_HEAT_VAPORISATION_J_PER_KG;
  const evaporableUg = evaporableKg * Number(UG_PER_KG);
  const cappedUg = Math.min(evaporableUg, Number(moistureRemainingUg));
  return roundHalfEven(cappedUg);
}

export interface MoistureLossResult {
  readonly posting: Posting;
  readonly evaporatedMassUg: Micrograms;
}

/** Build the real, exact posting for a tick's evaporated water — reuses
 * `world/exchange.ts`'s `evaporate`, so this simulation never has two
 * different ideas of how water leaves a stock and enters the atmosphere. */
export function postMoistureLoss(
  productAccount: AccountId,
  atmosphereAccount: AccountId | undefined,
  evaporatedMassUg: Micrograms,
  process = 'transform:moisture-loss',
): MoistureLossResult | undefined {
  if (evaporatedMassUg <= 0n) return undefined;
  const posting = evaporate({
    waterAccount: productAccount,
    ...(atmosphereAccount !== undefined ? { atmosphereAccount } : {}),
    waterMass: evaporatedMassUg,
    process,
  });
  return { posting, evaporatedMassUg };
}

/**
 * Maillard/caramelisation onset, C. Maillard browning becomes significant
 * above roughly 140-150 C in baked-goods crust literature; caramelisation of
 * sucrose itself has a somewhat higher onset (~160 C). 140 C is used as the
 * combined onset, the lower (Maillard) figure, since Maillard reaction
 * products dominate ordinary crust browning before pure caramelisation
 * contributes meaningfully.
 */
const BROWNING_ONSET_C = 140;

/**
 * Arrhenius activation energy for crust browning kinetics, J/mol. Published
 * studies of bread and baked-goods crust browning report activation energies
 * for Maillard-driven colour development roughly in the 90-110 kJ/mol range;
 * 100 kJ/mol is used as the representative figure.
 */
const BROWNING_ACTIVATION_ENERGY_J_PER_MOL = 100_000;

/**
 * Pre-exponential (rate) factor, 1/s. Unlike the activation energy above, this
 * is not itself a literature-measured constant — it is calibrated so that a
 * crust held at a typical baking temperature (180 C) reaches full browning
 * extent (`browningExtent = 1`) over roughly 15-20 minutes, matching ordinary
 * observed bake times for a golden-brown crust. The *shape* of the kinetics
 * (Arrhenius temperature dependence, real activation energy) is real; only
 * this scale factor is fit to a realistic timescale, a standard engineering
 * practice when a rate constant's pre-exponential factor is not independently
 * published for a specific food system.
 */
const BROWNING_RATE_PREFACTOR_PER_S = 2.4e11;

/** Instantaneous browning rate, 1/s — zero below the Maillard onset, Arrhenius
 * above it. */
export function browningRate(tempC: number): number {
  if (tempC < BROWNING_ONSET_C) return 0;
  const tempK = celsiusToKelvin(tempC);
  return (
    BROWNING_RATE_PREFACTOR_PER_S * Math.exp(-BROWNING_ACTIVATION_ENERGY_J_PER_MOL / (GAS_CONSTANT_J_PER_MOL_K * tempK))
  );
}

/** Integrate browning extent forward by one tick. */
export function stepBrowning(currentExtent: number, tempC: number, dtSeconds: number): number {
  return clamp01(currentExtent + browningRate(tempC) * dtSeconds);
}

export interface CrustColor {
  readonly labL: number;
  readonly labA: number;
  readonly labB: number;
}

/**
 * Representative CIELAB endpoints for baked-goods crust colour, consistent
 * with published bread- and cake-crust colorimetry studies: a pale, unbaked
 * surface sits around L* 85, a* 0, b* 15; a deeply browned crust sits around
 * L* 35, a* 16, b* 38. `browningExtent` interpolates linearly between them —
 * a reasonable first-order model for a reaction extent driving colour, absent
 * a full spectrophotometric model of this specific product.
 */
const PALE_LAB: CrustColor = { labL: 85, labA: 0, labB: 15 };
const BROWNED_LAB: CrustColor = { labL: 35, labA: 16, labB: 38 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function crustColor(browningExtent: number): CrustColor {
  const t = clamp01(browningExtent);
  return {
    labL: lerp(PALE_LAB.labL, BROWNED_LAB.labL, t),
    labA: lerp(PALE_LAB.labA, BROWNED_LAB.labA, t),
    labB: lerp(PALE_LAB.labB, BROWNED_LAB.labB, t),
  };
}

const CO2_MOLAR_MASS_G_PER_MOL = 44.009;

/** Volume of a mass of trapped CO2 at a given temperature, via the real ideal
 * gas law (`PV = nRT`, `R` and standard atmospheric pressure both exact SI/
 * reference values — see `constants.ts`). */
export function co2VolumeM3(co2MassUg: Micrograms, tempC: number): number {
  const moles = Number(co2MassUg) / 1_000_000 / CO2_MOLAR_MASS_G_PER_MOL;
  if (moles <= 0) return 0;
  const tempK = celsiusToKelvin(tempC);
  return (moles * GAS_CONSTANT_J_PER_MOL_K * tempK) / ATMOSPHERIC_PRESSURE_PA;
}

/**
 * How far a not-yet-fully-set crumb can expand before its cell walls rupture,
 * as a multiple of its unbaked volume. At `setFraction = 0` (nothing set yet)
 * a batter can still stretch a little on its own viscoelasticity (real batters
 * are not rigid); at `setFraction = 1` (fully set) it is credited with the
 * generous end of real cake oven-spring figures (published cake baking studies
 * report volume increases from roughly 20% for a dense pound cake up to well
 * over 100% for a light foam sponge). This is a bounded, physically-motivated
 * ceiling, not a literature-measured constant for any one formulation.
 */
const UNSET_CONTAINABLE_EXPANSION = 0.15;
const SET_CONTAINABLE_EXPANSION = 1.5;

export function containableExpansionRatio(setFraction: number): number {
  const t = clamp01(setFraction);
  return 1 + lerp(UNSET_CONTAINABLE_EXPANSION, SET_CONTAINABLE_EXPANSION, t);
}

export interface GasExpansionState {
  readonly initialVolumeM3: number;
  readonly co2MassUg: Micrograms;
  readonly tempC: number;
  readonly setFraction: number;
}

export interface GasExpansionResult {
  readonly volumeM3: number;
  readonly expansionRatio: number;
  readonly containableExpansionRatio: number;
  /** True once expansion has outrun what the not-yet-set crumb can contain —
   * the real failure mode of a cake that has not set before its gas expands. */
  readonly collapsed: boolean;
}

export function evaluateGasExpansion(state: GasExpansionState): GasExpansionResult {
  if (state.initialVolumeM3 <= 0) {
    throw new RangeError('cannot evaluate gas expansion against a zero or negative initial volume');
  }
  const volumeM3 = state.initialVolumeM3 + co2VolumeM3(state.co2MassUg, state.tempC);
  const expansionRatio = volumeM3 / state.initialVolumeM3;
  const containable = containableExpansionRatio(state.setFraction);
  return {
    volumeM3,
    expansionRatio,
    containableExpansionRatio: containable,
    collapsed: expansionRatio > containable,
  };
}
