/**
 * The cake designer's data model.
 *
 * A design is built entirely from real substances and real masses — never an abstract
 * "decoration point" or a percentage of some notional cake. Every gram named here is a
 * gram `feasibility.ts` can demand from real inventory and `cost.ts` can price from the
 * real economy; every layer's crumb is a real `Formulation` `structure.ts` can compute
 * a real compressive strength for. Nothing in this module moves mass through a
 * `Ledger` itself — a design is a *plan*, evaluated by `structure.ts`, `thermal.ts`,
 * `feasibility.ts` and `cost.ts` — see this directory's `evaluate.ts` for how the four
 * verdicts combine into one acceptance decision.
 */

import type { Micrograms } from '../core/commodity.js';
import type { Formulation } from '../bake/formulation.js';

/**
 * The finishing operations a real cake decoration line applies, each a named,
 * physically distinct step with its own equipment (`feasibility.ts`) and its own
 * thermal behaviour (`thermal.ts`):
 *
 * - `crumbCoat` — a thin sealing layer of icing/buttercream, applied before the final
 *   finish, to bind loose crumb.
 * - `icing` — a sugar-based finish (glacé, royal, or a decorative outer coat) — reads
 *   as sugar-syrup chemistry rather than a fat emulsion, so it is thermally distinct
 *   from `buttercream` (see `thermal.ts`).
 * - `buttercream` — a fat-continuous emulsion (butter or shortening creamed with
 *   sugar): softens and eventually melts with the butterfat itself, not by drying out.
 * - `ganache` — a chocolate/cream emulsion whose set state follows real cocoa-butter
 *   crystallisation, the same physical process `plant/equipment/finishing.ts`'s
 *   chocolate tempering models.
 * - `fondant` — a rolled sugar paste laid over the cake; slumps under its own weight
 *   on a substrate that is too warm.
 * - `piping` — fine detail work in a buttercream- or royal-icing-like medium, laid
 *   down through the same equipment as `icing`/`buttercream` but far more slowly.
 * - `transfer` — a printed edible image or sugar transfer sheet applied to the
 *   surface — priced and timed per sheet, not per gram of print medium.
 */
export const FINISH_KINDS = [
  'crumbCoat',
  'icing',
  'buttercream',
  'ganache',
  'fondant',
  'piping',
  'transfer',
] as const;
export type FinishKind = (typeof FINISH_KINDS)[number];

/** One real crumb layer inside a tier — a real formulation (see `bake/formulation.ts`),
 * so `structure.ts` can derive this layer's own crumb compressive strength from it,
 * and a real, ledger-scale mass. */
export interface DesignLayer {
  readonly id: string;
  readonly formulation: Formulation;
  readonly massUg: Micrograms;
  /** Baked layer height once trimmed level — real geometry, used for the cross-section
   * elevation and for computing this tier's own footprint area alongside `diameterM`. */
  readonly heightM: number;
}

/** A filling spread between two layers — jam, curd, pastry cream, ganache used as a
 * filling rather than an outer finish, and so on. A real substance and a real mass,
 * exactly like a layer, but contributing no structural strength of its own
 * (`structure.ts` treats a filling as dead load only, never as load-bearing crumb —
 * a real filling is typically softer than the crumb around it, and assuming otherwise
 * would be optimistic rather than physically real). */
export interface DesignFilling {
  readonly id: string;
  readonly substanceId: string;
  readonly massUg: Micrograms;
  readonly heightM: number;
}

/** One finishing step applied to a tier: a real substance, a real mass, the kind of
 * operation it physically is, and when in the assembly timeline (seconds since the
 * cake left the oven/cooler) it is applied — the input `thermal.ts` needs to gate it
 * on the product's real temperature at that moment. */
export interface DesignFinish {
  readonly id: string;
  readonly kind: FinishKind;
  readonly substanceId: string;
  readonly massUg: Micrograms;
  readonly elapsedSecondsSinceBake: number;
}

/** One tier: a stack of layers and fillings under a set of finishes, sized by a real
 * diameter. `dowelled`/`dowelCount` record the operator's own structural choice —
 * `structure.ts` never silently inserts dowels a design did not ask for; see that
 * module's doc comment for why a design is refused rather than repaired. */
export interface DesignTier {
  readonly id: string;
  readonly diameterM: number;
  readonly layers: readonly DesignLayer[];
  readonly fillings: readonly DesignFilling[];
  readonly finishes: readonly DesignFinish[];
  readonly dowelled: boolean;
  readonly dowelCount: number;
}

/** A topper sitting on a named tier's top surface — a real substance and mass (a
 * sugar figure, a plaque, fresh flowers treated as a real botanical mass), never a
 * decoration with no physical footing. */
export interface DesignTopper {
  readonly id: string;
  readonly tierId: string;
  readonly substanceId: string;
  readonly massUg: Micrograms;
}

/**
 * The real cooling history this design's finishing steps are gated against —
 * `thermal.ts` feeds this straight into `bake/staling.ts`'s own `coolingRateConstantPerS`
 * / `stepCooling`, so "the product's real temperature" is the same Newton's-law-of-
 * cooling model the bake simulation itself uses, not a second, invented one.
 */
export interface ThermalContext {
  /** Core temperature, Celsius, the moment the assembled cake leaves the oven/cooler —
   * the `T0` `stepCooling` integrates from. */
  readonly bakeTempC: number;
  readonly ambientTempC: number;
  /** Convective heat transfer coefficient, W/(m^2 K) — see `coolingRateConstantPerS`. */
  readonly convectionCoefficientWPerM2K: number;
  /** Whole assembled cake's mass at the point cooling begins — the mass
   * `coolingRateConstantPerS` divides by. */
  readonly totalMassUg: Micrograms;
  readonly surfaceAreaM2: number;
  readonly specificHeatJPerKgK?: number;
}

/** Tiers ordered bottom (index 0) to top — the same order a stand-mounted tiered cake
 * is physically built in, and the order `structure.ts` walks to accumulate load. */
export interface CakeDesign {
  readonly id: string;
  readonly name: string;
  readonly tiers: readonly DesignTier[];
  readonly toppers: readonly DesignTopper[];
  readonly thermal: ThermalContext;
}

/** Every real substance mass a tier itself represents, laid flat — layers, fillings and
 * finishes it carries directly, but not toppers (which belong to a specific tier's
 * *surface*, not its own composition) and not anything above it. Shared by
 * `structure.ts` (load) and `cost.ts` (material cost) so both compute "what this tier
 * itself weighs" identically. */
export function tierOwnMassUg(tier: DesignTier): Micrograms {
  let total = 0n;
  for (const layer of tier.layers) total += layer.massUg;
  for (const filling of tier.fillings) total += filling.massUg;
  for (const finish of tier.finishes) total += finish.massUg;
  return total;
}
