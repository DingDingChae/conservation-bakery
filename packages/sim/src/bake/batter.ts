/**
 * The mixing bowl: mechanical energy in, gluten network and incorporated air out.
 *
 * Every joule a mixer spends on a batter has to go somewhere. Almost all of it
 * ends up as heat, dissipated by the batter's own internal friction as gluten
 * strands stretch and air cells shear into being — this is why a long-mixed dough
 * comes out of the bowl measurably warmer than it went in, a real and routinely
 * measured effect in dough and batter processing. This module draws that energy
 * from a real `energy:uJ` account (the mixer motor) and posts it, unchanged in
 * amount, into the batter's own thermal energy account — never invented, and the
 * temperature rise it reports is derived from that same posted amount divided by
 * the batter's own composite specific heat.
 *
 * Gluten development is driven by the flour's own nitrogen content already in the
 * ledger (via the Jones factor, the standard cereal nitrogen-to-protein
 * conversion — see `constants.ts`), not a separately declared "protein %" that
 * could silently drift out of step with the elemental data everything else in
 * this simulation is built on.
 */

import type { Micrograms, Microjoules } from '../core/commodity.js';
import { ENERGY, UG_PER_KG, UJ_PER_J, roundHalfEven } from '../core/commodity.js';
import type { AccountId, Posting } from '../core/ledger.js';
import type { IngredientRole, ResolvedIngredient } from './formulation.js';
import {
  GLUTEN_FORMING_PROTEIN_FRACTION,
  SPECIFIC_HEAT_J_PER_KG_K,
  WHEAT_NITROGEN_TO_PROTEIN_FACTOR,
} from './constants.js';

/**
 * Mechanical energy input at which gluten development peaks, joules per kilogram
 * of total batter mass. Dough- and batter-mixing engineering studies (e.g. Chin &
 * Campbell's specific-work mixing curves) report peak gluten development in the
 * range of roughly 25-40 kJ/kg of dough; 30 kJ/kg is used here as a representative
 * midpoint.
 */
const CHARACTERISTIC_MIXING_ENERGY_J_PER_KG = 30_000;

/** Air incorporates into a fat-sugar-egg emulsion faster than gluten fully
 * develops (creaming is largely complete well before a dough would be fully
 * kneaded) — a smaller characteristic energy than gluten development, but the
 * same real mechanism: mechanical work tearing the continuous phase and folding
 * bubbles into it. */
const AIR_INCORPORATION_ENERGY_J_PER_KG = 12_000;

/** A well-creamed batter can carry roughly 30-40% incorporated air by volume
 * before the continuous phase can no longer support more bubbles (baking-science
 * texts, e.g. creamed cake batter aeration figures). 0.35 is the representative
 * ceiling used here. */
const MAX_AIR_VOLUME_FRACTION = 0.35;

/**
 * Gluten development as a fraction of the flour's gluten-forming protein that has
 * actually formed a continuous network, as a function of specific mechanical
 * energy input.
 *
 * `x * e^(1-x)` peaks at exactly 1.0 when `x = 1` (i.e. at the characteristic
 * energy) and falls off on both sides — under-mixed dough has not developed a
 * network yet; over-mixed dough has had its network mechanically torn back down,
 * a real and well-documented outcome ("breakdown" past peak development on a
 * mixograph or farinograph curve), not merely a plateau.
 */
export function glutenDevelopmentFraction(specificEnergyJPerKg: number): number {
  if (specificEnergyJPerKg <= 0) return 0;
  const x = specificEnergyJPerKg / CHARACTERISTIC_MIXING_ENERGY_J_PER_KG;
  return x * Math.exp(1 - x);
}

/** Incorporated air volume fraction, saturating toward `MAX_AIR_VOLUME_FRACTION`
 * as mechanical energy input grows — unlike gluten, air incorporation does not
 * reverse with continued mixing at bakery timescales (bubbles that do coalesce
 * and escape are a much slower, minority effect than continued incorporation). */
export function airVolumeFraction(specificEnergyJPerKg: number): number {
  if (specificEnergyJPerKg <= 0) return 0;
  return MAX_AIR_VOLUME_FRACTION * (1 - Math.exp(-specificEnergyJPerKg / AIR_INCORPORATION_ENERGY_J_PER_KG));
}

/** Past the characteristic energy, continued mixing is actively breaking the
 * gluten network down rather than building it — the real definition of
 * over-mixing, not an arbitrary flag. */
export function isOverMixed(specificEnergyJPerKg: number): boolean {
  return specificEnergyJPerKg > CHARACTERISTIC_MIXING_ENERGY_J_PER_KG;
}

export interface GlutenPrecursor {
  /** Total protein mass in the flour, from its own nitrogen content via the
   * Jones factor (5.7) — see `constants.ts`. */
  readonly proteinMassUg: Micrograms;
  /** The gluten-forming (gliadin + glutenin) fraction of that protein — the
   * ceiling on how much network mass mixing can ever develop from it. */
  readonly glutenFormingMassUg: Micrograms;
}

/** Derive how much of a flour's mass is gluten-forming protein directly from its
 * elemental nitrogen mass already in the ledger, rather than a separately
 * declared figure. */
