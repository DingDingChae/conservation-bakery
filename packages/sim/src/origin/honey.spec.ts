import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { grams } from '../core/commodity.js';
import { Rng } from '../clock/rng.js';
import { seedWorld } from '../world/accounts.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';
import { REGIONS, seedCropRegion } from './region.js';
import { openHoneyAccounts, runHoneyChain, secreteBeeswax } from './honey.js';

function setUp(seed: number) {
  const ledger = new Ledger();
  seedCropRegion(ledger, REGIONS.meadow!);
  seedWorld(ledger, { fields: [] });
  return { ledger, rng: Rng.fromSeed(seed), registry: defaultSubstanceRegistry() };
}

describe('honey chain', () => {
  it('forages real nectar and ripens it to honey by real moisture reduction, exactly', () => {
    const { ledger, rng } = setUp(1);
    const accounts = openHoneyAccounts(ledger);
    const result = runHoneyChain(ledger, rng, REGIONS.meadow!, 'meadow-field-1', accounts);

    expect(result.honeyMassUg).toBeGreaterThan(0n);
    expect(result.honeyMassUg + result.moistureLossUg).toBe(result.nectarMassUg);
    expect(ledger.audit().ok).toBe(true);
  });

  it('secretes beeswax from honey consumed, exactly', () => {
    const { ledger, rng, registry } = setUp(2);
    const accounts = openHoneyAccounts(ledger);
    runHoneyChain(ledger, rng, REGIONS.meadow!, 'meadow-field-2', accounts);

    const honeyBefore = accountElementalMass(ledger, accounts.honey);
    const consumeUg = grams(50);
    const wax = secreteBeeswax(ledger, registry, accounts, REGIONS.meadow!, 'test.wax', consumeUg);

    expect(wax.waxMassUg).toBeGreaterThan(0n);
    expect(wax.waxMassUg + wax.spentMassUg).toBe(wax.honeyConsumedUg);
    const honeyAfter = accountElementalMass(ledger, accounts.honey);
    expect(honeyBefore - honeyAfter).toBe(wax.honeyConsumedUg);
    expect(ledger.audit().ok).toBe(true);
  });
});

function accountElementalMass(ledger: Ledger, account: string): bigint {
  let total = 0n;
  for (const [commodity, amount] of ledger.balances(account)) {
    if (commodity.startsWith('el:')) total += amount;
  }
  return total;
}
