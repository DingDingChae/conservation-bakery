/**
 * A data-driven crop model: winter wheat and sugar beet, at minimum.
 *
 * Growth is driven by intercepted solar energy, soil nitrogen/phosphorus/potassium,
 * soil moisture, and atmospheric CO2 -- and every one of those is debited from its
 * real account by a balanced `Posting` as the crop grows, exactly as CONTRACT.md rule
 * 1 requires. There is no operation here that credits a biomass account without a
 * matching, sourced debit somewhere else in the world.
 *
 * The organic fraction of growth (the carbon-hydrogen-oxygen framework of starch,
 * cellulose and protein) is modelled as glucose, C6H12O6, and built with the same
 * `photosynthesize` reaction `world/exchange.ts` already uses for any biomass account
 * -- real photosynthesis does produce glucose first, and polymerising it into starch
 * or cellulose does not change the C:H:O ratio, so this is a real simplification, not
 * an invented one. The mineral fraction (N, P, K and the trace elements) is a direct,
 * balanced transfer from the soil in proportion to that growth. Water used in growth
 * (well beyond the small amount glucose synthesis itself consumes -- real crops
 * transpire far more than they retain) is modelled as a separate, balanced
 * evaporation of soil moisture back to the atmosphere.
 *
 * Every resource limit here follows Liebig's law of the minimum: light, each
 * nutrient, and water each independently cap how much the crop *could* grow this
 * tick, and the smallest of those caps is what actually happens -- never an average,
 * never a sum. That is what makes yield respond to a real deficit rather than being a
 * fixed schedule.
 */

import type { Micrograms } from '../core/commodity.js';
import { ENERGY, elementCommodity, roundHalfEven } from '../core/commodity.js';
import type { AccountId, Entry, Ledger, Posting } from '../core/ledger.js';
import { MOLAR_MASS, WORLD_ACCOUNTS } from '../world/accounts.js';
import { evaporate, photosynthesize } from '../world/exchange.js';

/**
 * Glucose stoichiometry, duplicated from `world/exchange.ts` (whose copies are not
 * exported): `photosynthesize` there already builds the C6H12O6 posting for us, but
 * this module still needs the same molar-mass ratios to convert an *energy* budget
 * into a *mass* target before calling it, and to know what fraction of a microgram
 * of growth is carbon vs hydrogen when bounding respiration-equivalent draws.
 */
const GLUCOSE_MOLAR_MASS = 6 * MOLAR_MASS.C + 12 * MOLAR_MASS.H + 6 * MOLAR_MASS.O;
/** Standard enthalpy of combustion, glucose: ~2,803 kJ/mol (same figure exchange.ts uses). */
const GLUCOSE_COMBUSTION_J_PER_MOL = 2_803_000;
/** Mass-per-mole to energy-per-mole ratio, so an energy budget converts to a mass
 * budget with a single multiplication -- see `reactionEnergy` in exchange.ts for the
 * inverse of this same identity (a joule-per-gram figure is numerically identical to
 * a microjoule-per-microgram figure, since both unit scale factors are 1,000,000). */
const GLUCOSE_MASS_PER_ENERGY_UG_PER_UJ = GLUCOSE_MOLAR_MASS / GLUCOSE_COMBUSTION_J_PER_MOL;

/** Mass fraction of water's own hydrogen: 2 * M(H) / M(H2O). Used to size how much
 * liquid water a given soil hydrogen balance could actually supply -- soil's oxygen
 * balance is dominated by mineral oxides (see world/accounts.ts), so hydrogen, not
 * oxygen, is the real ceiling on extractable soil moisture in this model. */
const WATER_HYDROGEN_MASS_FRACTION = (2 * MOLAR_MASS.H) / (2 * MOLAR_MASS.H + MOLAR_MASS.O);

const SECONDS_PER_DAY = 86_400;

/** A conservative integer ceiling for a resource limit: never rounds up past what is
 * actually computed as available. This is deliberately not `roundHalfEven` -- that
 * function is reserved for converting a *chosen* physical quantity into the ledger's
 * exact unit (CONTRACT.md's "float computes, integer stores" boundary); this is a
 * defensive upper bound used only to clamp a target before that conversion happens. */
