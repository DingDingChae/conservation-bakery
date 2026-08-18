/**
 * HACCP: critical control points, allergen segregation and changeover,
 * temperature logs, and lot traceability that can trace a recall forward to
 * every customer and back to every input.
 *
 * A lot that fails its specification is condemned; the story ends there —
 * see CONTRACT.md rule 2. Nothing in this file models a person's health.
 *
 * Traceability is built entirely on `provenance/graph.ts`'s `LotGraph`: this
 * module never re-implements ancestor/descendant traversal, it only adds the
 * one piece `LotGraph` does not know about — which lot was shipped to which
 * customer — and reports the two walks it already provides as a single
 * recall report.
 */

import type { LotGraph } from '../provenance/graph.js';
import type { LotId } from '../provenance/lot.js';

// ---------------------------------------------------------------------------
// HACCP plan and critical control points.
// ---------------------------------------------------------------------------

export interface CriticalControlPoint {
  readonly id: string;
  readonly description: string;
  /** What is measured — e.g. "core-temperature-c", "hold-time-s". */
  readonly parameter: string;
  readonly minValue?: number;
  readonly maxValue?: number;
}

export interface HaccpPlan {
  readonly id: string;
  readonly ccps: readonly CriticalControlPoint[];
}

export interface TemperatureLogEntry {
  readonly tick: number;
  readonly ccpId: string;
  readonly valueC: number;
}

export interface CcpEvaluation {
  readonly ccpId: string;
  readonly tick: number;
  readonly valueC: number;
  readonly withinLimit: boolean;
}

export function evaluateCcp(ccp: CriticalControlPoint, entry: TemperatureLogEntry): CcpEvaluation {
  const withinLimit =
    (ccp.minValue === undefined || entry.valueC >= ccp.minValue) &&
    (ccp.maxValue === undefined || entry.valueC <= ccp.maxValue);
  return { ccpId: ccp.id, tick: entry.tick, valueC: entry.valueC, withinLimit };
}

/** Evaluate every logged reading against the plan's own limit for its CCP.
 * A reading for a CCP not on the plan is silently skipped — this function
 * reports conformance, it does not audit whether the log itself is complete. */
export function evaluateTemperatureLog(
  plan: HaccpPlan,
  log: readonly TemperatureLogEntry[],
): readonly CcpEvaluation[] {
  const byId = new Map(plan.ccps.map((ccp) => [ccp.id, ccp] as const));
  const evaluations: CcpEvaluation[] = [];
  for (const entry of log) {
    const ccp = byId.get(entry.ccpId);
    if (!ccp) continue;
    evaluations.push(evaluateCcp(ccp, entry));
  }
  return evaluations;
}

// ---------------------------------------------------------------------------
// Allergen segregation and changeover.
// ---------------------------------------------------------------------------

export const ALLERGENS = ['gluten', 'egg', 'milk', 'soy', 'tree-nuts', 'peanuts', 'sesame'] as const;
export type Allergen = (typeof ALLERGENS)[number];

export interface AllergenProfile {
  readonly substanceId: string;
  readonly allergens: readonly Allergen[];
}

/**
 * True whenever switching from a run declaring `previous` allergens to one
 * declaring `next` needs a full allergen changeover (clean-down) before the
 * new run may start — i.e. whenever `previous` carried an allergen `next`
 * does not declare, which is exactly the cross-contact risk a changeover
 * exists to remove. Declaring the same allergens, a subset, or additional
 * allergens the previous run did not have needs no changeover on this
 * account (the new run's own declaration already covers them).
 */
export function requiresChangeover(previous: readonly Allergen[], next: readonly Allergen[]): boolean {
  const nextSet = new Set(next);
  return previous.some((allergen) => !nextSet.has(allergen));
}

// ---------------------------------------------------------------------------
// Lot traceability and recall.
// ---------------------------------------------------------------------------

export interface ShipmentRecord {
  readonly lotId: LotId;
  readonly customerId: string;
  readonly tick: number;
}

/** Which lot went to which customer — the one fact `LotGraph` itself does
 * not carry, because a `Lot` is provenance, not a sales record. */
export class ShipmentIndex {
  readonly #byLot = new Map<LotId, ShipmentRecord[]>();

  record(shipment: ShipmentRecord): void {
    const existing = this.#byLot.get(shipment.lotId);
    if (existing) existing.push(shipment);
    else this.#byLot.set(shipment.lotId, [shipment]);
  }

  shipmentsOf(lotId: LotId): readonly ShipmentRecord[] {
    return this.#byLot.get(lotId) ?? [];
  }

  all(): readonly ShipmentRecord[] {
    return [...this.#byLot.values()].flat();
  }
}

export interface RecallReport {
  readonly originLotId: LotId;
  /** Every lot that contributed material to the origin lot — the back-trace
   * to every input, from `LotGraph.ancestors`. */
  readonly upstreamLotIds: readonly LotId[];
  /** Every lot the origin lot's material went on to become — the
   * forward-trace to every affected output, from `LotGraph.descendants`. */
  readonly downstreamLotIds: readonly LotId[];
  /** Every customer any downstream lot (or the origin lot itself) was
   * actually shipped to. */
  readonly customersAffected: readonly string[];
  /** True if either walk hit a traversal cap before it could finish — see
   * `provenance/graph.ts`'s own `WalkResult.truncated`. A caller must not
   * treat a truncated recall as complete. */
  readonly truncated: boolean;
}

/**
 * Trace a recall both directions from `originLotId`: back to every lot that
 * fed into it, and forward to every lot (and therefore every customer) it
 * fed into. Every id this returns is one `LotGraph` already vouches for —
 * this function performs no traversal of its own, only re-shapes the two
 * `LotGraph` walks into one report and cross-references `shipments`.
 */
export function traceRecall(graph: LotGraph, shipments: ShipmentIndex, originLotId: LotId): RecallReport {
  const ancestors = graph.ancestors(originLotId);
  const descendants = graph.descendants(originLotId);

  const upstreamLotIds = [...ancestors.lots.keys()].filter((id) => id !== originLotId);
  const downstreamLotIds = [...descendants.lots.keys()].filter((id) => id !== originLotId);

  const customers = new Set<string>();
  for (const lotId of [originLotId, ...downstreamLotIds]) {
    for (const shipment of shipments.shipmentsOf(lotId)) customers.add(shipment.customerId);
  }

  return {
    originLotId,
    upstreamLotIds,
    downstreamLotIds,
    customersAffected: [...customers],
    truncated: ancestors.truncated || descendants.truncated,
  };
}

// ---------------------------------------------------------------------------
// Conformance outcomes: specification and regulatory non-conformance only.
// ---------------------------------------------------------------------------

export type ConformanceOutcome = 'conforming' | 'condemned';

export interface ConformanceCheck {
  readonly lotId: LotId;
  readonly outcome: ConformanceOutcome;
  readonly reason?: string;
}

/** A lot fails its specification and is withdrawn; the story ends there. */
export function condemnLot(lotId: LotId, reason: string): ConformanceCheck {
  return { lotId, outcome: 'condemned', reason };
}
