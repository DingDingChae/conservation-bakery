/**
 * Infrared oven: a fixed radiant emitter (quartz, ceramic or ribbon-metal
 * element), no convective or conductive path at all — purely Stefan-Boltzmann
 * radiation attenuated by a real geometric view factor to the product's
 * position, and absorbed at the product surface by its own absorptivity.
 *
 * By Kirchhoff's law of thermal radiation, a surface's absorptivity at a
 * given wavelength band equals its emissivity there; this reuses
 * `bake/oven.ts`'s own `SURFACE_EMISSIVITY` figure for exactly that reason —
 * the same real baked-goods-surface property, read as an absorptivity here
 * instead of an emissivity.
 *
 * Position genuinely matters for this family more than for any other: the
 * view factor is not a coefficient tuned per installation, it is a real
 * geometric quantity (how much of the emitter's radiated flux actually
 * reaches this particular product position, out of a full sphere) that falls
 * off sharply with distance and off-axis angle — an emitter directly
 * overhead delivers far more flux than one at a glancing angle a metre away.
 */

import { STEFAN_BOLTZMANN_W_PER_M2_K4, celsiusToKelvin } from '../constants.js';
import { SURFACE_EMISSIVITY, type OvenHeatSource } from '../oven.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const INFRARED_PROFILE: OvenProfile = {
  id: 'infrared',
  label: 'Infrared oven',
  mechanism:
    'Pure Stefan-Boltzmann radiation from a fixed emitter, attenuated by a real geometric view factor to the product’s position and absorbed by the product surface’s own absorptivity.',
  goodAt: [
    'fast surface set/browning on thin or open-faced products',
    'precise, sharply localised heat where only one face needs it',
  ],
  badAt: [
    'even heating through a thick product (radiation only sets the exposed surface, with no conductive or convective path to carry heat inward)',
    'any position off the emitter’s direct line of sight (flux falls off sharply with view factor)',
  ],
};

export interface InfraredStepParams extends FamilyStepBase {
  readonly emitterTempC: number;
  readonly emitterAreaM2: number;
  readonly source: OvenHeatSource;
  /** 0..1: the real fraction of the emitter's radiated flux this product's
   * position actually intercepts — 1 directly on-axis and close, falling
   * toward 0 off-axis or far away. A geometric quantity, not a tuning knob. */
  readonly viewFactor: number;
}

export function infraredStep(params: InfraredStepParams): FamilyStepResult {
  if (params.viewFactor < 0 || params.viewFactor > 1) {
    throw new RangeError(`viewFactor must be within [0, 1], got ${params.viewFactor}`);
  }
  const emitterK = celsiusToKelvin(params.emitterTempC);
  const surfaceK = celsiusToKelvin(params.surfaceTempC);
  const radiationW =
    params.viewFactor *
    SURFACE_EMISSIVITY *
    STEFAN_BOLTZMANN_W_PER_M2_K4 *
    params.emitterAreaM2 *
    (emitterK ** 4 - surfaceK ** 4);

  return stepFamilyWithOvenSource('infrared', { radiation: radiationW }, radiationW, params.source, params);
}
