/**
 * Does the cake's own temperature let this finish actually hold?
 *
 * Every finishing step in `types.ts`'s `DesignFinish` names the moment it is applied
 * as seconds elapsed since the cake left the oven/cooler. This module turns that into
 * the cake's own real substrate temperature at that moment — via `bake/staling.ts`'s
 * own `coolingRateConstantPerS`/`stepCooling`, the same Newton's-law-of-cooling model
 * the bake simulation itself runs, not a second invented one — and gates each finish
 * against it:
 *
 * - **Fondant** is a rolled sugar paste. Professional cake-decorating guidance is
 *   consistent that a room/cake substrate above roughly 24-27 C (75-80 F) makes
 *   fondant tacky and lets it slump and sweat under its own weight; well above that it
 *   visibly slides off a still-warm cake. 27 C is used here as the representative
 *   ceiling.
 * - **Ganache** sets by the same cocoa-butter crystallisation
 *   `plant/equipment/finishing.ts`'s chocolate tempering models (see that module's
 *   `CHOCOLATE_MELT_TEMP_C`/`CHOCOLATE_SEED_TEMP_C`/`CHOCOLATE_WORK_TEMP_C`) — cream
 *   dilutes cocoa butter's own melting range down somewhat, so a real dessert ganache
 *   commonly softens and will not hold a piped or poured shape on a substrate above
 *   roughly 27 C, well below pure cocoa butter's own melt point.
 * - **Buttercream** is a fat-continuous emulsion: real dairy butterfat melts across
 *   roughly 32-35 C, and professional practice keeps an iced, piped cake below about
 *   24 C (75 F) substrate/ambient — past that the emulsion softens enough to slump and
 *   lose piped detail well before it outright liquefies. The same figure gates
 *   `crumbCoat` and `piping`, which are the same buttercream-family medium applied
 *   thinner or finer.
 *
 * `icing` (a sugar-syrup-based glacé/royal finish, which sets by moisture loss rather
 * than a fat's own melting point) and `transfer` (a printed sheet, not a poured or
 * piped medium) have no thermal ceiling modelled here — neither is gated by the same
 * failure mode, and a design is never refused for a mechanism it does not have.
 */

import { coolingRateConstantPerS, stepCooling } from '../bake/staling.js';
import { UG_PER_KG } from '../core/commodity.js';
import type { CakeDesign, DesignFinish, FinishKind } from './types.js';

/** Representative baked-goods specific heat — the same default
 * `plant/equipment/finishing.ts`'s `holdAtTemperature` falls back to when a caller does
 * not supply its own, so a design that omits `ThermalContext.specificHeatJPerKgK`
 * cools by the same assumption the rest of the simulation already uses. */
const DEFAULT_SPECIFIC_HEAT_J_PER_KG_K = 3_200;

export const FONDANT_MAX_SUBSTRATE_TEMP_C = 27;
export const GANACHE_MAX_SUBSTRATE_TEMP_C = 27;
export const BUTTERCREAM_MAX_SUBSTRATE_TEMP_C = 24;

/** The finish kinds with no modelled thermal failure mode — see this module's doc
 * comment for why. */
const THERMALLY_UNGATED_KINDS: ReadonlySet<FinishKind> = new Set(['icing', 'transfer']);

function thresholdForKind(kind: FinishKind): number | null {
  switch (kind) {
    case 'fondant':
      return FONDANT_MAX_SUBSTRATE_TEMP_C;
    case 'ganache':
      return GANACHE_MAX_SUBSTRATE_TEMP_C;
    case 'buttercream':
    case 'crumbCoat':
    case 'piping':
      return BUTTERCREAM_MAX_SUBSTRATE_TEMP_C;
    case 'icing':
    case 'transfer':
      return null;
  }
}

export type ThermalProblemCode = 'fondant-substrate-too-warm' | 'ganache-substrate-too-warm' | 'buttercream-family-substrate-too-warm';

export interface ThermalProblem {
  readonly code: ThermalProblemCode;
  readonly message: string;
}

export interface FinishThermalVerdict {
  readonly finishId: string;
  readonly kind: FinishKind;
  readonly ok: boolean;
  /** The cake's own substrate temperature, Celsius, at the moment this finish is
   * applied — from `bake/staling.ts`'s real cooling model. */
  readonly productTempC: number;
  readonly problems: readonly ThermalProblem[];
}

export interface ThermalReport {
  readonly ok: boolean;
  readonly finishes: readonly FinishThermalVerdict[];
}

/** The cake's own substrate temperature `elapsedSeconds` after it left the
 * oven/cooler — `bake/staling.ts`'s real Newton's-law-of-cooling model, not a second
 * invented one. */
export function productTemperatureAtElapsedSeconds(design: CakeDesign, elapsedSeconds: number): number {
  const thermal = design.thermal;
  const massKg = Number(thermal.totalMassUg) / Number(UG_PER_KG);
  const specificHeat = thermal.specificHeatJPerKgK ?? DEFAULT_SPECIFIC_HEAT_J_PER_KG_K;
  const rateConstant = coolingRateConstantPerS(
    thermal.convectionCoefficientWPerM2K,
    thermal.surfaceAreaM2,
    massKg,
    specificHeat,
  );
  return stepCooling(thermal.bakeTempC, thermal.ambientTempC, rateConstant, Math.max(0, elapsedSeconds));
}

function problemFor(kind: FinishKind, productTempC: number, thresholdC: number): ThermalProblem {
  const base = `${productTempC.toFixed(1)} C, above the ${thresholdC} C ceiling`;
  switch (kind) {
    case 'fondant':
      return {
        code: 'fondant-substrate-too-warm',
        message: `the cake is ${base} at which rolled fondant slumps and sweats under its own weight.`,
      };
    case 'ganache':
      return {
        code: 'ganache-substrate-too-warm',
        message: `the cake is ${base} at which this ganache's cocoa butter cannot hold a set crystal form.`,
      };
    default:
      return {
        code: 'buttercream-family-substrate-too-warm',
        message: `the cake is ${base} at which this ${kind} finish softens and loses its shape.`,
      };
  }
}

function evaluateFinish(design: CakeDesign, finish: DesignFinish): FinishThermalVerdict {
  const productTempC = productTemperatureAtElapsedSeconds(design, finish.elapsedSecondsSinceBake);
  const threshold = thresholdForKind(finish.kind);
  const problems: ThermalProblem[] = [];
  if (threshold !== null && productTempC > threshold) {
    problems.push(problemFor(finish.kind, productTempC, threshold));
  }
  return { finishId: finish.id, kind: finish.kind, ok: problems.length === 0, productTempC, problems };
}

/** Evaluate every finish across every tier against the cake's own real cooling curve. */
export function evaluateThermal(design: CakeDesign): ThermalReport {
  const finishes = design.tiers.flatMap((tier) => tier.finishes.map((finish) => evaluateFinish(design, finish)));
  return { ok: finishes.every((verdict) => verdict.ok), finishes };
}

// Re-exported so a caller (or a test) can name "these are the kinds with no thermal
// ceiling" without duplicating the set.
export { THERMALLY_UNGATED_KINDS };
