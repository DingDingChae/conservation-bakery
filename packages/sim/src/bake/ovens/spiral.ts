/**
 * Spiral (spiral-conveyor) oven: forced convection through a tall multi-tier
 * helical conveyor, the equipment industrial cracker, cookie and snack lines
 * actually use for continuous high-volume baking. Its distinguishing real
 * behaviour is a *tier* gradient rather than `rackRotary.ts`'s *angular*
 * one: warm air genuinely stratifies up a tall tower (the ordinary stack
 * effect in any tall multi-tier convection enclosure), so a product's actual
 * exposure depends on which tiers it passes through during a tick, not on a
 * single fixed shelf.
 *
 * Modelled as a linear temperature gradient over tier height, averaged across
 * the (fractional) tier range the belt physically carries the product
 * through during this tick — averaging over *conveyance distance traversed
 * within the step*, as opposed to `rackRotary.ts`'s averaging over a full
 * rotation, and `convection.ts`'s single fixed sample. Three families, three
 * different ways "position" enters a forced-convection flux, none of them a
 * relabelled copy of another.
 */

import { FORCED_CONVECTION_COEFFICIENT_W_PER_M2_K } from './rackRotary.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { OvenHeatSource } from '../oven.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const SPIRAL_PROFILE: OvenProfile = {
  id: 'spiral',
  label: 'Spiral (spiral-conveyor) oven',
  mechanism:
    'Forced convection through a tall multi-tier helical conveyor, with a real tier-height temperature gradient integrated over the tiers the belt actually carries the product through during a tick.',
  goodAt: [
    'very high continuous throughput in a compact floor footprint',
    'long, gentle bake profiles achieved by tier count rather than belt speed alone',
  ],
  badAt: [
    'small batches or one-off products (a continuous conveyor line, not a batch oven)',
    'products needing a strong, single-sided crust (forced air on every exposed face)',
  ],
};

/** Peak tier-to-tier air-temperature spread from the stack effect in a tall,
 * unbaffled multi-tier convection tower — a representative figure for the
 * gradient this family's mechanism is built around, not a per-installation
 * measurement. */
const DEFAULT_TIER_GRADIENT_C = 20;

export interface SpiralStepParams extends FamilyStepBase {
  readonly baseAirTempC: number;
  readonly convectiveAreaM2: number;
  readonly source: OvenHeatSource;
  /** Fractional tier position (0 = bottom tier, 1 = top tier) at the start
   * and end of this tick — where the conveyor actually carries the product
   * during the step, not a single static shelf. */
  readonly tierFractionStart: number;
  readonly tierFractionEnd: number;
  /** Peak tier-to-tier temperature spread, C. Defaults to a representative
   * unbaffled-tower figure; a well-baffled installation would pass a
   * smaller number here. */
  readonly tierGradientC?: number;
  /** How many samples to integrate the tier range with. Defaults to 8. */
  readonly samples?: number;
}

/** The tier-range-averaged convective flux: the mean, across the fractional
 * tier positions the conveyor traverses during this tick, of a linear
 * tier-height air-temperature gradient acting on the product. */
export function tierAveragedConvectionW(
  baseAirTempC: number,
  tierGradientC: number,
  fractionStart: number,
  fractionEnd: number,
  samples: number,
  areaM2: number,
  surfaceTempC: number,
): number {
  if (samples <= 0) throw new RangeError(`samples must be positive, got ${samples}`);
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    // Midpoint sampling: cell i covers [i/samples, (i+1)/samples) of the range.
    const t = (i + 0.5) / samples;
    const tierFraction = fractionStart + (fractionEnd - fractionStart) * t;
    const localAirTempC = baseAirTempC + tierGradientC * (tierFraction - 0.5);
    sum += FORCED_CONVECTION_COEFFICIENT_W_PER_M2_K * areaM2 * (localAirTempC - surfaceTempC);
  }
  return sum / samples;
}

export function spiralStep(params: SpiralStepParams): FamilyStepResult {
  const convectionW = tierAveragedConvectionW(
    params.baseAirTempC,
    params.tierGradientC ?? DEFAULT_TIER_GRADIENT_C,
    params.tierFractionStart,
    params.tierFractionEnd,
    params.samples ?? 8,
    params.convectiveAreaM2,
    params.surfaceTempC,
  );
  return stepFamilyWithOvenSource('spiral', { convection: convectionW }, convectionW, params.source, params);
}
