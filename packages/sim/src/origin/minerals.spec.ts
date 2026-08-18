import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { grams } from '../core/commodity.js';
import { seedWorld } from '../world/accounts.js';
import { REGIONS } from './region.js';
import {
  crystalliseCreamOfTartar,
  refineGoldLeaf,
  refineSodiumBicarbonate,
  seedGoldReef,
  seedPhosphateBelt,
  seedSodaDeposit,
  seedVineyard,
  synthesizeMcp,
  synthesizeSapp,
} from './minerals.js';

function elementalMass(ledger: Ledger, account: string): bigint {
  let total = 0n;
  for (const [commodity, amount] of ledger.balances(account)) {
    if (commodity.startsWith('el:')) total += amount;
  }
  return total;
}

describe('leavening minerals and chemistry', () => {
  it('refines real sodium bicarbonate from a trona deposit', () => {
    const ledger = new Ledger();
    seedSodaDeposit(ledger, REGIONS.sodaDeposit!);
    seedWorld(ledger, { fields: [] });

    const produced = refineSodiumBicarbonate(ledger, REGIONS.sodaDeposit!, grams(1_000), 'test.baking-soda');
    expect(produced).toBeGreaterThan(0n);
    expect(elementalMass(ledger, 'test.baking-soda')).toBe(produced);
    expect(ledger.audit().ok).toBe(true);
  });

  it('crystallises real cream of tartar from vineyard lees', () => {
    const ledger = new Ledger();
    seedVineyard(ledger, REGIONS.vineyard!);
    seedWorld(ledger, { fields: [] });

    const produced = crystalliseCreamOfTartar(ledger, REGIONS.vineyard!, grams(500), 'test.cream-of-tartar');
    expect(produced).toBeGreaterThan(0n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('synthesizes real SAPP from a phosphate belt and a soda deposit', () => {
    const ledger = new Ledger();
    seedPhosphateBelt(ledger, REGIONS.phosphateBelt!);
    seedSodaDeposit(ledger, REGIONS.sodaDeposit!);
    seedWorld(ledger, { fields: [] });

    const produced = synthesizeSapp(ledger, REGIONS.phosphateBelt!, REGIONS.sodaDeposit!, grams(1_000), 'test.sapp');
    expect(produced).toBeGreaterThan(0n);
    expect(ledger.balance('test.sapp', 'el:Na')).toBeGreaterThan(0n);
    expect(ledger.balance('test.sapp', 'el:P')).toBeGreaterThan(0n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('synthesizes real MCP from a phosphate belt', () => {
    const ledger = new Ledger();
    seedPhosphateBelt(ledger, REGIONS.phosphateBelt!);
    seedWorld(ledger, { fields: [] });

    const produced = synthesizeMcp(ledger, REGIONS.phosphateBelt!, grams(1_000), 'test.mcp');
    expect(produced).toBeGreaterThan(0n);
    expect(ledger.balance('test.mcp', 'el:Ca')).toBeGreaterThan(0n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('refines edible gold leaf, entirely Ash, from a gold reef', () => {
    const ledger = new Ledger();
    seedGoldReef(ledger, REGIONS.goldReef!);
    seedWorld(ledger, { fields: [] });

    const produced = refineGoldLeaf(ledger, REGIONS.goldReef!, grams(1), 'test.gold-leaf');
    expect(produced).toBeGreaterThan(0n);
    expect(ledger.balance('test.gold-leaf', 'el:Ash')).toBe(produced);
    expect(ledger.audit().ok).toBe(true);
  });
});
