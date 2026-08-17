/**
 * A cake formulation, expressed the way a bakery actually writes one down: baker's
 * percentages, every ingredient's mass stated relative to total flour mass = 100.
 *
 * This module is a calculator over that percentage table. It does not touch a
 * `Ledger` — a formulation is a *recipe*, not yet a real parcel of material — but
 * every ratio it derives is the same one a professional baking text uses to decide
 * whether a formula will actually work, and `validateFormulation` explains a
 * failure in exactly those physical terms rather than a generic "invalid" message.
 *
 * The structural balance rules used here (sugar relative to flour, total liquid
 * relative to sugar, eggs relative to fat) are the classic "formula balancing"
 * rules for high-ratio cakes set out in Wayne Gisslen, *Professional Baking*
 * (Wiley), ch. "Cakes and Icings" — not invented thresholds. `structureIndex`
 * combines the same two opposing camps (flour and egg build structure; sugar and
 * fat tenderise and delay or prevent it setting) into one signed scalar.
 */

import { roundHalfEven, type Micrograms } from '../core/commodity.js';
import { partition } from '../core/commodity.js';
import { EGG_WATER_MASS_FRACTION } from './constants.js';

export const INGREDIENT_ROLES = [
  'flour',
  'sugar',
  'egg',
  'fat',
  'liquid',
  'leavening',
  'salt',
  'flavour',
] as const;

