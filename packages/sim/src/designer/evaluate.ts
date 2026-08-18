/**
 * The whole verdict: structure, thermal, feasibility and cost, combined into one
 * acceptance decision. A design is accepted only if it can physically stand
 * (`structure.ts`), every finish holds at the temperature it is actually applied at
 * (`thermal.ts`), and the line can actually build it from real stock in the time
 * promised (`feasibility.ts`). Cost is always computed and always reported, but never
 * gates acceptance on its own — an expensive design is still a physically buildable
 * one, and this module does not conflate the two the way a single boolean would.
 */

import { evaluateCost, type CostReport, type PriceTable } from './cost.js';
import { evaluateFeasibility, type FeasibilityReport, type Inventory, type LineCapability } from './feasibility.js';
import { evaluateStructure, type StructuralReport } from './structure.js';
import { evaluateThermal, type ThermalReport } from './thermal.js';
import type { CakeDesign } from './types.js';

export interface DesignEvaluationInputs {
  readonly inventory: Inventory;
  readonly line: LineCapability;
  readonly prices: PriceTable;
  readonly hourlyWageMinorUnits: bigint;
}

export interface DesignEvaluation {
  readonly structure: StructuralReport;
  readonly thermal: ThermalReport;
  readonly feasibility: FeasibilityReport;
  readonly cost: CostReport;
  /** True only when the design can physically stand, every finish holds, and the
   * line can build it from real stock in the promised time. */
  readonly accepted: boolean;
}

export function evaluateDesign(design: CakeDesign, inputs: DesignEvaluationInputs): DesignEvaluation {
  const structure = evaluateStructure(design);
  const thermal = evaluateThermal(design);
  const feasibility = evaluateFeasibility(design, inputs.inventory, inputs.line);
  const cost = evaluateCost(design, inputs.prices, inputs.hourlyWageMinorUnits, feasibility.totalMinutes);
  const accepted = structure.ok && thermal.ok && feasibility.ok;
  return { structure, thermal, feasibility, cost, accepted };
}
