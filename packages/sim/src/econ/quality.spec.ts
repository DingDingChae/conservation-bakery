import { describe, expect, it } from 'vitest';
import { LotGraph } from '../provenance/graph.js';
import type { Lot } from '../provenance/lot.js';
import {
  ShipmentIndex,
  condemnLot,
  evaluateCcp,
  evaluateTemperatureLog,
  requiresChangeover,
  traceRecall,
  type HaccpPlan,
} from './quality.js';

function lot(id: string, parents: readonly { lotId: string; mass: bigint }[] = []): Lot {
  return { id, substance: id, mass: 1_000n, tick: 0, process: `make:${id}`, parents, losses: [] };
}

/**
 * A small, synthetic supply/distribution graph, built directly (not through a
 * live ledger) so the recall test exercises `traceRecall` in isolation:
 *
 *   ingredient-a --\
 *                    -> mix -> batchA -> shippedA1 -> customer-1
 *   ingredient-b --/               \--> shippedA2 -> customer-2
 *
 *                                   batchB -> shippedB1 -> customer-3
 *   (batchB shares no ancestry with `mix` at all -- a control case that must
 *   never appear in a recall traced from `mix`.)
 */
function buildSyntheticGraph(): { graph: LotGraph; shipments: ShipmentIndex } {
  const graph = new LotGraph();
  graph.addLot(lot('ingredient-a'));
  graph.addLot(lot('ingredient-b'));
  graph.addLot(lot('mix', [{ lotId: 'ingredient-a', mass: 500n }, { lotId: 'ingredient-b', mass: 500n }]));
  graph.addLot(lot('batchA', [{ lotId: 'mix', mass: 1_000n }]));
  graph.addLot(lot('shippedA1', [{ lotId: 'batchA', mass: 500n }]));
  graph.addLot(lot('shippedA2', [{ lotId: 'batchA', mass: 500n }]));

  graph.addLot(lot('unrelated-ingredient'));
  graph.addLot(lot('batchB', [{ lotId: 'unrelated-ingredient', mass: 1_000n }]));
  graph.addLot(lot('shippedB1', [{ lotId: 'batchB', mass: 1_000n }]));

  const shipments = new ShipmentIndex();
  shipments.record({ lotId: 'shippedA1', customerId: 'customer-1', tick: 10 });
  shipments.record({ lotId: 'shippedA2', customerId: 'customer-2', tick: 11 });
  shipments.record({ lotId: 'shippedB1', customerId: 'customer-3', tick: 12 });

  return { graph, shipments };
}

describe('quality: recall traceability', () => {
  it('traces a recall from an intermediate lot forward to every affected customer and back to every input', () => {
    const { graph, shipments } = buildSyntheticGraph();
    const report = traceRecall(graph, shipments, 'mix');

    expect(new Set(report.upstreamLotIds)).toEqual(new Set(['ingredient-a', 'ingredient-b']));
    expect(new Set(report.downstreamLotIds)).toEqual(
      new Set(['batchA', 'shippedA1', 'shippedA2']),
    );
    expect(new Set(report.customersAffected)).toEqual(new Set(['customer-1', 'customer-2']));

    // The unrelated batch and its customer must never appear -- they share no
    // ancestry with the recalled lot at all.
    expect(report.downstreamLotIds).not.toContain('batchB');
    expect(report.downstreamLotIds).not.toContain('shippedB1');
    expect(report.customersAffected).not.toContain('customer-3');
    expect(report.truncated).toBe(false);
  });

  it('traces a recall from a leaf shipment back to every root input, forward to only itself', () => {
    const { graph, shipments } = buildSyntheticGraph();
    const report = traceRecall(graph, shipments, 'shippedA1');

    expect(new Set(report.upstreamLotIds)).toEqual(new Set(['mix', 'batchA', 'ingredient-a', 'ingredient-b']));
    expect(report.downstreamLotIds).toEqual([]);
    expect(report.customersAffected).toEqual(['customer-1']);
  });

  it('reports a shipped-to customer for the origin lot itself, even with no descendants', () => {
    const { graph, shipments } = buildSyntheticGraph();
    const report = traceRecall(graph, shipments, 'shippedB1');
    expect(report.customersAffected).toEqual(['customer-3']);
  });

  it('condemns a lot as a specification/regulatory outcome, never a health outcome', () => {
    const check = condemnLot('mix', 'temperature record outside the specified limit');
    expect(check.outcome).toBe('condemned');
    expect(check.lotId).toBe('mix');
  });
});

describe('quality: HACCP critical control points', () => {
  const plan: HaccpPlan = {
    id: 'plan-1',
    ccps: [{ id: 'core-temp', description: 'core bake temperature', parameter: 'core-temperature-c', minValue: 90, maxValue: 220 }],
  };

  it('evaluates a single reading against its CCP limits', () => {
    expect(evaluateCcp(plan.ccps[0]!, { tick: 1, ccpId: 'core-temp', valueC: 95 }).withinLimit).toBe(true);
    expect(evaluateCcp(plan.ccps[0]!, { tick: 1, ccpId: 'core-temp', valueC: 60 }).withinLimit).toBe(false);
    expect(evaluateCcp(plan.ccps[0]!, { tick: 1, ccpId: 'core-temp', valueC: 250 }).withinLimit).toBe(false);
  });

  it('skips log entries for a CCP the plan does not define', () => {
    const evaluations = evaluateTemperatureLog(plan, [{ tick: 1, ccpId: 'unknown-ccp', valueC: 999 }]);
    expect(evaluations).toEqual([]);
  });
});

describe('quality: allergen changeover', () => {
  it('requires a changeover when the next run drops an allergen the previous run carried', () => {
    expect(requiresChangeover(['gluten', 'milk'], ['gluten'])).toBe(true);
    expect(requiresChangeover(['gluten'], [])).toBe(true);
  });

  it('does not require a changeover when the next run declares the same or more allergens', () => {
    expect(requiresChangeover(['gluten'], ['gluten', 'milk'])).toBe(false);
    expect(requiresChangeover(['gluten'], ['gluten'])).toBe(false);
    expect(requiresChangeover([], ['gluten'])).toBe(false);
    expect(requiresChangeover([], [])).toBe(false);
  });
});
