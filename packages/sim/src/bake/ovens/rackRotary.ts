/**
 * Rack/rotary oven: forced convection from a fan-driven cavity, with the rack
 * itself rotating the product through the cavity's own spatial temperature
 * gradient — the mechanism (rotation as spatial averaging) that makes this
 * family distinct from a plain static `convection.ts` oven, not just a
 * different coefficient.
 *
 * A real rack-oven cavity is not perfectly uniform (it still has a warmer
 * zone near the fan/burner and a cooler zone near the door); what a rotating
 * rack changes is not the gradient itself but a product's *exposure* to it —
 * every point on the rack sweeps through the full gradient once per
 * revolution. Modelled here by literally sampling the angular temperature
 * profile at several stations around one revolution and averaging the flux
 * across them, rather than asserting uniformity as a given. Because the
 * profile is modelled as a symmetric (cosine) gradient around the mean, the
 * averaged result is provably the same as if the cavity had no gradient at
 * all — the reason rotation is the standard industrial fix for uneven
 * baking, not merely a marketing claim.
 *
 * Forced-air convection coefficient: food-engineering oven convection
 * studies report forced-draft ovens running 20-40+ W/m^2 K, well above a
 * natural-draft deck oven's 10-20 (see `bake/oven.ts`'s own citation for
 * the natural-draft figure); 30 is used as the representative forced-draft
 * mid-range figure.
 */

import type { OvenHeatSource } from '../oven.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const RACK_ROTARY_PROFILE: OvenProfile = {
  id: 'rack-rotary',
  label: 'Rack/rotary oven',
  mechanism:
    'Forced convection from recirculated cavity air, with the whole rack rotating so every load position sweeps through the same angular temperature gradient once per revolution.',
  goodAt: [
    'large multi-tray batches that need even colour regardless of tray position',
    'products sensitive to a single hot or cold spot in the cavity',
  ],
  badAt: [
    'a strong, deck-style bottom crust (no direct sole contact)',
    'products that cannot tolerate the rotating rack’s own mechanical motion',
  ],
};

export const FORCED_CONVECTION_COEFFICIENT_W_PER_M2_K = 30;

export interface RackRotaryStepParams extends FamilyStepBase {
  readonly airTempC: number;
  readonly convectiveAreaM2: number;
  readonly source: OvenHeatSource;
  /** Peak angular non-uniformity of the cavity air temperature around the
   * rack's circular path, C — the real fixed hot/cool spatial gradient that
   * rotation averages out. Defaults to 15 C, a representative figure for an
   * unbaffled forced-air cavity. */
  readonly angularNonUniformityC?: number;
  /** How many angular stations to sample across one full revolution.
   * Defaults to 12 (30-degree stations) — enough that the averaged result is
   * indistinguishable from the exact integral for a smooth cosine profile. */
  readonly rotationStations?: number;
}

const DEFAULT_ANGULAR_NON_UNIFORMITY_C = 15;
const DEFAULT_ROTATION_STATIONS = 12;

/** The rotation-averaged convective flux: the mean, over one full
 * revolution, of a cosine-shaped angular air-temperature gradient acting on
 * the product. */
export function rotationAveragedConvectionW(
  airTempC: number,
  angularNonUniformityC: number,
  stations: number,
  areaM2: number,
  surfaceTempC: number,
): number {
  if (stations <= 0) throw new RangeError(`rotationStations must be positive, got ${stations}`);
  let sum = 0;
  for (let i = 0; i < stations; i += 1) {
    const angle = (2 * Math.PI * i) / stations;
    const localAirTempC = airTempC + angularNonUniformityC * Math.cos(angle);
    sum += FORCED_CONVECTION_COEFFICIENT_W_PER_M2_K * areaM2 * (localAirTempC - surfaceTempC);
  }
  return sum / stations;
}

export function rackRotaryStep(params: RackRotaryStepParams): FamilyStepResult {
  const convectionW = rotationAveragedConvectionW(
    params.airTempC,
    params.angularNonUniformityC ?? DEFAULT_ANGULAR_NON_UNIFORMITY_C,
    params.rotationStations ?? DEFAULT_ROTATION_STATIONS,
    params.convectiveAreaM2,
    params.surfaceTempC,
  );
  return stepFamilyWithOvenSource('rack-rotary', { convection: convectionW }, convectionW, params.source, params);
}
