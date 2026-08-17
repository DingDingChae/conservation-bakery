/**
 * The ledger.
 *
 * This is the enforcement mechanism for rule 1 of CONTRACT.md, and it is the reason
 * the rest of this codebase can be trusted: there is no function here that adds
 * material to the world. The only mutation is `post`, and a posting that does not
 * sum to exactly zero for every commodity it touches is rejected before any account
 * is changed.
 *
 * Conservation is therefore structural. A process cannot create matter by having a
 * bug, because there is no operation available to it that could.
 *
 * The invariant, stated once:
 *
 *     for every commodity c:  Σ over all accounts of balance(a, c)  ===  0n
 *
 * It is zero rather than "constant" because material does not begin inside the
 * world's own accounts. It begins in `genesis`, an external account that goes
 * negative by exactly as much as the world holds. `audit()` re-derives this sum from
 * scratch and is the last line of defence against a direct mutation that bypassed a
 * posting.
 */

import type { CommodityId } from './commodity.js';

export type AccountId = string;

/**
 * What kind of thing an account is. This only affects whether a balance may go
 * negative; it carries no other authority.
 */
export type AccountKind =
  /** A real holding of real material inside the world. Never negative. */
  | 'stock'
  /** A finite natural reservoir: atmosphere, soil, groundwater, the sun. Never negative. */
  | 'reservoir'
  /**
   * A counterparty outside the fence: a supplier, a customer, the grid, the sky.
   * May go negative, and its negative balance is the exact, auditable record of how
   * much the outside world has supplied. This is ordinary double-entry bookkeeping,
   * not an escape hatch — the sum across all accounts is still exactly zero.
   */
  | 'external';

export interface AccountSpec {
  readonly id: AccountId;
  readonly kind: AccountKind;
  /** Human-readable label. Never a translation key; presentation owns wording. */
  readonly label: string;
}

export interface Entry {
  readonly account: AccountId;
  readonly commodity: CommodityId;
  readonly delta: bigint;
}

export interface Posting {
  /** Which process is responsible. Used verbatim in diagnostics. */
  readonly process: string;
  readonly entries: readonly Entry[];
  readonly note?: string;
}

export interface AppliedPosting extends Posting {
  readonly seq: number;
  readonly tick: number;
}

export class UnbalancedPostingError extends Error {
  constructor(
    readonly posting: Posting,
    readonly commodity: CommodityId,
    readonly residual: bigint,
  ) {
    super(
      `process "${posting.process}" attempted a posting that does not balance: ` +
        `commodity ${commodity} has residual ${residual} (must be 0). ` +
        `Nothing comes from nothing — see CONTRACT.md rule 1.`,
    );
    this.name = 'UnbalancedPostingError';
  }
}

export class NegativeStockError extends Error {
  constructor(
    readonly posting: Posting,
    readonly account: AccountId,
    readonly commodity: CommodityId,
    readonly resulting: bigint,
  ) {
    super(
      `process "${posting.process}" would drive account "${account}" to ${resulting} ` +
        `of ${commodity}. A stock or reservoir cannot go negative — the material is ` +
        `simply not there.`,
    );
    this.name = 'NegativeStockError';
  }
}

export class UnknownAccountError extends Error {
  constructor(
    readonly posting: Posting,
    readonly account: AccountId,
  ) {
    super(
      `process "${posting.process}" referenced account "${account}", which does not ` +
        `exist. Every account must be opened before it can hold anything.`,
    );
    this.name = 'UnknownAccountError';
  }
}

export class SealedLedgerError extends Error {
  constructor(what: string) {
    super(`${what} after the ledger was sealed. Genesis is a one-time phase.`);
    this.name = 'SealedLedgerError';
  }
}

export interface AuditDiscrepancy {
  readonly commodity: CommodityId;
  readonly residual: bigint;
}

export interface AuditReport {
  readonly ok: boolean;
  readonly commoditiesChecked: number;
  readonly discrepancies: readonly AuditDiscrepancy[];
}

/** The account every gram of the starting world is drawn from, exactly once. */
export const GENESIS: AccountId = 'genesis';

interface AccountState {
  readonly spec: AccountSpec;
  readonly balances: Map<CommodityId, bigint>;
}

export interface LedgerOptions {
  /**
   * Called for every applied posting. Use this to build the provenance graph, an
   * audit export, or a replay journal without the ledger itself growing without
   * bound. Must not throw and must not mutate the posting.
   */
  readonly onPosting?: (posting: AppliedPosting) => void;
}

export class Ledger {
  readonly #accounts = new Map<AccountId, AccountState>();
  readonly #commodities = new Set<CommodityId>();
  readonly #onPosting: ((posting: AppliedPosting) => void) | undefined;
  #sealed = false;
  #seq = 0;
  #tick = 0;

  constructor(options: LedgerOptions = {}) {
    this.#onPosting = options.onPosting;
    this.openAccount({
      id: GENESIS,
      kind: 'external',
      label: 'the state of the world when this save began',
    });
  }

  get sealed(): boolean {
    return this.#sealed;
  }

  get postingCount(): number {
    return this.#seq;
  }

