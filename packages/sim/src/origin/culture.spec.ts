import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { elementCommodity, grams } from '../core/commodity.js';
import { seedWorld, WORLD_ACCOUNTS } from '../world/accounts.js';
import { feedStarter, fundYeastFeed, openSourdoughAccounts, openYeastAccounts, propagateYeast } from './culture.js';

function setUp() {
  const ledger = new Ledger();
  seedWorld(ledger, { fields: [] });
  return ledger;
}

describe('yeast propagation', () => {
  it("draws real CO2 out of the feed's own atmosphere-facing carbon, exactly", () => {
    const ledger = setUp();
    const accounts = openYeastAccounts(ledger);
    fundYeastFeed(ledger, accounts.feed, grams(1_000));

    const atmosphereCarbonBefore = ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity('C'));
    const result = propagateYeast(ledger, accounts);
    const atmosphereCarbonAfter = ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity('C'));

    expect(result.co2MassUg).toBeGreaterThan(0n);
    expect(result.yeastMassUg).toBeGreaterThan(0n);
    // The CO2 respired credited real carbon to the atmosphere — the defining
    // property this task requires: yeast propagation's CO2 comes out of its
    // feed, not from nowhere.
    expect(atmosphereCarbonAfter).toBeGreaterThan(atmosphereCarbonBefore);
    expect(ledger.audit().ok).toBe(true);

    // Every microgram the feed held ends up as yeast, spent broth, or CO2/H2O
    // in the atmosphere — nothing simply disappears.
    expect(result.yeastMassUg + result.co2MassUg + result.spentBrothMassUg).toBe(result.feedMassUg);
  });

  it('produces no yeast and no CO2 from an empty feed account', () => {
    const ledger = setUp();
    const accounts = openYeastAccounts(ledger);
    const result = propagateYeast(ledger, accounts);
    expect(result.yeastMassUg).toBe(0n);
    expect(result.co2MassUg).toBe(0n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('balances exactly across a spread of feed sizes (wide input range)', () => {
    for (const kg of [1, 10, 250, 5_000]) {
      const ledger = setUp();
      const accounts = openYeastAccounts(ledger);
      fundYeastFeed(ledger, accounts.feed, grams(kg * 1_000));
      const result = propagateYeast(ledger, accounts);
      expect(result.yeastMassUg).toBeGreaterThan(0n);
      expect(result.co2MassUg).toBeGreaterThan(0n);
      expect(ledger.audit().ok).toBe(true);
    }
  });
});

describe('sourdough starter', () => {
  it('feeds a real flour-and-water culture and respires a real bounded share to CO2', () => {
    const ledger = setUp();
    const accounts = openSourdoughAccounts(ledger);
    const atmosphereCarbonBefore = ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity('C'));
    const result = feedStarter(ledger, accounts, grams(200));
    const atmosphereCarbonAfter = ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity('C'));

    expect(result.totalMassUg).toBeGreaterThan(0n);
    expect(result.co2MassUg).toBeGreaterThan(0n);
    expect(atmosphereCarbonAfter).toBeGreaterThan(atmosphereCarbonBefore);
    expect(ledger.audit().ok).toBe(true);
  });
});
