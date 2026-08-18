import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { Rng } from '../clock/rng.js';
import { seedWorld } from '../world/accounts.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';
import { REGIONS, seedCropRegion } from './region.js';
import { openAlmondAccounts, runAlmondChain } from './nuts.js';

function setUp(seed: number) {
  const ledger = new Ledger();
  seedCropRegion(ledger, REGIONS.nutOrchard!);
  seedWorld(ledger, { fields: [] });
  return { ledger, rng: Rng.fromSeed(seed), registry: defaultSubstanceRegistry() };
}

describe('almond chain', () => {
  it('grows an in-shell almond and cracks it to kernel and shell, exactly', () => {
    const { ledger, rng, registry } = setUp(1);
    const accounts = openAlmondAccounts(ledger);
    const result = runAlmondChain(ledger, rng, registry, REGIONS.nutOrchard!, 'almond-field-1', accounts);

    expect(result.kernelMassUg).toBeGreaterThan(0n);
    expect(result.shellMassUg).toBeGreaterThan(0n);
    expect(result.kernelMassUg + result.shellMassUg).toBe(result.inShellMassUg);
    expect(ledger.audit().ok).toBe(true);
  });

  it('reconciles exactly across a spread of seeds', () => {
    for (const seed of [9, 40, 777]) {
      const { ledger, rng, registry } = setUp(seed);
      const accounts = openAlmondAccounts(ledger);
      const result = runAlmondChain(ledger, rng, registry, REGIONS.nutOrchard!, `almond-${seed}`, accounts);
      expect(result.kernelMassUg + result.shellMassUg).toBe(result.inShellMassUg);
      expect(ledger.audit().ok).toBe(true);
    }
  });
});
