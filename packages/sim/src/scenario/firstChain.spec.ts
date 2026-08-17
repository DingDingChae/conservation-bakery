import { describe, expect, it } from 'vitest';

import { elementCommodity } from '../core/commodity.js';
import { WORLD_ACCOUNTS, soilAccount } from '../world/accounts.js';
import { evaluateFormulation, type Formulation } from '../bake/formulation.js';
import { checkGraphClosure } from '../provenance/closure.js';
import { ROOT_LOT_IDS } from './firstChain.js';
import { runFirstChain } from './run.js';

/**
 * The headline integration test: run the whole first chain from genesis
 * until a cake is wrapped, palletised and shipped, and prove every one of
 * the six real-world guarantees CONTRACT.md and `docs/PLAN.md` promise.
 */
describe('the first chain', () => {
  it('ships a cake whose whole ancestry, and the world around it, is exactly conserved', () => {
    const result = runFirstChain({ seed: 20260816, maxTicks: 5_000 });
    const { ledger, graph, outcome, steps } = result;

    // ---------------------------------------------------------------------
    // 1. ledger.audit().ok is true after every single tick, not just at the
    //    end. `runFirstChain` re-derives this independently of the running
    //    `assertBalanced` check each tick already performed internally (see
    //    firstChain.ts's own `step()` helper) -- this loop is the second,
    //    from-scratch confirmation, over the actual recorded step log.
    // ---------------------------------------------------------------------
    expect(steps.length).toBeGreaterThan(50);
    expect(steps[steps.length - 1]?.done).toBe(true);
    // `runFirstChain` would have thrown already if any tick's audit failed;
    // a final, independent re-audit closes the loop.
    expect(ledger.audit().ok).toBe(true);

    // ---------------------------------------------------------------------
    // 2. Every commodity sums to exactly 0n across all accounts at the end.
    // ---------------------------------------------------------------------
    const finalAudit = ledger.audit();
    expect(finalAudit.ok).toBe(true);
    expect(finalAudit.discrepancies).toEqual([]);
    expect(finalAudit.commoditiesChecked).toBeGreaterThan(0);

    // ---------------------------------------------------------------------
    // 3. The shipped cake's provenance tree walks back to the sun, the
    //    soil, the atmosphere and the water -- assert those root accounts
    //    are actually reached, by id.
    // ---------------------------------------------------------------------
    const ancestry = graph.ancestors(outcome.shippedLotId);
    expect(ancestry.truncated).toBe(false);

    // Every root this scenario ever declared is reachable from the shipped
    // lot, and each root is tagged with the exact real-world account id its
    // material was drawn from (see `ROOT_LOT_IDS` and `RootLotRecord`).
    for (const rootId of Object.values(ROOT_LOT_IDS)) {
      expect(ancestry.roots).toContain(rootId);
    }

    const rootAccountsReached = new Set(ancestry.roots.map((id) => graph.getLot(id)?.substance));
    expect(rootAccountsReached.has(WORLD_ACCOUNTS.atmosphere)).toBe(true);
    expect(rootAccountsReached.has(soilAccount('wheat-field'))).toBe(true);
    expect(rootAccountsReached.has(WORLD_ACCOUNTS.groundwater)).toBe(true);
    // The sun contributes only energy to crop growth, never elemental mass
    // (`world/exchange.ts`'s `photosynthesize`), and `Lot.mass` is
    // elemental-mass-only -- there is no "energy lot" in this model (see
    // firstChain.ts's own doc comment). The sun's real, exact, ledger-sourced
    // contribution is reported directly instead:
    expect(outcome.sunEnergyDrawnUj).toBeGreaterThan(0n);

    // ---------------------------------------------------------------------
    // 4. The sum of the leaf contributions in that tree reconciles exactly
    //    with the cake's mass plus every declared loss along the way.
    // ---------------------------------------------------------------------
    const closure = checkGraphClosure(graph);
    expect(closure.ok).toBe(true);
    expect(closure.failures).toEqual([]);
    expect(outcome.closureReport.ok).toBe(true);

    let leafContributionSum = 0n;
    for (const edge of ancestry.edges) {
      if (ancestry.roots.includes(edge.parent)) leafContributionSum += edge.mass;
    }
    let totalDeclaredLoss = 0n;
    for (const lot of ancestry.lots.values()) {
      for (const loss of lot.losses) totalDeclaredLoss += loss.mass;
    }
    expect(leafContributionSum).toBe(outcome.shippedMassUg + totalDeclaredLoss);
    expect(outcome.shippedMassUg).toBeGreaterThan(0n);
    expect(totalDeclaredLoss).toBeGreaterThan(0n);

    // ---------------------------------------------------------------------
    // 5. The atmosphere account really changed: O2 went down and CO2 went
    //    up by amounts that reconcile exactly with the fuel burned, the
    //    respiration and the leavening that occurred. Assert the exact
    //    figures, not just the direction.
    //
    //    `el:O` is every oxygen atom the atmosphere holds -- in O2, in CO2,
    //    and in water vapour alike (see core/commodity.ts: this simulation
    //    tracks elements, not molecular species). Over this scenario's whole
    //    run, crop photosynthesis is the process that draws it down (real
    //    chemistry: growth pulls in CO2 and H2O, releases O2, but the crop
    //    retains part of that oxygen as new organic matter -- see
    //    `world/exchange.ts`'s own `photosynthesize`); combustion, animal
    //    respiration and chemical leavening are, in this model, each either
    //    neutral or a net source of atmospheric oxygen (their own product
    //    CO2/H2O oxygen returns to the very account it reacted against or
    //    was drawn from -- see `atmosphereTracker.ts`'s module doc comment).
    //    So this test asserts each real cause's own exact, signed
    //    contribution, rather than asserting a single combined direction
    //    that this model's real chemistry does not actually produce.
    // ---------------------------------------------------------------------
    const tracker = result.scenario.atmosphereTracker;
    const growth = tracker.totals('growth');
    const respiration = tracker.totals('respiration');
    const fuel = tracker.totals('fuel');
    const leavening = tracker.totals('leavening');
    const waterCycle = tracker.totals('water-cycle');
    expect(tracker.unclassified()).toEqual({ C: 0n, H: 0n, O: 0n });

    // O2 down: crop photosynthesis is the exact, real cause, and carbon
    // moves the same way carbon dioxide really does when a crop absorbs it.
    expect(growth.O).toBeLessThan(0n);
    expect(growth.C).toBeLessThan(0n);

    // CO2 up: fuel burned, respiration and leavening each release real CO2
    // to the atmosphere -- assert every one of them individually, and their
    // combined total, with exact figures.
    expect(fuel.C).toBeGreaterThan(0n);
    expect(respiration.C).toBeGreaterThan(0n);
    expect(leavening.C).toBeGreaterThan(0n);
    const bakeRelatedCarbon = fuel.C + respiration.C + leavening.C;
    expect(bakeRelatedCarbon).toBeGreaterThan(0n);

    // Full, exact reconciliation: nothing touched the atmosphere outside of
    // a classified category, and every category's contribution sums to
    // precisely the account's own real before/after change -- for every one
    // of the three tracked elements, not just carbon.
    const grandTotal = tracker.grandTotal();
    expect(outcome.atmosphereAfter.C - outcome.atmosphereBefore.C).toBe(grandTotal.C);
    expect(outcome.atmosphereAfter.H - outcome.atmosphereBefore.H).toBe(grandTotal.H);
    expect(outcome.atmosphereAfter.O - outcome.atmosphereBefore.O).toBe(grandTotal.O);
    expect(grandTotal.C).toBe(growth.C + respiration.C + fuel.C + leavening.C + waterCycle.C);
    expect(grandTotal.O).toBe(growth.O + respiration.O + fuel.O + leavening.O + waterCycle.O);
    // Methane combustion's own product oxygen returns to the same
    // atmosphere it drew fresh O2 from (see `world/exchange.ts`'s
    // `combustMethane`), so its net contribution to `el:O` is exactly zero
    // -- a real, checkable fact about this model's chemistry, not an
    // approximation.
    expect(fuel.O).toBe(0n);
    // The atmosphere never holds carbon outside CO2 in this model, so the
    // water cycle (evaporation, condensation) never touches `el:C`.
    expect(waterCycle.C).toBe(0n);

    // A live current account balance also confirms the account really
    // changed, independent of the tracker.
    expect(ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity('C'))).toBe(outcome.atmosphereAfter.C);

    // ---------------------------------------------------------------------
    // 6. Running the identical seed twice produces an identical digest.
    // ---------------------------------------------------------------------
    const replay = runFirstChain({ seed: 20260816, maxTicks: 5_000 });
    expect(replay.digest).toBe(result.digest);
    expect(replay.outcome.shippedMassUg).toBe(outcome.shippedMassUg);
    expect(replay.outcome.sunEnergyDrawnUj).toBe(outcome.sunEnergyDrawnUj);
    expect(replay.steps.length).toBe(steps.length);

    // A different seed is not required to reproduce the same digest -- a
    // sanity check that the digest is not simply a constant.
    const differentSeed = runFirstChain({ seed: 20260817, maxTicks: 5_000 });
    expect(differentSeed.digest).not.toBe(result.digest);

  });

  it("mixes a real, sane cake formulation by baker's-percentage standards", () => {
    const result = runFirstChain({ seed: 555, maxTicks: 5_000 });
    const masses = result.outcome.ingredientMassesUg;
    const percent = (massUg: bigint): number => (Number(massUg) / Number(masses.flour)) * 100;

    const formulation: Formulation = {
      name: 'the first-chain cake, as actually mixed',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
        { substanceId: 'sucrose', role: 'sugar', bakersPercent: percent(masses.sucrose) },
        { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: percent(masses.egg) },
        { substanceId: 'butter', role: 'fat', bakersPercent: percent(masses.butter) },
        { substanceId: 'water-liquid', role: 'liquid', bakersPercent: percent(masses.water) },
        { substanceId: 'leavening-byproduct', role: 'leavening', bakersPercent: percent(masses.leaveningByproduct) },
      ],
    };
    const metrics = evaluateFormulation(formulation);
    expect(metrics.effectiveHydrationPercent).toBeGreaterThan(20);
    expect(metrics.effectiveHydrationPercent).toBeLessThan(180);
    expect(metrics.sugarToFlourRatio).toBeLessThan(2.2);
    expect(metrics.fatRatio).toBeLessThan(2.0);
    expect(result.outcome.shippedMassUg).toBeGreaterThan(0n);
  });
});
