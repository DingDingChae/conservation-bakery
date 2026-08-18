/**
 * Crop definitions for every plant this directory grows via `growth.ts`'s
 * `growAndHarvest` (which drives `agri/crop.ts`'s real Liebig-limited growth
 * model over `agri/field.ts`'s `Field`). Every figure is illustrative and
 * order-of-magnitude, in the same documented spirit as `agri/crop.ts`'s own
 * `WINTER_WHEAT`/`SUGAR_BEET` — the point is a real, resource-limited growth
 * cycle rather than a fixed yield schedule, not agronomic precision.
 *
 * A deliberate simplification, stated once here rather than on every
 * definition below: `Field`'s growth model tracks one season's worth of new
 * photosynthetic growth from a bare planting to a harvestable organ. For a
 * genuine perennial (a cocoa or coffee tree, a vanilla vine, an almond or
 * cherry tree, a sugar maple) this is used to represent one production cycle
 * at an already-established planting — flowering/tapping to harvest — not the
 * multi-year establishment period real orchards need before their first crop.
 * `gddToMaturity` is sized to the real typical number of days that cycle takes
 * at each region's own climate (see `region.ts`), and `harvestIndex` is sized
 * to reflect how much of *that season's* new growth becomes the harvested
 * organ versus new vegetative growth, not the whole tree's cumulative
 * structure.
 */

import type { CropDefinition, MineralElement } from '../agri/crop.js';

/** A generic ascending stage-threshold shape, matching `WINTER_WHEAT`'s own —
 * cosmetic (it only affects canopy interception timing), reused across every
 * definition below rather than re-tuned per crop. */
const STAGES = { emergence: 0.05, vegetative: 0.2, reproductive: 0.5, ripening: 0.85, mature: 1 } as const;

function nutrients(n: number, p: number, k: number, s: number, ca: number, mg: number, fe: number, ash: number): Readonly<Record<MineralElement, number>> {
  return { N: n, P: p, K: k, S: s, Ca: ca, Mg: mg, Fe: fe, Ash: ash };
}

/** Theobroma cacao, one pod-development cycle (~150-180 days, matching real
 * cocoa pod maturation) on an established tree. */
export const COCOA_TREE: CropDefinition = {
  id: 'cocoa-tree',
  name: 'Cocoa tree',
  baseTemperatureC: 10,
  gddToMaturity: 2_800,
  stageThresholds: STAGES,
  peakCanopyFraction: 0.85,
  lightUseEfficiency: 0.018,
  nutrientRatio: nutrients(0.016, 0.003, 0.03, 0.0015, 0.0008, 0.0015, 0.00006, 0.02), // real: cocoa is a notably potassium-hungry crop
  waterUsePerDryMass: 450,
  harvestIndex: 0.35,
  freshMoistureContent: 0.78,
};

/** Vanilla planifolia, one pod-maturation cycle (~9 months, real). */
export const VANILLA_VINE: CropDefinition = {
  id: 'vanilla-vine',
  name: 'Vanilla vine',
  baseTemperatureC: 15,
  gddToMaturity: 2_400,
  stageThresholds: STAGES,
  peakCanopyFraction: 0.7,
  lightUseEfficiency: 0.012,
  nutrientRatio: nutrients(0.012, 0.002, 0.018, 0.001, 0.0006, 0.001, 0.00004, 0.015),
  waterUsePerDryMass: 500,
  harvestIndex: 0.2,
  freshMoistureContent: 0.8,
};

/** Coffea arabica/canephora, one cherry-development cycle (~6-8 months, real). */
export const COFFEE_TREE: CropDefinition = {
  id: 'coffee-tree',
  name: 'Coffee tree',
  baseTemperatureC: 10,
  gddToMaturity: 1_900,
  stageThresholds: STAGES,
  peakCanopyFraction: 0.8,
  lightUseEfficiency: 0.016,
  nutrientRatio: nutrients(0.02, 0.0025, 0.025, 0.0012, 0.0008, 0.0012, 0.00005, 0.018),
  waterUsePerDryMass: 400,
  harvestIndex: 0.3,
  freshMoistureContent: 0.65,
};

