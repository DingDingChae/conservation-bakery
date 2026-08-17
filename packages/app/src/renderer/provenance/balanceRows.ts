/**
 * Pure helper for the zero-residual screen (`balance.ts`).
 *
 * A `BalanceRow.residual` is an `ExactString` — CONTRACT.md rule 1 forbids ever
 * routing a conserved quantity through `Number`/`parseFloat` to decide anything
 * about it, including "is this zero". `residualIsExactlyZero` answers that with a
 * plain string test instead: the only strings a `bigint`'s `.toString(10)` can ever
 * produce for zero are "0" or "-0" (the latter never actually occurs — `BigInt`
 * has no negative zero — but the check tolerates it rather than assuming it can't
 * happen), and any digit other than "0" anywhere in the string means the value is
 * not zero. No arithmetic, no parsing, no precision to lose.
 */

import type { ExactString } from '../../shared/ipc.js';

export function residualIsExactlyZero(residual: ExactString): boolean {
  return /^-?0+$/.test(residual);
}