export function glutenPrecursorFromNitrogen(flourNitrogenMassUg: Micrograms): GlutenPrecursor {
  const proteinMassUg = roundHalfEven(Number(flourNitrogenMassUg) * WHEAT_NITROGEN_TO_PROTEIN_FACTOR);
  const glutenFormingMassUg = roundHalfEven(Number(proteinMassUg) * GLUTEN_FORMING_PROTEIN_FRACTION);
  return { proteinMassUg, glutenFormingMassUg };
}

/** Representative specific heat per ingredient role, J/(kg K) — see the cited
 * figures in `constants.ts`. Flavourings (extracts, zest) are a small mass
 * fraction and thermally water-like, so they share water's figure. */
const ROLE_SPECIFIC_HEAT: Readonly<Record<IngredientRole, number>> = {
  flour: SPECIFIC_HEAT_J_PER_KG_K.flour,
  sugar: SPECIFIC_HEAT_J_PER_KG_K.sugar,
  egg: SPECIFIC_HEAT_J_PER_KG_K.egg,
  fat: SPECIFIC_HEAT_J_PER_KG_K.fat,
  liquid: SPECIFIC_HEAT_J_PER_KG_K.water,
  leavening: SPECIFIC_HEAT_J_PER_KG_K.leavening,
  salt: SPECIFIC_HEAT_J_PER_KG_K.salt,
  flavour: SPECIFIC_HEAT_J_PER_KG_K.water,
};

/** A batter's composite specific heat: the mass-weighted average of its
 * ingredients' own specific heats. This is ordinary mixture thermodynamics
 * (specific heat of a mixture is the mass-weighted mean of its components'), not
 * a conserved quantity itself — it is only ever used to convert an already-exact
 * posted energy amount into a derived temperature reading. */
export function batterSpecificHeat(resolved: readonly ResolvedIngredient[]): number {
  let totalMassUg = 0n;
  let weighted = 0;
  for (const { ingredient, massUg } of resolved) {
    const massKg = Number(massUg) / Number(UG_PER_KG);
    totalMassUg += massUg;
    weighted += massKg * ROLE_SPECIFIC_HEAT[ingredient.role];
  }
  if (totalMassUg <= 0n) return SPECIFIC_HEAT_J_PER_KG_K.water;
  return weighted / (Number(totalMassUg) / Number(UG_PER_KG));
}

export function totalMass(resolved: readonly ResolvedIngredient[]): Micrograms {
  let total = 0n;
  for (const { massUg } of resolved) total += massUg;
  return total;
}

export interface MixBatterParams {
  /** The mixer motor's real energy account — the source this module draws
   * mechanical work from. Never invented: insufficient energy here is a real
   * refusal (`NegativeStockError`), not a modelling gap. */
  readonly mechanicalEnergyAccount: AccountId;
  /** The batter's own accumulated thermal energy account. */
  readonly thermalAccount: AccountId;
  /** Exact mechanical energy to draw and dissipate as heat this mixing step. */
  readonly mechanicalEnergy: Microjoules;
  readonly totalBatterMassUg: Micrograms;
  readonly specificHeatJPerKgK: number;
  readonly glutenFormingMassUg: Micrograms;
  readonly process?: string;
}

export interface MixBatterResult {
  /** A single balanced transfer: the mixer's energy account debited, the
   * batter's thermal account credited, by the same exact amount. */
  readonly posting: Posting;
  readonly specificEnergyJPerKg: number;
  readonly developmentFraction: number;
  readonly glutenNetworkMassUg: Micrograms;
  readonly airVolumeFraction: number;
  readonly overMixed: boolean;
  /** Derived, not stored: the implied temperature rise from the energy actually
   * posted this step, given the batter's composite specific heat. */
  readonly temperatureRiseK: number;
}

/**
 * One mixing step: post the mixer's mechanical work into the batter's thermal
 * account, and report the physical state that amount of specific energy implies.
 */
export function mixBatter(params: MixBatterParams): MixBatterResult {
  const massKg = Number(params.totalBatterMassUg) / Number(UG_PER_KG);
  if (massKg <= 0) {
    throw new RangeError('cannot mix a batter with zero or negative total mass');
  }
  if (params.specificHeatJPerKgK <= 0) {
    throw new RangeError(`specific heat must be positive, got ${params.specificHeatJPerKgK}`);
  }

  const energyJ = Number(params.mechanicalEnergy) / Number(UJ_PER_J);
  const specificEnergyJPerKg = energyJ / massKg;

  const developmentFraction = glutenDevelopmentFraction(specificEnergyJPerKg);
  const glutenNetworkMassUg = roundHalfEven(Number(params.glutenFormingMassUg) * developmentFraction);
  const air = airVolumeFraction(specificEnergyJPerKg);
  const overMixed = isOverMixed(specificEnergyJPerKg);
  const temperatureRiseK = energyJ / (massKg * params.specificHeatJPerKgK);

  const posting: Posting = {
    process: params.process ?? 'batter:mix',
    entries: [
      { account: params.mechanicalEnergyAccount, commodity: ENERGY, delta: -params.mechanicalEnergy },
      { account: params.thermalAccount, commodity: ENERGY, delta: params.mechanicalEnergy },
    ],
  };

  return {
    posting,
    specificEnergyJPerKg,
    developmentFraction,
    glutenNetworkMassUg,
    airVolumeFraction: air,
    overMixed,
    temperatureRiseK,
  };
}
