/**
 * Can the line actually make this, at the rate promised?
 *
 * Two independent real constraints, each refused by name rather than silently
 * repaired:
 *
 * 1. **Equipment.** Every finishing step in `types.ts` names a real operation —
 *    depositing icing, pouring a glaze, wrapping a fondant sheet, printing an edible
 *    transfer — and every one of those operations is a named machine family in
 *    `plant/equipment/finishing.ts`. A design that calls for a step the line has no
 *    machine for is refused, naming the missing equipment, exactly the way a real shop
 *    floor would refuse a job it has no station for.
 * 2. **Time.** Each finishing operation runs at a real, bounded rate — a depositor or
 *    curtain coater processes kilograms per minute, not an instant — so a design's
 *    total finishing time is checked against the rate the line has actually promised
 *    (an order's lead time, a shift's remaining capacity). The per-operation rates
 *    below are representative order-of-magnitude figures for the class of commercial
 *    equipment named (a bench-scale icing depositor commonly runs on the order of a
 *    kilogram or two of icing a minute; a glaze curtain coater, built to flood-coat
 *    continuously, runs several times faster; hand-worked fondant wrapping and fine
 *    piping detail are markedly slower than either), not one manufacturer's spec
 *    sheet — the module states that plainly rather than implying false precision.
 *
 * 3. **Inventory.** `materials.ts`'s `designMaterialDemand` gives the real substance
 *    and mass every part of the design needs. Every gram must come from real stock —
 *    a design that needs more of a substance than the line holds is refused, naming
 *    the exact shortfall (needed, available, missing), never silently drawn from
 *    nowhere (CONTRACT.md rule 1 applies to a design's own feasibility exactly as it
 *    applies to the ledger itself, even though this check never touches a `Ledger`).
 */

import {
  EDIBLE_INK_PRINTER_DEFINITION,
  GLAZING_DEFINITION,
  ICING_DEPOSITOR_DEFINITION,
  LAYERING_LINE_DEFINITION,
} from '../plant/equipment/finishing.js';
import type { Micrograms } from '../core/commodity.js';
import { designMaterialDemand } from './materials.js';
import type { CakeDesign, FinishKind } from './types.js';

/** The machine family each finishing operation runs on — real `MachineDefinition`
 * `type` strings from `plant/equipment/finishing.ts`, not invented identifiers. */
export const FINISH_EQUIPMENT_TYPE: Readonly<Record<FinishKind, string>> = {
  crumbCoat: ICING_DEPOSITOR_DEFINITION.type,
  icing: ICING_DEPOSITOR_DEFINITION.type,
  buttercream: ICING_DEPOSITOR_DEFINITION.type,
  piping: ICING_DEPOSITOR_DEFINITION.type,
  ganache: GLAZING_DEFINITION.type,
  fondant: LAYERING_LINE_DEFINITION.type,
  transfer: EDIBLE_INK_PRINTER_DEFINITION.type,
};

/** Representative processing rate, kilograms per minute, for every finish kind except
 * `transfer` (below) — see this module's doc comment for the basis. `piping` is the
 * same depositor as `icing`/`buttercream` but run for fine detail work, far slower. */
const FINISH_RATE_KG_PER_MIN: Readonly<Record<Exclude<FinishKind, 'transfer'>, number>> = {
  crumbCoat: 3,
  icing: 1.5,
  buttercream: 1.2,
  piping: 0.3,
  ganache: 4,
  fondant: 0.4,
};

/** A printed edible transfer sheet is applied per sheet, not metered by mass — real
 * setup and print/apply time for one sheet on an edible-ink printer, representative
 * commercial figure. */
export const TRANSFER_FIXED_MINUTES = 1.5;

function finishMinutes(kind: FinishKind, massUg: Micrograms): number {
  if (kind === 'transfer') return TRANSFER_FIXED_MINUTES;
  const massKg = Number(massUg) / 1_000_000_000;
  const rate = FINISH_RATE_KG_PER_MIN[kind];
  return rate > 0 ? massKg / rate : 0;
}

