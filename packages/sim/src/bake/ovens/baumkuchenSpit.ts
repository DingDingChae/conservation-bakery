/**
 * Rotating baumkuchen spit: a fixed radiant heating element and a rotating
 * cone, baking one thin batter layer at a time — each new layer must be
 * radiantly set before the next is poured over it, the real technique behind
 * this cake's characteristic ring structure. Two mechanisms combine, neither
 * shared with any other family in this directory in this combination:
 *
 * - Radiation only (no conduction, no convection): a baumkuchen spit sits in
 *   front of an open radiant element, not inside a closed cavity.
 * - Rotation as *angular* exposure-averaging, exactly `rackRotary.ts`'s
 *   technique (spatial sampling around one revolution, averaged), but here
 *   applied to a single active outer layer rather than a whole rack, and for
 *   a different physical reason: not to cancel a cavity's own hot/cool
 *   zones, but so a stationary radiant element still bakes the entire
 *   circumference of a rotating cone evenly.
 *
 * `canAddNextLayer` is the gating rule the whole family exists to express:
 * real baumkuchen technique pours the next layer only once the current one
 * has visibly set, reusing `transform.ts`'s own real starch-gelatinisation
 * extent (the structural-set mechanism already modelled there) rather than
 * inventing a second "doneness" concept for this one family.
 */

import { starchGelatinisationFraction } from '../transform.js';
import { STEFAN_BOLTZMANN_W_PER_M2_K4, celsiusToKelvin } from '../constants.js';
import { SURFACE_EMISSIVITY, type OvenHeatSource } from '../oven.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const BAUMKUCHEN_SPIT_PROFILE: OvenProfile = {
  id: 'baumkuchen-spit',
  label: 'Rotating baumkuchen spit',
  mechanism:
    'Radiation only from a fixed element onto a rotating cone, angle-averaged by rotation, baking one thin layer at a time in sequence — each layer gated on the previous layer’s own real set extent.',
  goodAt: [
    'the ringed, layer-by-layer structure a baumkuchen (or similarly spit-built product) actually needs',
    'even circumferential colour on a rotating body from a single fixed element',
  ],
  badAt: [
    'anything not built up in thin sequential layers (this family has no bulk-heating path at all — only a thin active surface layer is ever exposed to significant flux)',
    'fast throughput (each layer must set before the next is poured, an inherently sequential process)',
  ],
};

/** Whether the active (outermost) layer has set enough, by the same real
 * starch-gelatinisation extent `transform.ts` already models, that the next
 * batter layer may be poured over it without the two layers merging. */
export function canAddNextLayer(activeLayerTempC: number): boolean {
  return starchGelatinisationFraction(activeLayerTempC) >= 1;
}

export interface BaumkuchenSpitStepParams extends FamilyStepBase {
  readonly emitterTempC: number;
  readonly emitterAreaM2: number;
  readonly source: OvenHeatSource;
  /** How many angular stations to average the rotating cone's exposure to
   * the fixed emitter across. Defaults to 12, matching `rackRotary.ts`. */
  readonly rotationStations?: number;
  /**
   * 0..1. How directional the illumination is.
   *
   * A stationary emitter only lights the face turned towards it: the far side of the
   * cone receives nothing from it at all, so the view factor is `max(0, cos θ)` and not
   * `1 + a·cos θ`. That distinction is the whole model. A symmetric cosine term averages
   * to exactly zero over a revolution and would make this parameter inert — a documented
   * mechanism that can never change an output, which is worse than no mechanism at all.
   *
   * At 0 the enclosure is treated as perfectly reflective, so every angle is lit equally.
   * At 1 it is pure line of sight from a single emitter, and the rotation-averaged flux
   * falls to 1/π of the on-axis value. Real spits sit between the two, which is why this
   * is a parameter rather than a constant.
   *
   * This is a different mechanism from `rackRotary.ts`, whose rotation averages away a
   * variation in the surrounding *air*; here the geometry itself is what varies.
   */
  readonly directionalShading?: number;
}

const DEFAULT_ROTATION_STATIONS = 12;
const DEFAULT_DIRECTIONAL_SHADING = 0.4;

export function baumkuchenSpitStep(params: BaumkuchenSpitStepParams): FamilyStepResult {
  const stations = params.rotationStations ?? DEFAULT_ROTATION_STATIONS;
  if (stations <= 0) throw new RangeError(`rotationStations must be positive, got ${stations}`);
  const shading = params.directionalShading ?? DEFAULT_DIRECTIONAL_SHADING;
  if (shading < 0 || shading > 1) {
    throw new RangeError(`directionalShading must be between 0 and 1, got ${shading}`);
  }

  const emitterK = celsiusToKelvin(params.emitterTempC);
  const surfaceK = celsiusToKelvin(params.surfaceTempC);
  const baseRadiationW =
    SURFACE_EMISSIVITY * STEFAN_BOLTZMANN_W_PER_M2_K4 * params.emitterAreaM2 * (emitterK ** 4 - surfaceK ** 4);

  let sum = 0;
  for (let i = 0; i < stations; i += 1) {
    const angle = (2 * Math.PI * i) / stations;
    // Clamped at zero: the face turned away from the emitter receives nothing from it.
    const viewFactor = 1 - shading + shading * Math.max(0, Math.cos(angle));
    sum += baseRadiationW * viewFactor;
  }
  const radiationW = sum / stations;

  return stepFamilyWithOvenSource('baumkuchen-spit', { radiation: radiationW }, radiationW, params.source, params);
}
