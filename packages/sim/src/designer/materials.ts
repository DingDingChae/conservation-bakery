/**
 * What this design actually demands, in real substances and real masses — the one
 * derivation `feasibility.ts` (checked against real inventory) and `cost.ts` (priced
 * from the real economy) both build on, so a gram counted as available is the same
 * gram counted as costed.
 *
 * A `DesignLayer` states its own real total mass, not its flour mass, because that is
 * how a designer actually specifies a layer ("this tier's sponge weighs 900 g"). To
 * resolve it into real per-ingredient masses via `bake/formulation.ts`'s own
 * `resolveFormulation` (which wants a flour mass to scale baker's percentages from),
 * this module first inverts the scaling: baker's percentage sums every role's
 * percentage relative to flour = 100, so the flour mass that produces exactly
 * `layer.massUg` once every role is included is `layer.massUg * 100 / totalPercent`.
 */

import { roundHalfEven, type Micrograms } from '../core/commodity.js';
import { evaluateFormulation, resolveFormulation } from '../bake/formulation.js';
import type { CakeDesign, DesignLayer } from './types.js';

function layerFlourMassUg(layer: DesignLayer): Micrograms {
  const metrics = evaluateFormulation(layer.formulation);
  const totalPercent =
    metrics.flourPercent +
    metrics.sugarPercent +
    metrics.eggPercent +
    metrics.fatPercent +
    metrics.liquidPercent +
    metrics.leaveningPercent +
    metrics.saltPercent +
    metrics.flavourPercent;
  if (totalPercent <= 0) return 0n;
  return roundHalfEven((Number(layer.massUg) * 100) / totalPercent);
}

export interface MaterialDemandLine {
  readonly substanceId: string;
  readonly massUg: Micrograms;
}

/** Every real substance this design demands, by id, summed across every layer's own
 * resolved ingredients, every filling, every finish and every topper. */
export function designMaterialDemand(design: CakeDesign): readonly MaterialDemandLine[] {
  const totals = new Map<string, Micrograms>();
  const add = (substanceId: string, massUg: Micrograms): void => {
    totals.set(substanceId, (totals.get(substanceId) ?? 0n) + massUg);
  };

  for (const tier of design.tiers) {
    for (const layer of tier.layers) {
      const flourMassUg = layerFlourMassUg(layer);
      for (const resolved of resolveFormulation(layer.formulation, flourMassUg)) {
        add(resolved.ingredient.substanceId, resolved.massUg);
      }
    }
    for (const filling of tier.fillings) add(filling.substanceId, filling.massUg);
    for (const finish of tier.finishes) add(finish.substanceId, finish.massUg);
  }
  for (const topper of design.toppers) add(topper.substanceId, topper.massUg);

  return [...totals.entries()].map(([substanceId, massUg]) => ({ substanceId, massUg }));
}
