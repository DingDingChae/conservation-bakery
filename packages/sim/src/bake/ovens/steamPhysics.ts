/**
 * The one piece of real physics `pressureSteamer.ts` and `steamTube.ts` share:
 * how much hotter than 100 C saturated steam runs once it is held above
 * atmospheric pressure — the entire reason a pressure steamer cooks faster
 * than an open bain-marie ever could.
 */

import { LATENT_HEAT_VAPORISATION_J_PER_KG } from '../constants.js';

/** 100 C in Kelvin, at the reference pressure below — the real, defining
 * anchor point of the water saturation curve. */
const REFERENCE_BOILING_K = 373.15;
/** Standard atmospheric pressure, Pa (exact SI reference value). */
const REFERENCE_PRESSURE_PA = 101_325;

/** Specific gas constant of water vapour, J/(kg K): the universal gas
 * constant (8.314462618 J/mol K, exact by SI definition) divided by water's
 * molar mass (18.015 g/mol) — R_specific = R / M, not an independently
 * looked-up figure. */
const WATER_VAPOUR_GAS_CONSTANT_J_PER_KG_K = 8.314462618 / 0.018015;

/**
 * Saturation temperature of water at `pressurePa`, via the Clausius-Clapeyron
 * relation integrated with a constant latent heat — the standard
 * process-engineering approximation over the modest pressure range a bakery
 * pressure steamer actually runs at (a fraction of a bar to roughly one bar
 * above atmospheric), where the latent heat's own temperature dependence is a
 * second-order effect. Anchored at the real 100 C / 101,325 Pa reference
 * point, so it recovers exactly 100 C at atmospheric pressure.
 */
export function saturationTempC(pressurePa: number): number {
  if (pressurePa <= 0) {
    throw new RangeError(`saturation pressure must be positive, got ${pressurePa}`);
  }
  const inverseK =
    1 / REFERENCE_BOILING_K -
    (WATER_VAPOUR_GAS_CONSTANT_J_PER_KG_K / LATENT_HEAT_VAPORISATION_J_PER_KG) *
      Math.log(pressurePa / REFERENCE_PRESSURE_PA);
  return 1 / inverseK - 273.15;
}