function floorMicrograms(value: number): Micrograms {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value));
}

function minBig(a: Micrograms, b: Micrograms): Micrograms {
  return a < b ? a : b;
}

export type CropStage = 'planted' | 'emergence' | 'vegetative' | 'reproductive' | 'ripening' | 'mature';

const STAGE_ORDER: readonly Exclude<CropStage, 'planted'>[] = [
  'emergence',
  'vegetative',
  'reproductive',
  'ripening',
  'mature',
];

/** The trace and macro minerals a crop draws directly from the soil, in fixed
 * proportion to the organic dry matter it grows -- everything the tracked elements
 * cover besides the photosynthetic C, H and O. */
export type MineralElement = 'N' | 'P' | 'K' | 'S' | 'Ca' | 'Mg' | 'Fe' | 'Ash';

export const MINERAL_ELEMENTS: readonly MineralElement[] = ['N', 'P', 'K', 'S', 'Ca', 'Mg', 'Fe', 'Ash'];

/**
 * A crop's growth parameters. Every figure here is illustrative and order-of-
 * magnitude, in the same spirit as the reservoir figures in `world/accounts.ts` --
 * the point is that a finite, sourced, Liebig-limited model stands in for a crop
 * instead of a fixed yield schedule, not agronomic precision.
 */
export interface CropDefinition {
  readonly id: string;
  readonly name: string;
  /** Growing-degree-day base temperature, deg C: no thermal accumulation below this. */
  readonly baseTemperatureC: number;
  /** Cumulative growing-degree-days at which the crop reaches full maturity. */
  readonly gddToMaturity: number;
  /** GDD, as a fraction of `gddToMaturity`, at which each stage begins. Ascending. */
  readonly stageThresholds: Readonly<Record<Exclude<CropStage, 'planted'>, number>>;
  /** Canopy interception fraction (0..1) at full cover, between vegetative and ripening. */
  readonly peakCanopyFraction: number;
  /** Fraction of intercepted solar energy actually fixed as stored chemical energy --
   * real crops manage roughly one to a few percent, never anywhere near 100%. */
  readonly lightUseEfficiency: number;
  /** Mass of each mineral drawn from the soil, per microgram of organic dry matter
   * grown (i.e. a fraction, e.g. 0.018 for 1.8% nitrogen content). */
  readonly nutrientRatio: Readonly<Record<MineralElement, number>>;
  /** Micrograms of soil moisture transpired per microgram of organic dry matter grown
   * -- real crops transpire hundreds of times their own dry-matter increase in water. */
  readonly waterUsePerDryMass: number;
  /** Fraction of total standing dry biomass that is the harvested organ (grain / root)
   * rather than residue (straw / crown). */
  readonly harvestIndex: number;
  /** Fraction, by fresh mass, of the harvested organ that is water at field harvest. */
  readonly freshMoistureContent: number;
}

/** Winter wheat: illustrative UK/temperate-climate parameters. */
export const WINTER_WHEAT: CropDefinition = {
  id: 'winter-wheat',
  name: 'Winter wheat',
  baseTemperatureC: 5,
  gddToMaturity: 1_900,
  stageThresholds: { emergence: 0.04, vegetative: 0.18, reproductive: 0.55, ripening: 0.85, mature: 1 },
  peakCanopyFraction: 0.9,
  lightUseEfficiency: 0.016,
  nutrientRatio: { N: 0.018, P: 0.0035, K: 0.012, S: 0.0015, Ca: 0.0004, Mg: 0.0012, Fe: 0.00005, Ash: 0.02 },
  waterUsePerDryMass: 350,
  harvestIndex: 0.45,
  freshMoistureContent: 0.14,
};

/** Sugar beet: illustrative temperate-climate root-crop parameters. The 'reproductive'
 * stage label is reused generically for the crop's root-bulking phase. */
