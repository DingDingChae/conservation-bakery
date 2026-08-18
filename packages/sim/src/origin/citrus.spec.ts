import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { Rng } from '../clock/rng.js';
import { seedWorld } from '../world/accounts.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';
import { REGIONS, seedCropRegion } from './region.js';
import { openCitrusAccounts, runCitrusChain } from './citrus.js';

function setUp(seed: number) {
  const ledger = new Ledger();
  seedCropRegion(ledger, REGIONS.citrusGrove!);
  seedWorld(ledger, { fields: [] });
  return { ledger, rng: Rng.fromSeed(seed), registry: defaultSubstanceRegistry() };
}

describe('citrus chain', () => {
  it('grows an orange, juices it, and extracts pectin from the peel, exactly', () => {
    const { ledger, rng, registry } = setUp(1);
    const accounts = openCitrusAccounts(ledger);
    const result = runCitrusChain(ledger, rng, registry, REGIONS.citrusGrove!, 'citrus-field-1', accounts);

    expect(result.juiceMassUg).toBeGreaterThan(0n);
    expect(result.peelMassUg).toBeGreaterThan(0n);
    expect(result.pectinMassUg).toBeGreaterThan(0n);
    expect(result.juiceMassUg + result.peelMassUg).toBe(result.fruitMassUg);
    expect(result.pectinMassUg + result.pomaceMassUg).toBe(result.peelMassUg);
    expect(ledger.audit().ok).toBe(true);
  });

  it('reconciles exactly across a spread of seeds', () => {
    for (const seed of [6, 17, 200]) {
      const { ledger, rng, registry } = setUp(seed);
      const accounts = openCitrusAccounts(ledger);
      const result = runCitrusChain(ledger, rng, registry, REGIONS.citrusGrove!, `citrus-${seed}`, accounts);
      expect(result.juiceMassUg + result.peelMassUg).toBe(result.fruitMassUg);
      expect(result.pectinMassUg + result.pomaceMassUg).toBe(result.peelMassUg);
      expect(ledger.audit().ok).toBe(true);
    }
  });
});
