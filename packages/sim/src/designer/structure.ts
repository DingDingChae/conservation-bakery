/**
 * Will it stand?
 *
 * A tiered cake is a real stack of loaded columns. Every tier above the base transmits
 * its own weight — layers, fillings, finishes, its own cake board, and anything
 * resting on it — straight down onto the top surface of the tier beneath it, borne
 * either by that tier's own crumb or, if the design installs them, by dowels that
 * carry the load past the crumb to the board underneath.
 *
 * Two real, well-documented facts about a real tiered cake drive every check here:
 *
 * 1. **The load lands on a small footprint, not the whole top surface.** A tier's own
 *    board is cut to (approximately) that tier's own diameter, so what actually
 *    touches the tier below is that smaller board's footprint, not the full top area
 *    of the tier beneath — which is exactly why a modest top tier can crush the icing
 *    and crumb directly under its board even though the tier below looks, by eye,
 *    "big enough". This is the standard professional explanation for why an undowelled
 *    stack fails at the board's edge, not uniformly.
 * 2. **Cake crumb has a real, finite compressive strength**, driven by its own
 *    formulation. A dense, structure-forming batter (high `structureIndex` — flour and
 *    egg protein dominate over sugar and fat, see `bake/formulation.ts`) is measurably
 *    stiffer and stronger in compression than a light, tender one. Published
 *    texture-profile-analysis (TPA) studies of cake crumb firmness (peak compression
 *    force over probe cross-section) report figures from a few kPa for a light, well
 *    aerated sponge up to several tens of kPa for a dense pound cake (representative
 *    range e.g. Gómez et al. and Wilderjans et al.'s pound-cake crumb TPA studies).
 *    `structureIndex`'s -1..+1 range (see `formulation.ts`) is mapped onto that
 *    published span below — an approximation of a real, cited relationship, not a
 *    direct fit to any specific study's own formulation, exactly as this module's
 *    obligation is to state honestly.
 *
 * Nothing here silently adds a dowel a design did not ask for. An overloaded,
 * undowelled tier is refused outright — the same way it would collapse in a real
 * bakery — naming the exact stress and strength involved.
 */

import { evaluateFormulation } from '../bake/formulation.js';
import type { CakeDesign, DesignTier } from './types.js';
import { tierOwnMassUg } from './types.js';

/** Standard gravity, m/s^2 — CODATA/ISO 80000 conventional value. */
export const GRAVITY_M_PER_S2 = 9.806_65;

/**
 * A tier's own cake board (a corrugated cake drum or cake card): representative
 * density for corrugated cake board (~600-800 kg/m^3 for the paperboard-and-air
 * composite construction) and a standard 6 mm board thickness, both order-of-magnitude
 * figures rather than one manufacturer's spec sheet — the board's own mass is a small
 * correction next to the cake it carries, but real, so it is not dropped to zero.
 */
export const CAKE_BOARD_DENSITY_KG_PER_M3 = 700;
export const CAKE_BOARD_THICKNESS_M = 0.006;

/** See this module's doc comment: the published span published cake-crumb TPA studies
 * report, in kPa, that `structureIndex` (`formulation.ts`, nominal range -1..+1 for a
 * formulation that passes `validateFormulation`) is linearly mapped onto. */
export const CRUMB_STRENGTH_MIN_KPA = 6;
export const CRUMB_STRENGTH_MAX_KPA = 45;

/**
 * Widely used professional tiered-cake construction guidance: one internal support
 * dowel per roughly 10 cm (4 in) of tier diameter, with a minimum of three so the load
 * transfers evenly (two dowels alone cannot prevent the board from rocking) — the same
 * rule of thumb professional cake-decorating references and course materials teach for
 * dowelling a tiered stack, not a load-capacity figure. A single wooden dowel's own
 * compressive/buckling capacity is far beyond any real cake tier's weight (a 9-10 mm
 * hardwood dowel loaded along its grain carries the equivalent of tens of kilograms
 * before buckling even over a tall tier), so the real constraint dowelling design runs
 * into in practice is even, stable load distribution across enough dowels — this
 * spacing rule — not any single dowel's own strength.
 */
export const DOWEL_SPACING_M = 0.10;
export const MINIMUM_DOWEL_COUNT = 3;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function tierFootprintAreaM2(diameterM: number): number {
  const radius = diameterM / 2;
  return Math.PI * radius * radius;
}

function boardMassKg(diameterM: number): number {
  return tierFootprintAreaM2(diameterM) * CAKE_BOARD_THICKNESS_M * CAKE_BOARD_DENSITY_KG_PER_M3;
}

/**
 * Mass-weighted crumb compressive strength for a tier's own layers, in Pa. A tier with
 * more than one layer (e.g. two flavours stacked in the same tier) is only as strong,
 * on average, as its weakest and strongest layers weighted by how much of the tier
 * each one actually is — the same "weighted by mass" logic `formulation.ts` itself
 * uses nowhere else, but the physically honest way to combine two different crumbs
 * bearing the same load together.
 */
export function tierCrumbStrengthPa(tier: DesignTier): number {
  let weightedKPa = 0;
  let totalLayerMassUg = 0n;
  for (const layer of tier.layers) {
    const metrics = evaluateFormulation(layer.formulation);
    const t = clamp((metrics.structureIndex + 1) / 2, 0, 1);
    const strengthKPa = CRUMB_STRENGTH_MIN_KPA + t * (CRUMB_STRENGTH_MAX_KPA - CRUMB_STRENGTH_MIN_KPA);
    weightedKPa += strengthKPa * Number(layer.massUg);
    totalLayerMassUg += layer.massUg;
  }
  if (totalLayerMassUg <= 0n) return 0;
  return (weightedKPa / Number(totalLayerMassUg)) * 1_000;
}