export const SUGAR_BEET: CropDefinition = {
  id: 'sugar-beet',
  name: 'Sugar beet',
  baseTemperatureC: 3,
  gddToMaturity: 1_700,
  stageThresholds: { emergence: 0.05, vegetative: 0.2, reproductive: 0.5, ripening: 0.85, mature: 1 },
  peakCanopyFraction: 0.85,
  lightUseEfficiency: 0.02,
  nutrientRatio: { N: 0.01, P: 0.002, K: 0.02, S: 0.001, Ca: 0.003, Mg: 0.0015, Fe: 0.00002, Ash: 0.02 },
  waterUsePerDryMass: 500,
  harvestIndex: 0.65,
  freshMoistureContent: 0.75,
};

export const CROPS: Readonly<Record<string, CropDefinition>> = {
  [WINTER_WHEAT.id]: WINTER_WHEAT,
  [SUGAR_BEET.id]: SUGAR_BEET,
};

/** The development stage implied by a cumulative growing-degree-day fraction (0..1). */
export function stageForGddFraction(definition: CropDefinition, gddFraction: number): CropStage {
  let stage: CropStage = 'planted';
  for (const candidate of STAGE_ORDER) {
    if (gddFraction >= definition.stageThresholds[candidate]) stage = candidate;
  }
  return stage;
}

/** Canopy interception fraction (0..1) at a given growing-degree-day fraction: zero
 * before emergence, ramping linearly to `peakCanopyFraction` through the vegetative
 * stage, held flat through reproductive growth, then declining to zero by maturity as
 * the canopy senesces. */
export function interceptionFraction(definition: CropDefinition, gddFraction: number): number {
  const t = definition.stageThresholds;
  if (gddFraction <= t.emergence) return 0;
  if (gddFraction < t.vegetative) {
    return (definition.peakCanopyFraction * (gddFraction - t.emergence)) / (t.vegetative - t.emergence);
  }
  if (gddFraction < t.ripening) return definition.peakCanopyFraction;
  if (gddFraction < t.mature) {
    const senescence = (gddFraction - t.ripening) / (t.mature - t.ripening);
    return definition.peakCanopyFraction * (1 - senescence);
  }
  return 0;
}

export interface CropGrowthParams {
  /** Read-only: used to look up current soil, atmosphere and sun balances so growth
   * can be capped to what is actually there. Every mutation is still a `Posting`
   * returned for the caller to apply -- this function never calls `ledger.post`. */
  readonly ledger: Ledger;
  readonly definition: CropDefinition;
  readonly biomassAccount: AccountId;
  readonly soilAccount: AccountId;
  readonly atmosphereAccount?: AccountId;
  readonly sunAccount?: AccountId;
  /** The field area feeding this crop's light interception. */
  readonly areaM2: bigint;
  /** Growing-degree-days accumulated before this tick. */
  readonly gddAccumulated: number;
  readonly insolationWPerM2: number;
  readonly meanTemperatureC: number;
  readonly dtSeconds: bigint;
}

export interface CropGrowthResult {
  /** Every balanced posting this tick's growth requires. Empty when growth is zero
   * (night, a depleted resource, or a crop already at maturity). */
  readonly postings: readonly Posting[];
  /** Cumulative growing-degree-days after this tick. */
  readonly gddAccumulated: number;
  readonly stage: CropStage;
  /** Organic dry matter grown this tick, before nutrient mass is added on top. */
  readonly dryMatterGrownUg: Micrograms;
}

/**
 * Advance a crop by one tick. Reads current soil, atmosphere and sun balances to
 * bound growth by Liebig's law of the minimum, then returns the balanced postings
 * that growth requires -- the caller applies them via `ledger.post`.
 */
