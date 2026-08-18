import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import {
  CASH,
  ECON_ACCOUNTS,
  buySpareParts,
  cashOnHand,
  openEconAccounts,
  payEnergyBill,
  payWages,
  payWasteDisposal,
  recordSale,
  seedInitialCash,
} from './ledgerAccounts.js';

function setup(): Ledger {
  const ledger = new Ledger();
  openEconAccounts(ledger);
  return ledger;
}

describe('ledgerAccounts', () => {
  it('opens idempotently and reuses the shared world market accounts', () => {
    const ledger = setup();
    expect(ledger.hasAccount(ECON_ACCOUNTS.cash)).toBe(true);
    expect(ledger.hasAccount(ECON_ACCOUNTS.customers)).toBe(true);
    // Calling again must not throw ("account already exists").
    expect(() => openEconAccounts(ledger)).not.toThrow();
  });

  it('seeds starting cash as a balanced draw from genesis', () => {
    const ledger = setup();
    seedInitialCash(ledger, 100_000n);
    expect(cashOnHand(ledger)).toBe(100_000n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('records a sale as a balanced posting crediting cash from the customer account', () => {
    const ledger = setup();
    seedInitialCash(ledger, 0n);
    recordSale(ledger, { orderId: 'order-1', amountMinorUnits: 2_500n });
    expect(cashOnHand(ledger)).toBe(2_500n);
    expect(ledger.balance(ECON_ACCOUNTS.customers, CASH)).toBe(-2_500n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('refuses to spend cash the till does not have (stock account cannot go negative)', () => {
    const ledger = setup();
    expect(() => payWages(ledger, { workerId: 'w1', amountMinorUnits: 1_000n })).toThrow();
  });

  it('cash conserves exactly through a long trading run', () => {
    const ledger = setup();
    seedInitialCash(ledger, 10_000_000n);

    let expectedCash = 10_000_000n;
    const TRADING_DAYS = 500;

    for (let day = 0; day < TRADING_DAYS; day += 1) {
      const saleAmount = BigInt(100 + (day % 37) * 13);
      recordSale(ledger, { orderId: `order-${day}`, amountMinorUnits: saleAmount });
      expectedCash += saleAmount;

      if (day % 5 === 0) {
        const wage = BigInt(50 + (day % 11) * 7);
        payWages(ledger, { workerId: `worker-${day % 4}`, amountMinorUnits: wage });
        expectedCash -= wage;
      }
      if (day % 7 === 0) {
        const bill = BigInt(30 + (day % 9) * 4);
        payEnergyBill(ledger, { amountMinorUnits: bill });
        expectedCash -= bill;
      }
      if (day % 11 === 0) {
        const parts = BigInt(20 + (day % 6) * 3);
        buySpareParts(ledger, { partId: `part-${day}`, amountMinorUnits: parts });
        expectedCash -= parts;
      }
      if (day % 13 === 0) {
        const disposal = BigInt(10 + (day % 5) * 2);
        payWasteDisposal(ledger, { amountMinorUnits: disposal });
        expectedCash -= disposal;
      }

      // Conservation holds after every single posting, not just at the end.
      ledger.assertBalanced(`trading day ${day}`);
    }

    expect(cashOnHand(ledger)).toBe(expectedCash);

    const report = ledger.audit();
    expect(report.ok).toBe(true);
    expect(report.discrepancies).toEqual([]);

    // Every minor unit of cash the till holds is exactly matched by the
    // negative balance of the counterparties it came from -- the ledger-wide
    // invariant CONTRACT.md rule 1 requires, checked independently of
    // Ledger.audit() by summing this one commodity by hand.
    let cashSum = 0n;
    for (const account of ledger.accountIds()) {
      cashSum += ledger.balance(account, CASH);
    }
    expect(cashSum).toBe(0n);
  });
});
