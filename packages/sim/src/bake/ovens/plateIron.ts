/**
 * Plate iron (waffle, madeleine): conduction only, from two heated plates
 * clamped on either side of the batter, each with its own temperature and
 * its own contact area — real waffle-iron heat transfer is dominated by
 * direct metal-to-batter contact under real clamping pressure, not air, and
 * contact area genuinely matters: an iron that has not yet fully closed
 * (batter still spreading, iron not yet latched) transfers real, measurably
 * less heat than one fully closed, purely because less surface actually
 * touches metal. Unlike `bainMarie.ts`'s or `hearth.ts`'s single conduction
 * term, this family sums two independent conductive paths — top plate and
 * bottom plate — because a real plate iron heats a product from both faces
 * simultaneously, not one.
 */

import type { OvenHeatSource } from '../oven.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const PLATE_IRON_PROFILE: OvenProfile = {
  id: 'plate-iron',
  label: 'Plate iron (waffle/madeleine)',
  mechanism: 'Conduction from two independently heated plates clamped on either side of the product, each contributing its own contact-area-scaled flux.',
  goodAt: [
    'a strong, patterned, double-sided crust in a very short bake time',
    'precise per-unit portioning (each iron cavity is one product)',
  ],
  badAt: [
    'anything thicker than the iron’s own gap (only the contact faces are heated; there is no radiant or convective path to the product’s interior)',
    'high-volume continuous throughput (an iron bakes in discrete clamped cycles, not continuously)',
  ],
};

/** Direct clamped metal-to-batter contact under real closing pressure runs
 * higher than an unclamped pan resting on a deck's sole (`bake/oven.ts`'s own
 * 100-300 W/m^2 K range); waffle/griddle-baking heat-transfer studies report
 * clamped-plate contact coefficients on the order of 300-500 W/m^2 K; 400 is
 * used as the representative mid-range figure. */
export const PLATE_CONTACT_COEFFICIENT_W_PER_M2_K = 400;

export interface PlateIronStepParams extends FamilyStepBase {
  readonly topPlateTempC: number;
  readonly bottomPlateTempC: number;
  /** 0..1: how much of the product's own footprint the closing iron
   * actually contacts right now — 0 fully open, 1 fully closed. The same
   * fraction is used for both plates (a plate iron closes both faces
   * together). */
  readonly contactFraction: number;
  readonly fullContactAreaM2: number;
  readonly source: OvenHeatSource;
}

export function plateIronStep(params: PlateIronStepParams): FamilyStepResult {
  if (params.contactFraction < 0 || params.contactFraction > 1) {
    throw new RangeError(`contactFraction must be within [0, 1], got ${params.contactFraction}`);
  }
  const contactAreaM2 = params.contactFraction * params.fullContactAreaM2;
  const topW = PLATE_CONTACT_COEFFICIENT_W_PER_M2_K * contactAreaM2 * (params.topPlateTempC - params.surfaceTempC);
  const bottomW = PLATE_CONTACT_COEFFICIENT_W_PER_M2_K * contactAreaM2 * (params.bottomPlateTempC - params.surfaceTempC);
  const totalW = topW + bottomW;

  return stepFamilyWithOvenSource('plate-iron', { topPlateConduction: topW, bottomPlateConduction: bottomW }, totalW, params.source, params);
}