export function growCropTick(params: CropGrowthParams): CropGrowthResult {
  const { ledger, definition, biomassAccount, soilAccount } = params;
  const atmosphereAccount = params.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere;
  const sunAccount = params.sunAccount ?? WORLD_ACCOUNTS.sun;

  const dtDays = Number(params.dtSeconds) / SECONDS_PER_DAY;
  const gddDelta = Math.max(0, params.meanTemperatureC - definition.baseTemperatureC) * dtDays;
  const gddAccumulated = params.gddAccumulated + gddDelta;
  const gddFraction = Math.min(1, gddAccumulated / definition.gddToMaturity);
  const stage = stageForGddFraction(definition, gddFraction);

  if (stage === 'mature') {
    // Standing biomass awaits harvest; nothing further grows once mature.
    return { postings: [], gddAccumulated, stage, dryMatterGrownUg: 0n };
  }

  const canopy = interceptionFraction(definition, gddFraction);
  const interceptedEnergyJ =
    params.insolationWPerM2 * Number(params.areaM2) * canopy * Number(params.dtSeconds);
  const fixedEnergyUJ = interceptedEnergyJ * 1_000_000 * definition.lightUseEfficiency;
  const lightLimitedUg = Math.max(0, fixedEnergyUJ) * GLUCOSE_MASS_PER_ENERGY_UG_PER_UJ;

  // The sun account is a finite reservoir independent of today's insolation figure --
  // bound growth by what it could actually still afford, too.
  const availableSunEnergy = Number(ledger.balance(sunAccount, ENERGY));
  const energyLimitedUg = availableSunEnergy * definition.lightUseEfficiency * GLUCOSE_MASS_PER_ENERGY_UG_PER_UJ;

  // Liebig's law of the minimum: each nutrient bounds growth independently, and the
  // most limiting one sets the ceiling -- never averaged, never summed.
  let nutrientLimitedUg = Infinity;
  for (const element of MINERAL_ELEMENTS) {
    const ratio = definition.nutrientRatio[element];
    if (ratio <= 0) continue;
    const available = Number(ledger.balance(soilAccount, elementCommodity(element)));
    nutrientLimitedUg = Math.min(nutrientLimitedUg, available / ratio);
  }

  const availableSoilHydrogen = Number(ledger.balance(soilAccount, elementCommodity('H')));
  const maxExtractableWaterUg = availableSoilHydrogen / WATER_HYDROGEN_MASS_FRACTION;
  const waterLimitedUg =
    definition.waterUsePerDryMass > 0 ? maxExtractableWaterUg / definition.waterUsePerDryMass : Infinity;

  const targetUg = Math.max(
    0,
    Math.min(lightLimitedUg, energyLimitedUg, nutrientLimitedUg, waterLimitedUg),
  );
  const dryMatterGrownUg = roundHalfEven(targetUg);

  if (dryMatterGrownUg <= 0n) {
    return { postings: [], gddAccumulated, stage, dryMatterGrownUg: 0n };
  }

  const postings: Posting[] = [];

  postings.push(
    photosynthesize({
      biomassAccount,
      atmosphereAccount,
      sunAccount,
      glucoseMass: dryMatterGrownUg,
      process: `agri:crop-growth:${definition.id}`,
    }),
  );

  const nutrientEntries: Entry[] = [];
  for (const element of MINERAL_ELEMENTS) {
    const ratio = definition.nutrientRatio[element];
    if (ratio <= 0) continue;
    const available = ledger.balance(soilAccount, elementCommodity(element));
    // Debit and credit always use the same clamped amount, so this stays balanced by
    // construction even when the Liebig ceiling above and this per-element rounding
    // disagree at the sub-microgram level.
    const amount = minBig(roundHalfEven(Number(dryMatterGrownUg) * ratio), available);
    if (amount <= 0n) continue;
    nutrientEntries.push({ account: soilAccount, commodity: elementCommodity(element), delta: -amount });
    nutrientEntries.push({ account: biomassAccount, commodity: elementCommodity(element), delta: amount });
  }
  if (nutrientEntries.length > 0) {
    postings.push({ process: `agri:crop-nutrient-uptake:${definition.id}`, entries: nutrientEntries });
  }

  const waterUseUg = roundHalfEven(Number(dryMatterGrownUg) * definition.waterUsePerDryMass);
  const transpiredUg = minBig(waterUseUg, floorMicrograms(maxExtractableWaterUg));
  if (transpiredUg > 0n) {
    postings.push(
      evaporate({
        waterAccount: soilAccount,
        atmosphereAccount,
        waterMass: transpiredUg,
        process: `agri:crop-transpiration:${definition.id}`,
      }),
    );
  }

  return { postings, gddAccumulated, stage, dryMatterGrownUg };
}
