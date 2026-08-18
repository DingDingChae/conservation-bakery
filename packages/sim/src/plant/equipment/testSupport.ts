/**
 * Small shared test fixtures for `plant/equipment/*.spec.ts`. Not itself a
 * spec file, so it is picked up by the ordinary build (and so must stay a
 * plain, boring module: no `describe`/`it`), but every export here exists
 * only to keep the three equipment spec files from re-deriving the same
 * genesis-seeding boilerplate `mill.spec.ts` and `creamery.spec.ts` already
 * establish the pattern for.
 */

import type { Composition } from '../../core/commodity.js';
import { elementCommodity } from '../../core/commodity.js';
import type { AccountId, AccountKind, Entry } from '../../core/ledger.js';
import { Ledger } from '../../core/ledger.js';

export interface AccountSetup {
  readonly id: AccountId;
  readonly kind: AccountKind;
}

export function openAccounts(ledger: Ledger, accounts: readonly AccountSetup[]): void {
  for (const account of accounts) {
    ledger.openAccount({ id: account.id, kind: account.kind, label: account.id });
  }
}

/** Credit `account` with `composition`, drawn from genesis in the same
 * balanced posting — the same technique `creamery.spec.ts`'s `seedMilk` and
 * `mill.spec.ts`'s `seedGrain` each define locally. */
export function seedFromGenesis(ledger: Ledger, account: AccountId, composition: Composition, process: string): void {
  const entries: Entry[] = [];
  for (const [element, amount] of composition) {
    if (amount === 0n) continue;
    const commodity = elementCommodity(element);
    entries.push({ account, commodity, delta: amount });
    entries.push({ account: 'genesis', commodity, delta: -amount });
  }
  if (entries.length === 0) return;
  ledger.post({ process, entries });
}
