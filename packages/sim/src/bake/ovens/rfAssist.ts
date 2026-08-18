/**
 * Radio-frequency (RF) assist: volumetric dielectric heating, the one family
 * in this directory whose mechanism is not a surface flux at all. An RF
 * field couples directly into every point of the product's own volume
 * (real, published RF/microwave food-heating physics — see Nelson, S.O. &
 * Datta, A.K., "Dielectric properties of food materials and electric field
 * interactions," in *Handbook of Microwave Technology for Food Applications*
 * (2001)), at a power density given by the real dielectric-heating formula:
 *
 *     P = 2 * pi * f * epsilon0 * epsilon'' * E^2      (W/m^3)
 *
 * where `f` is the field frequency, `epsilon0` the (exact, SI) vacuum
 * permittivity, `epsilon''` the product's dielectric loss factor, and `E`
 * the field strength inside the product. `epsilon0` and `f` are real
 * constants (27.12 MHz is one of the ISM-band frequencies actually allocated
 * for industrial RF heating); `epsilon''` is the one term that is real but
 * strongly material- and moisture-dependent — free water dominates the
 * dielectric loss of most food materials at RF frequencies (same Nelson &
 * Datta reference), which is exactly why this family's own defining
 * behaviour is real: heating falls away, by construction, as the product
 * dries, because there is decreasingly little free water left to couple the
 * field into.
 */

import type { Micrograms } from '../../core/commodity.js';
import type { OvenHeatSource } from '../oven.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const RF_ASSIST_PROFILE: OvenProfile = {
  id: 'rf-assist',
  label: 'Radio-frequency (RF) assist',
  mechanism:
    'Volumetric dielectric heating throughout the product, coupling energy in proportion to its own remaining free-moisture content, so heating falls away as the product dries.',
  goodAt: [
    'finishing the wet interior of a thick product without over-browning the surface',
    'shortening bake time by heating volume, not waiting for surface heat to conduct inward',
  ],
  badAt: [
    'surface browning or crust formation (no radiant or convective surface path at all)',
    'a fully dry product (dielectric loss collapses once free moisture is gone, so this family has nothing left to couple into)',
  ],
};

/** Vacuum permittivity, F/m — exact SI/CODATA reference constant. */
export const VACUUM_PERMITTIVITY_F_PER_M = 8.8541878128e-12;
/** A standard ISM-band frequency actually allocated for industrial RF
 * dielectric heating, Hz. */
export const RF_FREQUENCY_HZ = 27.12e6;
/** Representative dielectric loss factor of a high-moisture food product at
 * RF frequencies, at full (reference) moisture — food dielectric-property
 * surveys (Nelson & Datta, cited above) report loss factors broadly in the
 * 10-20 range for moist food materials in the RF band; 15 is used as the
 * representative figure. */
export const DEFAULT_BASE_LOSS_FACTOR = 15;

export interface RfAssistStepParams extends FamilyStepBase {
  readonly volumeM3: number;
  /** RF field strength inside the product, V/m — an equipment/geometry
   * parameter (generator power and applicator design), not a material
   * property. */
  readonly fieldStrengthVPerM: number;
  /** The product's moisture mass at full (reference) hydration — the
   * denominator `moistureRemainingUg` is compared against to get the
   * dielectric loss factor's real moisture dependence. */
  readonly referenceMoistureUg: Micrograms;
  readonly source: OvenHeatSource;
  readonly baseLossFactor?: number;
}

/** The real moisture-dependence this family's whole premise rests on: the
 * dielectric loss factor scales with the fraction of reference moisture
 * still present, collapsing to zero once the product is dry. */
export function effectiveLossFactor(
  baseLossFactor: number,
  moistureRemainingUg: Micrograms,
  referenceMoistureUg: Micrograms,
): number {
  if (referenceMoistureUg <= 0n) return 0;
  const fraction = Number(moistureRemainingUg) / Number(referenceMoistureUg);
  const clamped = fraction <= 0 ? 0 : fraction >= 1 ? 1 : fraction;
  return baseLossFactor * clamped;
}

/** Volumetric RF power, W, from the real dielectric-heating formula. */
export function rfPowerW(
  fieldStrengthVPerM: number,
  lossFactor: number,
  volumeM3: number,
): number {
  const powerDensityWPerM3 =
    2 * Math.PI * RF_FREQUENCY_HZ * VACUUM_PERMITTIVITY_F_PER_M * lossFactor * fieldStrengthVPerM ** 2;
  return powerDensityWPerM3 * volumeM3;
}

export function rfAssistStep(params: RfAssistStepParams): FamilyStepResult {
  const lossFactor = effectiveLossFactor(
    params.baseLossFactor ?? DEFAULT_BASE_LOSS_FACTOR,
    params.moistureRemainingUg,
    params.referenceMoistureUg,
  );
  const volumetricW = rfPowerW(params.fieldStrengthVPerM, lossFactor, params.volumeM3);

  return stepFamilyWithOvenSource('rf-assist', { volumetric: volumetricW }, volumetricW, params.source, params);
}
