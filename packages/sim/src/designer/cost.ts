/**
 * The real material and time cost of a design, from the real economy in `econ/`.
 *
 * Material cost reuses `econ/market.ts`'s own `priceForMass` — the single rounding
 * boundary between a market price and an exact cash amount everywhere else in this
 * simulation already uses — applied to `materials.ts`'s real per-substance demand, so
 * a gram costed here is the exact same gram `feasibility.ts` checked against stock.
 * Labour cost is the design's own finishing time (from `feasibility.ts`'s real
 * per-operation rates) at a real hourly wage, the same `Worker.hourlyWageMinorUnits`
 * shape `econ/staff.ts` already uses for every other paid task in this simulation.
 *
 * A design is never costed with an invented price. A substance with no entry in the
 * price table is reported honestly as unpriced (`MaterialCostLine.priced: false`,
 * `CostReport.complete: false`) rather than silently treated as free.
 */

import { priceForMass } from '../econ/market.js';
import type { Micrograms } from '../core/commodity.js';
import { roundHalfEven } from '../core/commodity.js';
import { designMaterialDemand } from './materials.js';
import type { CakeDesign } from './types.js';

export interface PriceTable {
  readonly pricePerKgMinorUnitsBySubstance: ReadonlyMap<string, bigint>;
}

export interface MaterialCostLine {
  readonly substanceId: string;
  readonly massUg: Micrograms;
  readonly priced: boolean;
  readonly costMinorUnits: bigint;
}

export interface CostReport {
  readonly materialCostMinorUnits: bigint;
  readonly laborCostMinorUnits: bigint;
  readonly totalCostMinorUnits: bigint;
  readonly lines: readonly MaterialCostLine[];
  /** False when at least one material line has no price on record — the total is a
   * real partial sum, not a false "this is the whole cost" figure. */
  readonly complete: boolean;
}

/**
 * `finishingMinutes` is the design's own finishing time — pass
 * `feasibility.ts`'s `evaluateFeasibility(...).totalMinutes` for the real figure
 * (kept as a parameter rather than recomputed here, so this module stays independent
 * of `feasibility.ts` and a caller that already has the feasibility report does not
 * pay for the same walk twice).
 */
export function evaluateCost(
  design: CakeDesign,
  prices: PriceTable,
  hourlyWageMinorUnits: bigint,
  finishingMinutes: number,
): CostReport {
  const lines: MaterialCostLine[] = [];
  let materialCostMinorUnits = 0n;
  let complete = true;

  for (const demand of designMaterialDemand(design)) {
    const pricePerKg = prices.pricePerKgMinorUnitsBySubstance.get(demand.substanceId);
    const priced = pricePerKg !== undefined;
    const costMinorUnits = priced ? priceForMass(pricePerKg, demand.massUg) : 0n;
    if (!priced) complete = false;
    materialCostMinorUnits += costMinorUnits;
    lines.push({ substanceId: demand.substanceId, massUg: demand.massUg, priced, costMinorUnits });
  }

  const laborCostMinorUnits = roundHalfEven((finishingMinutes / 60) * Number(hourlyWageMinorUnits));
  const totalCostMinorUnits = materialCostMinorUnits + laborCostMinorUnits;

  return { materialCostMinorUnits, laborCostMinorUnits, totalCostMinorUnits, lines, complete };
}
