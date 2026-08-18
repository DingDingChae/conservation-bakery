/**
 * Hearth oven: conduction from a high-thermal-mass stone or masonry floor,
 * and radiation from a masonry dome — deliberately *no* convective term.
 * Real hearth ovens are not fan-forced; whatever residual air movement
 * exists is a minor natural-draft effect this model does not separately
 * account for, unlike `bake/oven.ts`'s deck family, which is a
 * natural-*convection* deck oven and does keep a (weak) convective path. The
 * absence of a convective term here is the real, structural difference
 * between "baked directly on a hearth" and "baked on a pan in a cabinet
 * oven", not a smaller number standing in for the same mechanism.
 *
 * Direct dough-to-stone contact has a materially higher practical conduction
 * coefficient than a thin metal pan on a deck's sole: stone's higher thermal
 * effusivity and the loaf's own direct (unpanned) contact are why
 * artisan-bread hearth-baking heat-transfer studies report figures on the
 * order of 300-400 W/m^2 K, above the 100-300 W/m^2 K deck-oven pan-contact
 * range `bake/oven.ts` cites; 350 is used as the representative mid-range
 * hearth figure.
 */

import { STEFAN_BOLTZMANN_W_PER_M2_K4, celsiusToKelvin } from '../constants.js';
import { SURFACE_EMISSIVITY, type OvenHeatSource } from '../oven.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const HEARTH_PROFILE: OvenProfile = {
  id: 'hearth',
  label: 'Hearth oven',
  mechanism: 'Conduction from a high-thermal-mass stone or masonry floor, plus radiation from a masonry dome — no forced or natural convective term.',
  goodAt: [
    'a strong, direct bottom crust from unpanned dough-to-stone contact',
    'holding a stable bake temperature over a long session (high thermal mass resists loading dips)',
  ],
  badAt: [
    'quick temperature changes between bakes (the same thermal mass that stabilises the bake resists fast setpoint changes)',
    'products that need forced-air surface drying or top browning independent of the dome',
  ],
};

export const HEARTH_CONDUCTION_COEFFICIENT_W_PER_M2_K = 350;

export interface HearthStepParams extends FamilyStepBase {
  readonly hearthTempC: number;
  readonly domeTempC: number;
  readonly contactAreaM2: number;
  readonly domeFacingAreaM2: number;
  readonly source: OvenHeatSource;
  /**
   * 0..1: how close this loaf sits to the firebox, for a fire-fed hearth —
   * 1 immediately beside the fire, falling off toward the back of the deck.
   * Attenuates the dome's radiant contribution only (the real position
   * effect in a fired hearth: the stone sole itself is fired to a fairly
   * even temperature by design, but the open dome radiant field is not).
   * Defaults to 1 (uniform, e.g. an electrically-heated hearth with no
   * single fire to sit near).
   */
  readonly emberProximityFactor?: number;
}

export function hearthStep(params: HearthStepParams): FamilyStepResult {
  const conductionW =
    HEARTH_CONDUCTION_COEFFICIENT_W_PER_M2_K * params.contactAreaM2 * (params.hearthTempC - params.surfaceTempC);

  const proximity = params.emberProximityFactor ?? 1;
  if (proximity < 0 || proximity > 1) {
    throw new RangeError(`emberProximityFactor must be within [0, 1], got ${proximity}`);
  }
  const domeK = celsiusToKelvin(params.domeTempC);
  const surfaceK = celsiusToKelvin(params.surfaceTempC);
  const radiationW =
    proximity * SURFACE_EMISSIVITY * STEFAN_BOLTZMANN_W_PER_M2_K4 * params.domeFacingAreaM2 * (domeK ** 4 - surfaceK ** 4);

  const totalW = conductionW + radiationW;
  return stepFamilyWithOvenSource('hearth', { conduction: conductionW, radiation: radiationW }, totalW, params.source, params);
}