  get tick(): number {
    return this.#tick;
  }

  setTick(tick: number): void {
    this.#tick = tick;
  }

  openAccount(spec: AccountSpec): void {
    if (this.#accounts.has(spec.id)) {
      throw new Error(`account "${spec.id}" already exists`);
    }
    this.#accounts.set(spec.id, { spec, balances: new Map() });
  }

  hasAccount(id: AccountId): boolean {
    return this.#accounts.has(id);
  }

  accountSpec(id: AccountId): AccountSpec | undefined {
    return this.#accounts.get(id)?.spec;
  }

  /** Deterministic: insertion order, which is itself deterministic. */
  accountIds(): readonly AccountId[] {
    return [...this.#accounts.keys()];
  }

  commodityIds(): readonly CommodityId[] {
    return [...this.#commodities];
  }

  /**
   * End the genesis phase. After this, `genesis` may not appear in a posting again,
   * so no further material can enter the world from outside its own accounts.
   */
  seal(): void {
    this.#sealed = true;
  }

  balance(account: AccountId, commodity: CommodityId): bigint {
    return this.#accounts.get(account)?.balances.get(commodity) ?? 0n;
  }

  balances(account: AccountId): ReadonlyMap<CommodityId, bigint> {
    return this.#accounts.get(account)?.balances ?? new Map();
  }

  /**
   * Apply a posting, or throw and change nothing.
   *
   * Validation order is deliberate: existence, then balance, then sufficiency. A
   * caller that catches `NegativeStockError` has learned something real about the
   * world (there is not enough material) rather than something about a typo.
   */
  post(posting: Posting): AppliedPosting {
    const residuals = new Map<CommodityId, bigint>();

    for (const entry of posting.entries) {
      if (!this.#accounts.has(entry.account)) {
        throw new UnknownAccountError(posting, entry.account);
      }
      if (this.#sealed && entry.account === GENESIS) {
        throw new SealedLedgerError(
          `process "${posting.process}" tried to draw on genesis`,
        );
      }
      residuals.set(entry.commodity, (residuals.get(entry.commodity) ?? 0n) + entry.delta);
    }

    for (const [commodity, residual] of residuals) {
      if (residual !== 0n) {
        throw new UnbalancedPostingError(posting, commodity, residual);
      }
    }

    // Sufficiency is checked against the *net* effect on each account, so a posting
    // that draws and returns to the same account in one step is judged on its result.
    const projected = new Map<AccountId, Map<CommodityId, bigint>>();
    for (const entry of posting.entries) {
      let perAccount = projected.get(entry.account);
      if (!perAccount) {
        perAccount = new Map();
        projected.set(entry.account, perAccount);
      }
      perAccount.set(entry.commodity, (perAccount.get(entry.commodity) ?? 0n) + entry.delta);
    }

    for (const [accountId, deltas] of projected) {
      const account = this.#accounts.get(accountId);
      if (!account) throw new UnknownAccountError(posting, accountId);
      if (account.spec.kind === 'external') continue;
      for (const [commodity, delta] of deltas) {
        if (delta >= 0n) continue;
        const resulting = (account.balances.get(commodity) ?? 0n) + delta;
        if (resulting < 0n) {
          throw new NegativeStockError(posting, accountId, commodity, resulting);
        }
      }
    }

    // Everything is validated. Apply.
    for (const [accountId, deltas] of projected) {
      const account = this.#accounts.get(accountId)!;
      for (const [commodity, delta] of deltas) {
        if (delta === 0n) continue;
        this.#commodities.add(commodity);
        const next = (account.balances.get(commodity) ?? 0n) + delta;
        if (next === 0n) account.balances.delete(commodity);
        else account.balances.set(commodity, next);
      }
    }

    this.#seq += 1;
    const applied: AppliedPosting = { ...posting, seq: this.#seq, tick: this.#tick };
    this.#onPosting?.(applied);
    return applied;
  }

  /**
   * Re-derive the invariant from scratch.
   *
   * This does not consult any running total; it re-sums every account. That is the
   * point — it is the check that catches a mutation which bypassed `post`.
   */
  audit(): AuditReport {
    const sums = new Map<CommodityId, bigint>();
    for (const account of this.#accounts.values()) {
      for (const [commodity, amount] of account.balances) {
        sums.set(commodity, (sums.get(commodity) ?? 0n) + amount);
      }
    }

    const discrepancies: AuditDiscrepancy[] = [];
    for (const [commodity, residual] of sums) {
      if (residual !== 0n) discrepancies.push({ commodity, residual });
    }

    return {
      ok: discrepancies.length === 0,
      commoditiesChecked: sums.size,
      discrepancies,
    };
  }

  /** Throw unless the world is exactly in balance. Called every tick. */
  assertBalanced(context: string): void {
    const report = this.audit();
    if (report.ok) return;
    const detail = report.discrepancies
      .map((d) => `${d.commodity} residual ${d.residual}`)
      .join(', ');
    throw new Error(
      `conservation failure at ${context}: ${detail}. ` +
        `Something bypassed the ledger — see CONTRACT.md rule 1.`,
    );
  }
}
