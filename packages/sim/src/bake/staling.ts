/**
 * After the bake: cooling, starch retrogradation, moisture migration, water
 * activity, and the shelf life that follows from them.
 *
 * As in the rest of `bake/`, the one place this module moves real mass is
 * ambient moisture loss, built as a real `evaporate()` posting reused from
 * `world/exchange.ts`. Retrogradation and water activity are derived,
 * descriptive numbers computed from real food-science models; they do not
 * themselves move any conserved quantity.
 */

import type { Micrograms } from '../core/commodity.js';
import { roundHalfEven, UG_PER_KG } from '../core/commodity.js';
import type { AccountId } from '../core/ledger.js';
import { evaporate } from '../world/exchange.js';
import type { MoistureLossResult } from './transform.js';

/**
 * Newton's law of cooling: `dT/dt = -k(T - T_ambient)`, integrated exactly
 * over one fixed timestep as `T_ambient + (T0 - T_ambient) e^{-k dt}`. `k` is
 * derived from a real convective heat transfer coefficient rather than
 * supplied as an opaque rate, so a bigger or better-insulated product cools
 * measurably slower, exactly as a real one does.
 */
export function coolingRateConstantPerS(
  convectionCoefficientWPerM2K: number,
  surfaceAreaM2: number,
  massKg: number,
  specificHeatJPerKgK: number,
): number {
  if (massKg <= 0 || specificHeatJPerKgK <= 0) {
    throw new RangeError('cooling requires positive mass and specific heat');
  }
  return (convectionCoefficientWPerM2K * surfaceAreaM2) / (massKg * specificHeatJPerKgK);
}

export function stepCooling(
  currentTempC: number,
  ambientTempC: number,
  rateConstantPerS: number,
  dtSeconds: number,
): number {
  if (dtSeconds < 0) throw new RangeError(`cannot step cooling by negative dt ${dtSeconds}`);
  return ambientTempC + (currentTempC - ambientTempC) * Math.exp(-rateConstantPerS * dtSeconds);
}

/**
 * Starch retrogradation rate constant, per hour, by storage temperature band.
 *
 * The real, well-documented and counter-intuitive shape of bread staling
 * (Zeleznak & Hoseney 1986 and the substantial literature since): staling is
 * *fastest* just above freezing, distinctly *slower* at room temperature, and
 * effectively halted once frozen. This is why refrigerating bread accelerates
 * staling rather than preventing it, and why freezing preserves it — real
 * physics, not folk wisdom. Figures below are representative half-life-derived
 * rate constants (room-temperature bread crumb firmness half-life commonly
 * cited in the 24-70 hour range; refrigerated half-life considerably shorter,
 * on the order of a few hours), not a single specific study's exact numbers.
 */
const RETROGRADATION_RATE_PER_HOUR_FROZEN = 0.0005; // effectively halted below 0 C
const RETROGRADATION_RATE_PER_HOUR_REFRIGERATED = 0.15; // 0-10 C: fastest staling
const RETROGRADATION_RATE_PER_HOUR_ROOM = 0.02; // above 10 C: slower

export function retrogradationRateConstantPerHour(tempC: number): number {
  if (tempC <= 0) return RETROGRADATION_RATE_PER_HOUR_FROZEN;
  if (tempC < 10) return RETROGRADATION_RATE_PER_HOUR_REFRIGERATED;
  return RETROGRADATION_RATE_PER_HOUR_ROOM;
}

/**
 * Starch retrogradation extent, 0..1, as a first-order (Avrami exponent n=1)
 * approach to complete recrystallisation — a simplification of the more
 * general Avrami form some staling studies fit with n between roughly 0.5 and
 * 1.5; n=1 is used here as the representative, analytically invertible case
 * (see `shelfLifeHours`, which is the exact inverse of this formula).
 */
export function retrogradationExtent(elapsedHours: number, tempC: number): number {
  if (elapsedHours <= 0) return 0;
  const k = retrogradationRateConstantPerHour(tempC);
  return 1 - Math.exp(-k * elapsedHours);
}

/** Elapsed hours at fixed temperature until retrogradation extent first
 * reaches `threshold` — the exact algebraic inverse of `retrogradationExtent`. */
export function shelfLifeHours(tempC: number, threshold = 0.5): number {
  if (threshold <= 0 || threshold >= 1) {
    throw new RangeError(`retrogradation threshold must be in (0, 1), got ${threshold}`);
  }
  const k = retrogradationRateConstantPerHour(tempC);
  if (k <= 0) return Number.POSITIVE_INFINITY;
  return -Math.log(1 - threshold) / k;
}

