import { describe, expect, it } from 'vitest';

import { ENERGY, elementCommodity } from '../core/commodity.js';
import { GENESIS, Ledger } from '../core/ledger.js';
import { WORLD_ACCOUNTS, seedWorld, soilAccount } from './accounts.js';

describe('seedWorld', () => {
  it('opens every fixed world account plus a soil account per field', () => {
    const ledger = new Ledger();
    seedWorld(ledger, { fields: ['test-field'] });

    expect(ledger.hasAccount(WORLD_ACCOUNTS.atmosphere)).toBe(true);
    expect(ledger.hasAccount(WORLD_ACCOUNTS.groundwater)).toBe(true);
    expect(ledger.hasAccount(WORLD_ACCOUNTS.surfaceWater)).toBe(true);
    expect(ledger.hasAccount(WORLD_ACCOUNTS.sun)).toBe(true);
    expect(ledger.hasAccount(WORLD_ACCOUNTS.space)).toBe(true);
    expect(ledger.hasAccount(WORLD_ACCOUNTS.marketSuppliers)).toBe(true);
    expect(ledger.hasAccount(WORLD_ACCOUNTS.marketCustomers)).toBe(true);
    expect(ledger.hasAccount(WORLD_ACCOUNTS.marketUtilities)).toBe(true);
    expect(ledger.hasAccount(soilAccount('test-field'))).toBe(true);
  });

  it('assigns account kinds matching CONTRACT.md: reservoirs never go negative, externals may', () => {
    const ledger = new Ledger();
    seedWorld(ledger, { fields: [] });

    expect(ledger.accountSpec(WORLD_ACCOUNTS.atmosphere)?.kind).toBe('reservoir');
    expect(ledger.accountSpec(WORLD_ACCOUNTS.groundwater)?.kind).toBe('reservoir');
    expect(ledger.accountSpec(WORLD_ACCOUNTS.surfaceWater)?.kind).toBe('reservoir');
    expect(ledger.accountSpec(WORLD_ACCOUNTS.sun)?.kind).toBe('reservoir');
    expect(ledger.accountSpec(WORLD_ACCOUNTS.space)?.kind).toBe('external');
    expect(ledger.accountSpec(WORLD_ACCOUNTS.marketSuppliers)?.kind).toBe('external');
  });

  it('gives every reservoir a positive, finite starting balance', () => {
    const ledger = new Ledger();
    seedWorld(ledger, { fields: ['test-field'] });

    for (const element of ['C', 'H', 'O', 'N', 'Ash'] as const) {
      expect(ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity(element))).toBeGreaterThan(0n);
    }
    expect(ledger.balance(WORLD_ACCOUNTS.groundwater, elementCommodity('H'))).toBeGreaterThan(0n);
    expect(ledger.balance(WORLD_ACCOUNTS.groundwater, elementCommodity('O'))).toBeGreaterThan(0n);
    expect(ledger.balance(WORLD_ACCOUNTS.surfaceWater, elementCommodity('O'))).toBeGreaterThan(0n);
    expect(ledger.balance(soilAccount('test-field'), elementCommodity('C'))).toBeGreaterThan(0n);
    expect(ledger.balance(soilAccount('test-field'), elementCommodity('N'))).toBeGreaterThan(0n);
    expect(ledger.balance(WORLD_ACCOUNTS.sun, ENERGY)).toBeGreaterThan(0n);
  });

  it('draws every starting quantity from genesis, so the whole world nets to zero', () => {
    const ledger = new Ledger();
    seedWorld(ledger, { fields: ['a', 'b'] });

    const report = ledger.audit();
    expect(report.discrepancies).toEqual([]);
    expect(report.ok).toBe(true);
    // Genesis is the sole, exact counterparty for every credited account.
    expect(ledger.balance(GENESIS, elementCommodity('O'))).toBeLessThan(0n);
  });

  it('seals the ledger, so genesis can never be drawn on again', () => {
    const ledger = new Ledger();
    seedWorld(ledger);

    expect(ledger.sealed).toBe(true);
    expect(() =>
      ledger.post({
        process: 'test:illegal-genesis-draw',
        entries: [
          { account: GENESIS, commodity: elementCommodity('C'), delta: -1n },
          { account: WORLD_ACCOUNTS.atmosphere, commodity: elementCommodity('C'), delta: 1n },
        ],
      }),
    ).toThrow(/sealed/i);
  });

  it('is deterministic: seeding two ledgers the same way produces identical balances', () => {
    const ledgerA = new Ledger();
    const ledgerB = new Ledger();
    seedWorld(ledgerA, { fields: ['x'] });
    seedWorld(ledgerB, { fields: ['x'] });

    for (const commodity of ledgerA.commodityIds()) {
      for (const account of ledgerA.accountIds()) {
        expect(ledgerB.balance(account, commodity)).toBe(ledgerA.balance(account, commodity));
      }
    }
  });
});