export function minimumDowelCount(diameterM: number): number {
  return Math.max(MINIMUM_DOWEL_COUNT, Math.ceil(diameterM / DOWEL_SPACING_M));
}

export type StructuralProblemCode =
  | 'empty-tier'
  | 'tier-overloaded-no-dowels'
  | 'insufficient-dowels'
  | 'overhanging-tier';

export interface StructuralProblem {
  readonly code: StructuralProblemCode;
  readonly message: string;
}

export interface TierStructuralVerdict {
  readonly tierId: string;
  readonly ok: boolean;
  /** Newtons transmitted onto this tier's top surface by everything stacked above it —
   * 0 for the topmost tier, which carries only its own weight. */
  readonly loadAboveN: number;
  /** The footprint the load above actually bears on — the board of the tier
   * immediately above, per this module's doc comment; equal to this tier's own
   * footprint when it is the topmost tier (nothing loads it from above). */
  readonly bearingAreaM2: number;
  readonly stressPa: number;
  readonly crumbStrengthPa: number;
  readonly dowelled: boolean;
  readonly dowelCount: number;
  readonly minimumDowelCount: number;
  readonly problems: readonly StructuralProblem[];
}

export interface StructuralReport {
  readonly ok: boolean;
  readonly tiers: readonly TierStructuralVerdict[];
}

/** Everything a tier itself weighs once assembled: its own layers, fillings and
 * finishes, plus its own board, plus any topper resting on its own top surface. */
function tierTotalMassKg(tier: DesignTier, design: CakeDesign): number {
  const ownMassUg = tierOwnMassUg(tier);
  const topperMassUg = design.toppers
    .filter((topper) => topper.tierId === tier.id)
    .reduce((sum, topper) => sum + topper.massUg, 0n);
  const boardKg = boardMassKg(tier.diameterM);
  return Number(ownMassUg + topperMassUg) / 1_000_000_000 + boardKg;
}

/**
 * Evaluate every tier's structural verdict, bottom to top. A design is never silently
 * repaired: an overloaded, undowelled tier is refused by name, and an under-dowelled
 * or overhanging tier is refused with the exact shortfall, never quietly accepted.
 */
export function evaluateStructure(design: CakeDesign): StructuralReport {
  const tiers = design.tiers;
  const verdicts: TierStructuralVerdict[] = [];

  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index]!;
    const above = tiers[index + 1];
    const problems: StructuralProblem[] = [];

    if (tier.layers.length === 0) {
      problems.push({
        code: 'empty-tier',
        message: `tier "${tier.id}" has no cake layer at all — there is no crumb for anything to rest on.`,
      });
    }

    if (above && above.diameterM > tier.diameterM) {
      problems.push({
        code: 'overhanging-tier',
        message:
          `tier "${above.id}" (${above.diameterM.toFixed(2)} m) is wider than tier "${tier.id}" ` +
          `(${tier.diameterM.toFixed(2)} m) beneath it — an overhanging upper tier has no support under ` +
          `its own edge and topples rather than transmitting its load straight down.`,
      });
    }

    let loadAboveN = 0;
    let bearingAreaM2 = tierFootprintAreaM2(tier.diameterM);
    if (above) {
      let loadAboveKg = 0;
      for (let aboveIndex = index + 1; aboveIndex < tiers.length; aboveIndex += 1) {
        loadAboveKg += tierTotalMassKg(tiers[aboveIndex]!, design);
      }
      loadAboveN = loadAboveKg * GRAVITY_M_PER_S2;
      bearingAreaM2 = tierFootprintAreaM2(above.diameterM);
    }

    const crumbStrengthPa = tierCrumbStrengthPa(tier);
    const stressPa = bearingAreaM2 > 0 ? loadAboveN / bearingAreaM2 : Number.POSITIVE_INFINITY;
    const overloaded = loadAboveN > 0 && stressPa > crumbStrengthPa;
    const required = minimumDowelCount(tier.diameterM);

    if (overloaded) {
      if (!tier.dowelled) {
        problems.push({
          code: 'tier-overloaded-no-dowels',
          message:
            `tier "${tier.id}" carries ${stressPa.toFixed(0)} Pa from the tiers above it, past its own ` +
            `crumb's compressive strength of ${crumbStrengthPa.toFixed(0)} Pa — undowelled, this tier's ` +
            `crumb compresses under the board above it and the stack leans.`,
        });
      } else if (tier.dowelCount < required) {
        problems.push({
          code: 'insufficient-dowels',
          message:
            `tier "${tier.id}" is dowelled but with only ${tier.dowelCount} dowel(s); a ` +
            `${tier.diameterM.toFixed(2)} m tier carrying load from above needs at least ${required} ` +
            `to spread that load evenly and keep the board above it level.`,
        });
      }
    }

    verdicts.push({
      tierId: tier.id,
      ok: problems.length === 0,
      loadAboveN,
      bearingAreaM2,
      stressPa,
      crumbStrengthPa,
      dowelled: tier.dowelled,
      dowelCount: tier.dowelCount,
      minimumDowelCount: required,
      problems,
    });
  }

  return { ok: verdicts.every((verdict) => verdict.ok), tiers: verdicts };
}