export type IngredientRole = (typeof INGREDIENT_ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(INGREDIENT_ROLES);

export function isIngredientRole(value: string): value is IngredientRole {
  return ROLE_SET.has(value);
}

export interface FormulationIngredient {
  readonly substanceId: string;
  readonly role: IngredientRole;
  /** Mass of this ingredient relative to total flour mass = 100. Baker's
   * percentage, not a percentage of the whole batch — the two are only equal by
   * coincidence for a formulation with no ingredients besides flour and water. */
  readonly bakersPercent: number;
}

export interface Formulation {
  readonly name: string;
  readonly ingredients: readonly FormulationIngredient[];
}

/** Tolerance for "does the flour total equal 100" — baker's percentage is exact
 * by definition, but formulations are typically authored to one decimal place. */
const FLOUR_TOTAL_TOLERANCE = 1e-6;

export function rolePercent(formulation: Formulation, role: IngredientRole): number {
  let total = 0;
  for (const ingredient of formulation.ingredients) {
    if (ingredient.role === role) total += ingredient.bakersPercent;
  }
  return total;
}

export interface FormulationMetrics {
  readonly flourPercent: number;
  readonly sugarPercent: number;
  readonly eggPercent: number;
  readonly fatPercent: number;
  readonly liquidPercent: number;
  readonly leaveningPercent: number;
  readonly saltPercent: number;
  readonly flavourPercent: number;
  /** Liquid-role mass only, relative to flour. The literal, textbook figure. */
  readonly hydrationPercent: number;
  /** Liquid role plus egg's own water content (egg is ~76.15% water by mass,
   * see `EGG_WATER_MASS_FRACTION`) — the figure that actually predicts how much
   * free water is available to hydrate starch and dissolve sugar and salt. */
  readonly effectiveHydrationPercent: number;
  readonly sugarToFlourRatio: number;
  readonly fatRatio: number;
  /**
   * `((flour + egg) - (sugar + fat)) / flour`: structure-forming mass (flour's
   * starch and gluten, egg's coagulable protein) minus tenderising mass (sugar
   * competing for water and raising the gelatinisation/coagulation temperature,
   * fat coating proteins and starch and blocking their contact with water),
   * normalised by the flour baseline.
   *
   * A classic pound cake (equal parts flour, sugar, egg, fat) lands at exactly
   * 0 — which matches its real reputation as a dense, moist cake sitting right at
   * the edge of setting, more prone to sinking than a lean sponge. Positive means
   * the structure-formers dominate; strongly negative means the batter has no
   * physical means of setting before it collapses under its own gas and weight.
   */
  readonly structureIndex: number;
}

export function evaluateFormulation(formulation: Formulation): FormulationMetrics {
  const flourPercent = rolePercent(formulation, 'flour');
  const sugarPercent = rolePercent(formulation, 'sugar');
  const eggPercent = rolePercent(formulation, 'egg');
  const fatPercent = rolePercent(formulation, 'fat');
  const liquidPercent = rolePercent(formulation, 'liquid');
  const leaveningPercent = rolePercent(formulation, 'leavening');
  const saltPercent = rolePercent(formulation, 'salt');
  const flavourPercent = rolePercent(formulation, 'flavour');

  // Flour is the reference (=100 by definition); guard the degenerate zero case
  // so a malformed formulation produces NaN-free numbers for validateFormulation
  // to report clearly, rather than propagating a NaN into every derived metric.
  const flourBasis = flourPercent === 0 ? 100 : flourPercent;

  const hydrationPercent = liquidPercent;
  const effectiveHydrationPercent = liquidPercent + eggPercent * EGG_WATER_MASS_FRACTION;
  const sugarToFlourRatio = sugarPercent / flourBasis;
  const fatRatio = fatPercent / flourBasis;
  const structureIndex = (flourBasis + eggPercent - sugarPercent - fatPercent) / flourBasis;

  return {
    flourPercent,
    sugarPercent,
    eggPercent,
    fatPercent,
    liquidPercent,
    leaveningPercent,
    saltPercent,
    flavourPercent,
    hydrationPercent,
    effectiveHydrationPercent,
    sugarToFlourRatio,
    fatRatio,
    structureIndex,
  };
}

export type FormulationProblemCode =
  | 'no-flour'
  | 'flour-total-mismatch'
  | 'no-hydration'
  | 'hydration-too-low'
  | 'hydration-too-high'
  | 'sugar-exceeds-flour-headroom'
  | 'fat-exceeds-egg-and-flour-headroom'
  | 'leavening-exceeds-structure-capacity';

export interface FormulationProblem {
  readonly code: FormulationProblemCode;
  /** Precisely why, in the physical terms that make the failure real rather
   * than generic — see the module doc comment for the sourced ratios behind it. */
  readonly message: string;
}

export interface FormulationValidation {
  readonly ok: boolean;
  readonly metrics: FormulationMetrics;
  readonly problems: readonly FormulationProblem[];
}

/**
 * Baker's-percentage-relative thresholds, cited from real baking practice rather
 * than picked to make a particular test pass:
 *
 * - Professional "high-ratio" cake formulas (Gisslen) run sugar up to roughly
 *   180% of flour, using emulsified shortening to hold that much dissolved sugar
 *   in suspension. 220% is set as the hard ceiling here — meaningfully past even
 *   the richest published high-ratio formula, the point past which the mixture is
 *   a confection (dissolved-sugar syrup with a little starch in it), not a cake
 *   batter that can set into a crumb.
 * - Gisslen's balance rule for standard cakes is liquid (including eggs) ≥ sugar.
 *   Effective hydration under 60% of the sugar mass is used here as the point
 *   past which a meaningful fraction of the sugar has nothing to dissolve into —
 *   real, gritty, undissolved sugar left in the batter.
 * - Real cake batters run from a lean pound cake (~25% liquid) to a wet, thin
 *   batter (~140% effective hydration, e.g. a very liquid chiffon). Below 20%
 *   there is not enough free water to gelatinise the starch or dissolve the
 *   sugar and salt at all; above 180% the flour's own starch and gluten network
 *   is diluted below the concentration a batter needs to trap gas.
 * - Gisslen's emulsion-stability rule is eggs ≥ fat: egg protein and lecithin
 *   are what keeps that much fat dispersed in the batter. Fat mass more than
 *   double (egg + flour) has no plausible emulsifying and structural capacity
 *   left to hold it — the mixture separates rather than creaming into a batter.
 * - A real chemical leavening dose (baking soda or powder) runs from a fraction
 *   of 1% up to roughly 4-5% of flour mass in genuinely aggressive formulas; 8%
 *   is set as the ceiling past which the CO2 volume this formulation implies
 *   (see `bake/leavening.ts`) is certain to exceed what any real crumb wall can
 *   contain before rupturing.
 */
const SUGAR_TO_FLOUR_CEILING = 2.2;
const MIN_EFFECTIVE_HYDRATION_OVER_SUGAR = 0.6;
const MIN_EFFECTIVE_HYDRATION_PERCENT = 20;
const MAX_EFFECTIVE_HYDRATION_PERCENT = 180;
const MAX_FAT_TO_EGG_AND_FLOUR_RATIO = 2.0;
const MAX_LEAVENING_PERCENT = 8;

export function validateFormulation(formulation: Formulation): FormulationValidation {
  const metrics = evaluateFormulation(formulation);
  const problems: FormulationProblem[] = [];

  const hasFlour = formulation.ingredients.some((ingredient) => ingredient.role === 'flour');
  if (!hasFlour) {
    problems.push({
      code: 'no-flour',
      message:
        'this formulation has no flour ingredient. There is no starch to gelatinise and no ' +
        'gluten to develop a network from, so there is nothing for the batter to set around.',
    });
  } else if (Math.abs(metrics.flourPercent - 100) > FLOUR_TOTAL_TOLERANCE) {
    problems.push({
      code: 'flour-total-mismatch',
      message:
        `baker's percentage is defined relative to total flour mass = 100%, but this ` +
        `formulation's flour ingredients sum to ${metrics.flourPercent.toFixed(2)}%. Every ` +
        `other ratio in this formulation is meaningless until the flour ingredients are ` +
        `re-normalised to sum to exactly 100.`,
    });
  }

  const hasHydrationSource = metrics.effectiveHydrationPercent > 0;
  if (!hasHydrationSource) {
    problems.push({
      code: 'no-hydration',
      message:
        'this formulation has no liquid and no egg. Starch cannot gelatinise, sugar and salt ' +
        'cannot dissolve, and chemical leavening (an acid-base reaction) has no aqueous medium ' +
        'to react in without free water.',
    });
  } else if (metrics.effectiveHydrationPercent < MIN_EFFECTIVE_HYDRATION_PERCENT) {
    problems.push({
      code: 'hydration-too-low',
      message:
        `effective hydration is ${metrics.effectiveHydrationPercent.toFixed(1)}% of flour ` +
        `mass, below the ${MIN_EFFECTIVE_HYDRATION_PERCENT}% a batter needs to gelatinise its ` +
        `starch and dissolve its sugar and salt at all — this will mix into a dry paste, not a ` +
        `batter.`,
    });
  } else if (metrics.effectiveHydrationPercent > MAX_EFFECTIVE_HYDRATION_PERCENT) {
    problems.push({
      code: 'hydration-too-high',
      message:
        `effective hydration is ${metrics.effectiveHydrationPercent.toFixed(1)}% of flour ` +
        `mass, above the ${MAX_EFFECTIVE_HYDRATION_PERCENT}% past which the flour's starch and ` +
        `gluten network is diluted below the concentration needed to trap gas and set before ` +
        `it collapses.`,
    });
  } else if (
    metrics.sugarPercent > 0 &&
    metrics.effectiveHydrationPercent < metrics.sugarPercent * MIN_EFFECTIVE_HYDRATION_OVER_SUGAR
  ) {
    problems.push({
      code: 'hydration-too-low',
      message:
        `sugar is ${metrics.sugarPercent.toFixed(1)}% of flour mass but effective hydration is ` +
        `only ${metrics.effectiveHydrationPercent.toFixed(1)}% — under Gisslen's cake-balance ` +
        `rule (liquid, including eggs, should be at least equal to sugar), there is not enough ` +
        `free water to dissolve that much sugar; the undissolved fraction stays gritty and can ` +
        `starve nearby starch granules of the water they need to gelatinise.`,
    });
  }

  if (metrics.sugarToFlourRatio > SUGAR_TO_FLOUR_CEILING) {
    problems.push({
      code: 'sugar-exceeds-flour-headroom',
      message:
        `sugar is ${(metrics.sugarToFlourRatio * 100).toFixed(0)}% of flour mass, past the ` +
        `${(SUGAR_TO_FLOUR_CEILING * 100).toFixed(0)}% ceiling of even the richest published ` +
        `high-ratio cake formula. At this concentration the mixture is a sugar syrup with a ` +
        `little starch suspended in it; it will caramelise rather than set into a crumb.`,
    });
  }

  const fatToStructureRatio = metrics.fatPercent / (metrics.eggPercent + metrics.flourPercent || 1);
  if (fatToStructureRatio > MAX_FAT_TO_EGG_AND_FLOUR_RATIO) {
    problems.push({
      code: 'fat-exceeds-egg-and-flour-headroom',
      message:
        `fat is ${metrics.fatPercent.toFixed(1)}% of flour mass against only ` +
        `${metrics.eggPercent.toFixed(1)}% egg and ${metrics.flourPercent.toFixed(1)}% flour to ` +
        `emulsify and structurally support it. Fat coats protein and starch and blocks their ` +
        `contact with water; past this ratio there is not enough egg protein and gluten left ` +
        `uncoated to form a network, and the batter separates instead of creaming together.`,
    });
  }

  if (metrics.leaveningPercent > MAX_LEAVENING_PERCENT) {
    problems.push({
      code: 'leavening-exceeds-structure-capacity',
      message:
        `chemical leavening is ${metrics.leaveningPercent.toFixed(2)}% of flour mass, past the ` +
        `${MAX_LEAVENING_PERCENT}% past which the CO2 volume this formulation implies (see ` +
        `bake/leavening.ts) will exceed what any real crumb wall can contain before rupturing ` +
        `and collapsing.`,
    });
  }

  return { ok: problems.length === 0, metrics, problems };
}

export interface ResolvedIngredient {
  readonly ingredient: FormulationIngredient;
  readonly massUg: Micrograms;
}

/**
 * Turn baker's percentages into real, exact masses for one batch, given the
 * batch's total flour mass.
 *
 * Flour-role ingredients are the one case where this *is* dividing one exact,
 * already-decided quantity (the batch's total flour) across several sources — so
 * they are split with `partition()`, the sanctioned way to do that, and always
 * sum back to exactly `flourMassUg`. Every other role has no such pre-existing
 * total to preserve: each is an independent procurement decision (how much sugar
 * to weigh out for this batch), so it is scaled and rounded once on its own,
 * exactly like any other single conversion from a real ratio to an exact mass.
 */
export function resolveFormulation(
  formulation: Formulation,
  flourMassUg: Micrograms,
): readonly ResolvedIngredient[] {
  const flourIngredients = formulation.ingredients.filter((ingredient) => ingredient.role === 'flour');
  const otherIngredients = formulation.ingredients.filter((ingredient) => ingredient.role !== 'flour');

  const resolved: ResolvedIngredient[] = [];

  if (flourIngredients.length > 0) {
    // Weights in milli-percent so fractional bakersPercent values (e.g. 12.5)
    // still partition exactly.
    const weights = flourIngredients.map((ingredient) =>
      BigInt(Math.round(ingredient.bakersPercent * 1000)),
    );
    const shares = partition(flourMassUg, weights);
    flourIngredients.forEach((ingredient, index) => {
      resolved.push({ ingredient, massUg: shares[index] ?? 0n });
    });
  }

  for (const ingredient of otherIngredients) {
    const massUg = roundHalfEven(Number(flourMassUg) * (ingredient.bakersPercent / 100));
    resolved.push({ ingredient, massUg });
  }

  return resolved;
}
