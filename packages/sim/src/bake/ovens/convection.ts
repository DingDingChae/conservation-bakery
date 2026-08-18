/**
 * Convection oven: forced-fan cavity air, exactly like `rackRotary.ts`'s
 * mechanism, but with nothing rotating the load through the cavity's own
 * spatial gradient. Where rack/rotary *averages* a product's exposure to the
 * cavity's hot/cool zones over a rotation, a static convection oven leaves a
 * tray's flux fixed at whatever the cavity gradient happens to be at its
 * shelf, for the whole bake — a real, well-documented behaviour of
 * unbaffled single-fan convection ovens (shelves in the fan's direct
 * discharge run measurably hotter than shelves in its shadow).
 *
 * Uses the same forced-draft convection coefficient as `rackRotary.ts` (both
 * are fan-driven cavities); the two families differ in mechanism — averaged
 * versus fixed exposure — not in a re-tuned constant.
 */

import { FORCED_CONVECTION_COEFFICIENT_W_PER_M2_K } from './rackRotary.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { OvenHeatSource } from '../oven.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const CONVECTION_PROFILE: OvenProfile = {
  id: 'convection',
  label: 'Convection oven',
  mechanism:
    'Forced convection from a fan-driven cavity, with a fixed (not rotation-averaged) shelf position, so the airstream’s own spatial gradient sets a lasting bias per shelf.',
  goodAt: [
    'fast, even single-tray bakes where shelf position is chosen deliberately',
    'lower running and maintenance cost than a rack/rotary line (no rotating mechanism)',
  ],
  badAt: [
    'multi-shelf batches that need identical colour shelf to shelf',
    'a strong deck-style bottom crust (no direct sole contact)',
  ],
};

export interface ConvectionStepParams extends FamilyStepBase {
  readonly airTempC: number;
  readonly convectiveAreaM2: number;
  readonly source: OvenHeatSource;
  /**
   * 0..1: how favourably this shelf sits relative to the fan discharge — 1
   * at the shelf directly in the airstream, falling toward shelves in its
   * shadow. A geometry input describing where this tray actually is, not a
   * literature constant; documented real behaviour of unbaffled
   * single-fan cavities, not a re-tuned number standing in for physics.
   */
  readonly shelfPositionFactor: number;
}

export function convectionStep(params: ConvectionStepParams): FamilyStepResult {
  if (params.shelfPositionFactor < 0 || params.shelfPositionFactor > 1) {
    throw new RangeError(`shelfPositionFactor must be within [0, 1], got ${params.shelfPositionFactor}`);
  }
  const convectionW =
    FORCED_CONVECTION_COEFFICIENT_W_PER_M2_K *
    params.shelfPositionFactor *
    params.convectiveAreaM2 *
    (params.airTempC - params.surfaceTempC);
  return stepFamilyWithOvenSource('convection', { convection: convectionW }, convectionW, params.source, params);
}
