/**
 * Cash flow through the ledger's own cash commodity.
 *
 * `core/commodity.ts` already defines money as a conserved commodity
 * (`cash:<CODE>`, exact minor units, always `bigint`) and `core/ledger.ts`
 * already refuses any posting that does not balance. This module supplies
 * nothing new to the ledger itself — it only opens the accounts a bakery's
 * business needs (its own cash till, and the external counterparties it
 * trades cash with: customers, suppliers, the utility, payroll, the waste
 * disposal contractor) and a small set of named helpers that each build one
 * balanced cash `Posting` for a real business event.
 *
 * There is no "money appears" path here. Every credit to `econ.cash` is
 * matched, in the same posting, by an equal and opposite debit from a real
 * counterparty account — see CONTRACT.md rule 1. The one exception is
 * `seedInitialCash`, which — exactly like `world/accounts.ts`'s `seedFrom` —
 * draws the bakery's starting capital from `GENESIS`, the one account
 * sanctioned to fund a world's starting quantity of anything, once, before
 * the ledger is sealed.
 */

import type { CashCommodity } from '../core/commodity.js';
import { cashCommodity } from '../core/commodity.js';
import type { AccountId, AppliedPosting, Entry, Ledger, Posting } from '../core/ledger.js';
import { GENESIS } from '../core/ledger.js';
import { WORLD_ACCOUNTS } from '../world/accounts.js';

/** This world's trading currency. One currency keeps every price and wage in
 * this module directly comparable; a multi-currency bakery is out of scope. */
export const CASH_CURRENCY = 'USD';
export const CASH: CashCommodity = cashCommodity(CASH_CURRENCY);

/**
 * The accounts a bakery's business layer needs. `customers`, `suppliers` and
 * `utilities` are the very same external accounts `world/accounts.ts` opens
 * for material trade (`WORLD_ACCOUNTS.marketCustomers` etc.) — a customer who
 * buys product pays cash into the same counterparty that received it, which
 * is the honest double-entry picture of "the same real customer, one
 * account". `payroll` and `wasteDisposal` are new counterparties this module
 * owns, for the two kinds of cash movement that have no material counterpart
 * at all.
 */
export const ECON_ACCOUNTS = {
  /** The bakery's own cash till. A `stock` account: it can never go negative,
   * so this world can never spend cash it does not have. */
  cash: 'econ.cash',
  customers: WORLD_ACCOUNTS.marketCustomers,
  suppliers: WORLD_ACCOUNTS.marketSuppliers,
  utilities: WORLD_ACCOUNTS.marketUtilities,
  payroll: 'econ.payroll',
  wasteDisposal: 'econ.waste-disposal',
} as const satisfies Record<string, AccountId>;

function openIfMissing(
  ledger: Ledger,
  id: AccountId,
  kind: 'stock' | 'external',
  label: string,
): void {
  if (ledger.hasAccount(id)) return;
  ledger.openAccount({ id, kind, label });
}

/**
 * Open every account this module needs, idempotently. Safe to call whether or
 * not `world/accounts.ts`'s `seedWorld` has already opened the shared market
 * accounts this module reuses — `openIfMissing` skips anything already open.
 */
export function openEconAccounts(ledger: Ledger): void {
  openIfMissing(ledger, ECON_ACCOUNTS.cash, 'stock', "the bakery's own cash");
  openIfMissing(ledger, ECON_ACCOUNTS.customers, 'external', 'everyone the bakery sells to');
  openIfMissing(ledger, ECON_ACCOUNTS.suppliers, 'external', 'everyone the bakery buys from');
  openIfMissing(ledger, ECON_ACCOUNTS.utilities, 'external', 'the grid, the water main, the gas main');
  openIfMissing(ledger, ECON_ACCOUNTS.payroll, 'external', "the bakery's staff payroll");
  openIfMissing(ledger, ECON_ACCOUNTS.wasteDisposal, 'external', 'the waste disposal contractor');
}

/**
 * Fund the bakery's starting cash balance from `GENESIS` — the one account
 * CONTRACT.md sanctions to supply a world's starting quantity of anything.
 * Like `world/accounts.ts`'s own genesis helpers, this must run before
 * `ledger.seal()`; after that, `GENESIS` refuses every further posting and
 * this function throws exactly as `Ledger.post` does for any other attempt to
 * draw on it once sealed.
 */
export function seedInitialCash(
  ledger: Ledger,
  amountMinorUnits: bigint,
  process = 'genesis:econ-cash',
): AppliedPosting {
  return ledger.post({
    process,
    entries: [
      { account: ECON_ACCOUNTS.cash, commodity: CASH, delta: amountMinorUnits },
      { account: GENESIS, commodity: CASH, delta: -amountMinorUnits },
    ],
  });
}

