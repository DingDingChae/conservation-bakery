/**
 * A headless runner for the first-chain scenario: advance it a bounded
 * number of ticks and report the final state plus a stable digest.
 *
 * `packages/sim` never formats a string for display (see
 * `docs/ARCHITECTURE.md`'s "the seam"). This module's job stops at handing
 * back plain data — `Ledger`, `LotGraph`, the outcome, and a digest a replay
 * tool or another run can compare against, byte for byte.
 */

import { canonicalize, digest, type Digestible } from '../clock/digest.js';
import type { Ledger } from '../core/ledger.js';
import type { LotGraph } from '../provenance/graph.js';
import type { FirstChainOutcome, FirstChainSeed, FirstChainStep } from './firstChain.js';
import { FirstChainScenario } from './firstChain.js';

export interface FirstChainRunResult {
  readonly scenario: FirstChainScenario;
  readonly ledger: Ledger;
  readonly graph: LotGraph;
  readonly outcome: FirstChainOutcome;
  /** Every intermediate step the scenario reported, in order — the record a
   * caller checks "audit ok after every single tick" against. */
  readonly steps: readonly FirstChainStep[];
  readonly digest: string;
}

/**
 * A canonical, order-independent snapshot of a scenario's state: every
 * account's balance of every commodity it holds, plus the lot graph's own
 * lots (already insertion-ordered, i.e. deterministic — see
 * `LotGraph.lots()`). Two runs built from the same seed produce identical
 * snapshots from this; two runs that differ in even one microgram, anywhere,
 * do not.
 */
function snapshotState(ledger: Ledger, graph: LotGraph): Digestible {
  const accountState = new Map<string, Digestible>();
  for (const accountId of ledger.accountIds()) {
    const balances = ledger.balances(accountId);
    if (balances.size === 0) continue;
    const commodityState = new Map<string, Digestible>();
    for (const [commodity, amount] of balances) commodityState.set(commodity, amount);
    accountState.set(accountId, commodityState);
  }

  const lotState: Digestible[] = graph.lots().map((lot) => ({
    id: lot.id,
    substance: lot.substance,
    mass: lot.mass,
    tick: lot.tick,
    process: lot.process,
    parents: lot.parents.map((parent) => ({ lotId: parent.lotId, mass: parent.mass })),
    losses: lot.losses.map((loss) => ({ reason: loss.reason, mass: loss.mass })),
  }));

  return { accounts: accountState, lots: lotState, postingCount: ledger.postingCount };
}

/** A stable hex digest of `snapshotState` — see that function's doc comment. */
export function digestFirstChainState(ledger: Ledger, graph: LotGraph): string {
  return digest(snapshotState(ledger, graph));
}

/** Only exported so a caller can inspect the exact canonical text a digest
 * was computed from, e.g. when debugging a determinism mismatch. */
export function canonicalFirstChainState(ledger: Ledger, graph: LotGraph): string {
  return canonicalize(snapshotState(ledger, graph));
}

/**
 * Run the first-chain scenario from genesis until it ships (or `maxTicks` is
 * exhausted, whichever comes first), asserting the ledger is balanced after
 * every single tick along the way — not merely at the end. Throws if the
 * scenario has not shipped within `maxTicks`, since a scenario that never
 * finishes is a real failure, not something a longer timeout should paper
 * over.
 */
export function runFirstChain(options: FirstChainSeed & { readonly maxTicks?: number }): FirstChainRunResult {
  const maxTicks = options.maxTicks ?? 5_000;
  const scenario = new FirstChainScenario(options);
  const steps: FirstChainStep[] = [];

  for (let i = 0; i < maxTicks; i += 1) {
    const step = scenario.tick();
    steps.push(step);
    // `assertBalanced` already ran inside every yielded step (see
    // firstChain.ts's own `step()` helper); re-derive it here too, from
    // scratch, independent of that running check — the same
    // belt-and-suspenders relationship `Ledger.audit()` has with `post()`.
    const audit = scenario.ledger.audit();
    if (!audit.ok) {
      throw new Error(
        `conservation failure after tick ${step.index} (${step.phase}): ` +
          JSON.stringify(audit.discrepancies),
      );
    }
    if (step.done) break;
  }

  if (!scenario.done) {
    throw new Error(`first-chain scenario did not ship within ${maxTicks} ticks`);
  }

  return {
    scenario,
    ledger: scenario.ledger,
    graph: scenario.graph,
    outcome: scenario.outcome,
    steps,
    digest: digestFirstChainState(scenario.ledger, scenario.graph),
  };
}