/** Citrus sinensis (orange), one fruit-development cycle (~7-8 months, real). */
export const CITRUS_TREE: CropDefinition = {
  id: 'citrus-tree',
  name: 'Orange tree',
  baseTemperatureC: 10,
  gddToMaturity: 2_100,
  stageThresholds: STAGES,
  peakCanopyFraction: 0.85,
  lightUseEfficiency: 0.017,
  nutrientRatio: nutrients(0.014, 0.002, 0.022, 0.001, 0.001, 0.001, 0.00004, 0.016),
  waterUsePerDryMass: 380,
  harvestIndex: 0.4,
  freshMoistureContent: 0.83,
};

/** Prunus dulcis (almond), one kernel-development cycle (~7 months, real). */
export const ALMOND_TREE: CropDefinition = {
  id: 'almond-tree',
  name: 'Almond tree',
  baseTemperatureC: 7,
  gddToMaturity: 1_900,
  stageThresholds: STAGES,
  peakCanopyFraction: 0.8,
  lightUseEfficiency: 0.015,
  nutrientRatio: nutrients(0.014, 0.0035, 0.02, 0.0012, 0.0015, 0.0018, 0.00006, 0.018),
  waterUsePerDryMass: 500,
  harvestIndex: 0.3,
  freshMoistureContent: 0.09,
};

/** Fragaria x ananassa (strawberry), one flowering-to-ripe flush (~6-7 weeks, real). */
export const STRAWBERRY_PLANT: CropDefinition = {
  id: 'strawberry-plant',
  name: 'Strawberry plant',
  baseTemperatureC: 4,
  gddToMaturity: 500,
  stageThresholds: STAGES,
  peakCanopyFraction: 0.75,
  lightUseEfficiency: 0.014,
  nutrientRatio: nutrients(0.012, 0.002, 0.02, 0.001, 0.001, 0.0008, 0.00004, 0.012),
  waterUsePerDryMass: 400,
  harvestIndex: 0.55,
  freshMoistureContent: 0.91,
};

/** Prunus avium (sweet cherry), one bloom-to-harvest cycle (~10 weeks, real). */
export const CHERRY_TREE: CropDefinition = {
  id: 'cherry-tree',
  name: 'Cherry tree',
  baseTemperatureC: 7,
  gddToMaturity: 700,
  stageThresholds: STAGES,
  peakCanopyFraction: 0.8,
  lightUseEfficiency: 0.015,
  nutrientRatio: nutrients(0.013, 0.002, 0.02, 0.001, 0.0009, 0.0009, 0.00004, 0.013),
  waterUsePerDryMass: 420,
  harvestIndex: 0.35,
  freshMoistureContent: 0.82,
};

/** A wildflower forage meadow, modelled as a fast bloom-to-peak-nectar cycle. */
export const FORAGE_MEADOW: CropDefinition = {
  id: 'forage-meadow',
  name: 'Wildflower forage meadow',
  baseTemperatureC: 5,
  gddToMaturity: 480,
  stageThresholds: STAGES,
  peakCanopyFraction: 0.6,
  lightUseEfficiency: 0.01,
  nutrientRatio: nutrients(0.01, 0.0015, 0.015, 0.0008, 0.0006, 0.0006, 0.00003, 0.01),
  waterUsePerDryMass: 350,
  harvestIndex: 0.6, // most of this cycle's new growth is nectar/pollen forage, not woody structure
  freshMoistureContent: 0.8,
};

/** Acer saccharum (sugar maple), modelled as a short cool sugaring season — a
 * stated simplification: real sap flow is driven by daily freeze/thaw
 * temperature cycling, not cumulative growing-degree-days, but a short,
 * cool-climate accumulation window is the closest fit this model offers. */
export const SUGAR_MAPLE: CropDefinition = {
  id: 'sugar-maple',
  name: 'Sugar maple',
  baseTemperatureC: -5,
  gddToMaturity: 210,
  stageThresholds: STAGES,
  peakCanopyFraction: 0.5,
  lightUseEfficiency: 0.008,
  nutrientRatio: nutrients(0.006, 0.001, 0.012, 0.0006, 0.001, 0.0008, 0.00003, 0.008),
  waterUsePerDryMass: 300,
  harvestIndex: 0.15, // only a small share of the tree's seasonal sugar flow is tapped without harming the tree
  freshMoistureContent: 0.98,
};
