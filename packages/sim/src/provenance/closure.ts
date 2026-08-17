/**
 * Closure: the provenance-layer audit.
 *
 * A lot graph is not the ledger — it is a derived, human-facing view of *how*
 * material moved, not the mechanism that enforces conservation (that is
 * `Ledger.post`, which rejects an unbalanced posting before it is ever applied).
 * But the graph can still be wrong: a process could declare a lot's parents
 * incorrectly even while every posting it made was individually balanced against
 * accounts the graph never sees. Closure is the check that a lot's declared
 * parentage actually accounts for its own mass, hop by hop.
 *
 * The invariant, for every non-root lot:
 *
 *     Σ (mass contributed by each immediate parent)  ===  own mass + Σ (declared losses)
 *
 * Root lots (no parents — material that entered the lot graph directly from a
 * ledger reservoir or external account) are exempt: their conservation is the
 * ledger's `audit()`, not this one. See `lot.ts` for why a root has no parents.
 */

import type { Lot, LotId } from './lot.js';
import type { LotGraph } from './graph.js';

export interface ClosureFailure {
  readonly lotId: LotId;
  /** Sum of the mass declared as contributed by this lot's immediate parents. */
  readonly parentTotal: bigint;
  /** This lot's own mass. */
  readonly ownMass: bigint;
  /** Sum of the mass this lot's creating process declared as lost. */
  readonly declaredLoss: bigint;
  /** `parentTotal - (ownMass + declaredLoss)`. Positive: unaccounted surplus. Negative: unaccounted shortfall. */
  readonly discrepancy: bigint;
}

export interface ClosureReport {
  readonly ok: boolean;
  /** Non-root lots actually checked. */
  readonly lotsChecked: number;
  /** Root lots exempted from this check (see module doc). */
  readonly rootsSkipped: number;
  readonly failures: readonly ClosureFailure[];
}

/**
 * Check one lot's closure. Returns `undefined` for a root lot (nothing to check
 * here) or for a lot whose books close exactly; otherwise returns the exact
 * discrepancy.
 */
export function checkLotClosure(lot: Lot): ClosureFailure | undefined {
  if (lot.parents.length === 0) return undefined;

  let parentTotal = 0n;
  for (const parent of lot.parents) parentTotal += parent.mass;

  let declaredLoss = 0n;
  for (const loss of lot.losses) declaredLoss += loss.mass;

  const expected = lot.mass + declaredLoss;
  if (parentTotal === expected) return undefined;

  return {
    lotId: lot.id,
    parentTotal,
    ownMass: lot.mass,
    declaredLoss,
    discrepancy: parentTotal - expected,
  };
}

/** Check every lot in the graph and report every failure, not just the first. */
export function checkGraphClosure(graph: LotGraph): ClosureReport {
  const failures: ClosureFailure[] = [];
  let lotsChecked = 0;
  let rootsSkipped = 0;

  for (const lot of graph.lots()) {
    if (lot.parents.length === 0) {
      rootsSkipped += 1;
      continue;
    }
    lotsChecked += 1;
    const failure = checkLotClosure(lot);
    if (failure) failures.push(failure);
  }

  return { ok: failures.length === 0, lotsChecked, rootsSkipped, failures };
}
