import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { Rng } from '../clock/rng.js';
import { seedWorld } from '../world/accounts.js';
import { REGIONS, seedCropRegion } from './region.js';
import { openVanillaAccounts, runVanillaChain } from './vanilla.js';

function setUp(seed: number) {
  const ledger = new Ledger();
  seedCropRegion(ledger, REGIONS.vanillaCoast!);
  seedWorld(ledger, { fields: [] });
  return { ledger, rng: Rng.fromSeed(seed) };
}

describe('vanilla curing chain', () => {
  it('cures a green bean through sweat, sun-dry and condition to a real target moisture', () => {
    const { ledger, rng } = setUp(3);
    const accounts = openVanillaAccounts(ledger);
    const result = runVanillaChain(ledger, rng, REGIONS.vanillaCoast!, 'vanilla-field-1', accounts);

    expect(result.greenMassUg).toBeGreaterThan(0n);
    expect(result.curedMassUg).toBeGreaterThan(0n);
    expect(result.curedMassUg).toBeLessThan(result.greenMassUg);
    expect(ledger.audit().ok).toBe(true);

    // Every declared moisture loss plus the cured mass reconciles exactly to
    // the green mass harvested.
    const totalLoss = result.sweatMoistureLossUg + result.sunDryMoistureLossUg + result.conditionMoistureLossUg;
    expect(result.curedMassUg + totalLoss).toBe(result.greenMassUg);
  });

  it('reconciles exactly across a spread of seeds', () => {
    for (const seed of [1, 5, 21, 500]) {
      const { ledger, rng } = setUp(seed);
      const accounts = openVanillaAccounts(ledger);
      const result = runVanillaChain(ledger, rng, REGIONS.vanillaCoast!, `vanilla-${seed}`, accounts);
      const totalLoss = result.sweatMoistureLossUg + result.sunDryMoistureLossUg + result.conditionMoistureLossUg;
      expect(result.curedMassUg + totalLoss).toBe(result.greenMassUg);
      expect(ledger.audit().ok).toBe(true);
    }
  });
});