/**
 * One movement of cash between the bakery's own till and a real counterparty.
 * `amountMinorUnits` is signed from `econ.cash`'s point of view: positive is
 * money coming in (a sale), negative is money going out (a wage, a bill, a
 * purchase). The counterparty entry is always the exact negation, so this
 * function cannot produce anything but a balanced posting.
 */
export interface CashMovement {
  readonly counterparty: AccountId;
  readonly amountMinorUnits: bigint;
  readonly process: string;
  readonly note?: string;
}

export function postCashMovement(ledger: Ledger, movement: CashMovement): AppliedPosting {
  const entries: Entry[] = [
    { account: ECON_ACCOUNTS.cash, commodity: CASH, delta: movement.amountMinorUnits },
    { account: movement.counterparty, commodity: CASH, delta: -movement.amountMinorUnits },
  ];
  const posting: Posting =
    movement.note === undefined
      ? { process: movement.process, entries }
      : { process: movement.process, entries, note: movement.note };
  return ledger.post(posting);
}

export interface SaleParams {
  readonly orderId: string;
  readonly amountMinorUnits: bigint;
  /** Defaults to the shared `market.customers` counterparty; pass a specific
   * per-customer account if the caller tracks customers individually. */
  readonly customerAccount?: AccountId;
}

/** Revenue: a real customer pays for a real, already-shipped order. */
export function recordSale(ledger: Ledger, params: SaleParams): AppliedPosting {
  return postCashMovement(ledger, {
    counterparty: params.customerAccount ?? ECON_ACCOUNTS.customers,
    amountMinorUnits: params.amountMinorUnits,
    process: `econ:sale:${params.orderId}`,
  });
}

export interface WagePaymentParams {
  readonly workerId: string;
  readonly amountMinorUnits: bigint;
  readonly process?: string;
}

/** Wages: cash out to the payroll counterparty for hours already worked. */
export function payWages(ledger: Ledger, params: WagePaymentParams): AppliedPosting {
  return postCashMovement(ledger, {
    counterparty: ECON_ACCOUNTS.payroll,
    amountMinorUnits: -params.amountMinorUnits,
    process: params.process ?? `econ:wages:${params.workerId}`,
  });
}

export interface EnergyBillParams {
  readonly amountMinorUnits: bigint;
  readonly process?: string;
}

/** An energy bill: cash out to the utility for energy already metered by the
 * ledger's own `energy:uJ` commodity elsewhere in the simulation. */
export function payEnergyBill(ledger: Ledger, params: EnergyBillParams): AppliedPosting {
  return postCashMovement(ledger, {
    counterparty: ECON_ACCOUNTS.utilities,
    amountMinorUnits: -params.amountMinorUnits,
    process: params.process ?? 'econ:energy-bill',
  });
}

export interface SparePartsPurchaseParams {
  readonly partId: string;
  readonly amountMinorUnits: bigint;
}

/** A spare-parts purchase: cash out to a supplier for equipment maintenance
 * stock. This module does not model the part itself moving into an equipment
 * account — that is `process/`'s and `plant/`'s concern — only the real cash
 * cost of buying it. */
export function buySpareParts(ledger: Ledger, params: SparePartsPurchaseParams): AppliedPosting {
  return postCashMovement(ledger, {
    counterparty: ECON_ACCOUNTS.suppliers,
    amountMinorUnits: -params.amountMinorUnits,
    process: `econ:spare-parts:${params.partId}`,
  });
}

export interface WasteDisposalParams {
  readonly amountMinorUnits: bigint;
  readonly note?: string;
}

/** A waste disposal bill: cash out for hauling away condemned or unsellable
 * material. This module never models the material itself leaving an account
 * — that is a real elemental-mass posting elsewhere — only its real cost. */
export function payWasteDisposal(ledger: Ledger, params: WasteDisposalParams): AppliedPosting {
  return postCashMovement(ledger, {
    counterparty: ECON_ACCOUNTS.wasteDisposal,
    amountMinorUnits: -params.amountMinorUnits,
    process: 'econ:waste-disposal',
    ...(params.note === undefined ? {} : { note: params.note }),
  });
}

/** The bakery's current cash on hand — a direct, un-cached read of the
 * ledger's own balance, never a running total kept independently of it. */
export function cashOnHand(ledger: Ledger): bigint {
  return ledger.balance(ECON_ACCOUNTS.cash, CASH);
}
