import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { Rng } from '../clock/rng.js';
import { seedWorld } from '../world/accounts.js';
import { REGIONS, seedCropRegion } from './region.js';
import { openCoffeeAccounts, runCoffeeChain } from './coffee.js';

function setUp(seed: number) {
  const ledger = new Ledger();
  seedCropRegion(ledger, REGIONS.coffeeHighlands!);
  seedWorld(ledger, { fields: [] });
  return { ledger, rng: Rng.fromSeed(seed) };
}

describe('coffee chain', () => {
  it('grows a cherry, depulps and washes/dries it to green coffee, exactly', () => {
    const { ledger, rng } = setUp(1);
    const accounts = openCoffeeAccounts(ledger);
    const result = runCoffeeChain(ledger, rng, REGIONS.coffeeHighlands!, 'coffee-field-1', accounts);

    expect(result.cherryMassUg).toBeGreaterThan(0n);
    expect(result.pulpMassUg).toBeGreaterThan(0n);
    expect(result.greenBeanMassUg).toBeGreaterThan(0n);
    expect(result.pulpMassUg + result.beanMassUg).toBe(result.cherryMassUg);
    expect(result.greenBeanMassUg + result.dryingMoistureLossUg).toBe(result.beanMassUg);
    expect(ledger.audit().ok).toBe(true);
  });

  it('reconciles exactly across a spread of seeds', () => {
    for (const seed of [4, 11, 88]) {
      const { ledger, rng } = setUp(seed);
      const accounts = openCoffeeAccounts(ledger);
      const result = runCoffeeChain(ledger, rng, REGIONS.coffeeHighlands!, `coffee-${seed}`, accounts);
      expect(result.pulpMassUg + result.beanMassUg).toBe(result.cherryMassUg);
      expect(result.greenBeanMassUg + result.dryingMoistureLossUg).toBe(result.beanMassUg);
      expect(ledger.audit().ok).toBe(true);
    }
  });
});