/**
 * GAB (Guggenheim-Anderson-de Boer) moisture sorption isotherm — the standard
 * food-engineering model relating equilibrium water activity to moisture
 * content, widely used for starch-rich baked goods. `m0` (monolayer moisture,
 * dry basis) and the `C`/`K` constants below are representative figures for
 * bread and other starchy baked products from published bread sorption
 * isotherm studies (monolayer moisture typically 0.06-0.08 g/g dry matter;
 * `C` typically 10-20; `K` typically 0.7-0.9).
 */
export interface GabParameters {
  readonly monolayerMoisture: number;
  readonly c: number;
  readonly k: number;
}

export const DEFAULT_GAB_PARAMETERS: GabParameters = {
  monolayerMoisture: 0.07,
  c: 15,
  k: 0.8,
};

/** Moisture content (dry basis, kg water / kg dry matter) predicted by the GAB
 * isotherm at a given water activity. */
export function gabMoisture(waterActivity: number, params: GabParameters = DEFAULT_GAB_PARAMETERS): number {
  const { monolayerMoisture, c, k } = params;
  const denominator = (1 - k * waterActivity) * (1 - k * waterActivity + c * k * waterActivity);
  return (monolayerMoisture * c * k * waterActivity) / denominator;
}

/**
 * Water activity from moisture content, by bisection on the GAB isotherm.
 *
 * `gabMoisture` is monotonically increasing in water activity over (0, 1) for
 * the realistic `C, K > 0` parameters used here, which makes bisection a safe,
 * simple, and — unlike a hand-derived closed-form inverse — low-risk way to
 * invert it. 60 iterations narrows the bracket by a factor of 2^60, far past
 * any precision this model's inputs justify.
 */
export function waterActivityFromMoisture(
  moistureContentDryBasis: number,
  params: GabParameters = DEFAULT_GAB_PARAMETERS,
): number {
  if (moistureContentDryBasis <= 0) return 0;
  let lo = 0;
  let hi = 0.999;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (gabMoisture(mid, params) < moistureContentDryBasis) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Representative ambient moisture-loss rate for an unwrapped baked product
 * during storage, kg per m^2 of exposed surface per second. Bread crust
 * moisture-loss studies during ambient storage report unwrapped-loaf loss
 * rates on the order of a few micrograms per cm^2 per second (roughly
 * 1e-6 to 1e-5 kg/m^2/s); 5e-6 is used as a representative order-of-magnitude
 * figure.
 */
const UNPACKAGED_MOISTURE_LOSS_KG_PER_M2_PER_S = 5e-6;

export interface StalingMoistureLossParams {
  readonly productAccount: AccountId;
  readonly atmosphereAccount?: AccountId;
  readonly moistureRemainingUg: Micrograms;
  readonly surfaceAreaM2: number;
  readonly dtSeconds: number;
  /** Packaging is modelled as a complete moisture barrier — a real
   * approximation for a properly sealed bag or wrap, past which internal
   * crumb-to-crust moisture migration continues to soften the crust and dry
   * the crumb without any net mass leaving the product at all. */
  readonly packaged: boolean;
  readonly process?: string;
}

/** Ambient moisture loss during storage — reuses `world/exchange.ts`'s
 * `evaporate`, exactly like `transform.ts`'s in-oven moisture loss, so both
 * phases of a product's life account for water leaving it the same way. */
export function stepStalingMoistureLoss(params: StalingMoistureLossParams): MoistureLossResult | undefined {
  if (params.packaged || params.moistureRemainingUg <= 0n || params.dtSeconds <= 0) return undefined;

  const lossKg = UNPACKAGED_MOISTURE_LOSS_KG_PER_M2_PER_S * params.surfaceAreaM2 * params.dtSeconds;
  const lossUgFloat = lossKg * Number(UG_PER_KG);
  const cappedUg = Math.min(lossUgFloat, Number(params.moistureRemainingUg));
  const evaporatedMassUg = roundHalfEven(cappedUg);
  if (evaporatedMassUg <= 0n) return undefined;

  const posting = evaporate({
    waterAccount: params.productAccount,
    ...(params.atmosphereAccount !== undefined ? { atmosphereAccount: params.atmosphereAccount } : {}),
    waterMass: evaporatedMassUg,
    process: params.process ?? 'staling:moisture-loss',
  });

  return { posting, evaporatedMassUg };
}