export interface Inventory {
  readonly stockUg: ReadonlyMap<string, Micrograms>;
}

export interface LineCapability {
  readonly availableEquipmentTypes: ReadonlySet<string>;
  /** The rate promised for this design — minutes of finishing time available before
   * the line must move on to its next job. */
  readonly promisedMinutes: number;
}

export type FeasibilityProblemCode = 'missing-equipment' | 'insufficient-time' | 'insufficient-stock';

/**
 * Every problem carries both a real message (for a caller that just wants text) and
 * the structured numeric facts behind it — the same shape `structure.ts`'s
 * `StructuralProblem` and `thermal.ts`'s `ThermalProblem` do not yet need (their own
 * verdict objects already carry the numbers), but a feasibility problem's numbers
 * belong to the problem itself (which equipment, which substance), not to one shared
 * verdict record — so a renderer can build a register-aware rewrite (the Kid register
 * explaining a shortfall in plain language) from real values without re-parsing this
 * module's own English sentence.
 */
export type FeasibilityProblem =
  | { readonly code: 'missing-equipment'; readonly equipmentType: string; readonly message: string }
  | { readonly code: 'insufficient-time'; readonly neededMinutes: number; readonly promisedMinutes: number; readonly message: string }
  | {
      readonly code: 'insufficient-stock';
      readonly substanceId: string;
      readonly neededUg: Micrograms;
      readonly availableUg: Micrograms;
      readonly shortfallUg: Micrograms;
      readonly message: string;
    };

export interface FeasibilityReport {
  readonly ok: boolean;
  readonly totalMinutes: number;
  readonly problems: readonly FeasibilityProblem[];
}

export function evaluateFeasibility(design: CakeDesign, inventory: Inventory, line: LineCapability): FeasibilityReport {
  const problems: FeasibilityProblem[] = [];
  const missingEquipment = new Set<string>();
  let totalMinutes = 0;

  for (const tier of design.tiers) {
    for (const finish of tier.finishes) {
      const equipmentType = FINISH_EQUIPMENT_TYPE[finish.kind];
      if (!line.availableEquipmentTypes.has(equipmentType)) missingEquipment.add(equipmentType);
      totalMinutes += finishMinutes(finish.kind, finish.massUg);
    }
  }

  for (const equipmentType of [...missingEquipment].sort()) {
    problems.push({
      code: 'missing-equipment',
      equipmentType,
      message: `this design calls for a "${equipmentType}" step, and the line has no machine of that type.`,
    });
  }

  if (totalMinutes > line.promisedMinutes) {
    problems.push({
      code: 'insufficient-time',
      neededMinutes: totalMinutes,
      promisedMinutes: line.promisedMinutes,
      message:
        `finishing this design takes ${totalMinutes.toFixed(1)} min, past the ${line.promisedMinutes.toFixed(1)} min ` +
        `the line has actually promised for it — ${(totalMinutes - line.promisedMinutes).toFixed(1)} min short.`,
    });
  }

  for (const demandLine of designMaterialDemand(design)) {
    const available = inventory.stockUg.get(demandLine.substanceId) ?? 0n;
    if (demandLine.massUg > available) {
      const shortfallUg = demandLine.massUg - available;
      problems.push({
        code: 'insufficient-stock',
        substanceId: demandLine.substanceId,
        neededUg: demandLine.massUg,
        availableUg: available,
        shortfallUg,
        message:
          `this design needs ${formatGrams(demandLine.massUg)} g of "${demandLine.substanceId}", but stock holds ` +
          `only ${formatGrams(available)} g — ${formatGrams(shortfallUg)} g short.`,
      });
    }
  }

  return { ok: problems.length === 0, totalMinutes, problems };
}

/** Grams to one decimal place, for a refusal message — display only, never fed back
 * into a computation, so an ordinary `number` division is fine here. */
function formatGrams(massUg: Micrograms): string {
  return (Number(massUg) / 1_000_000).toFixed(1);
}
