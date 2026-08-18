import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { Rng } from '../clock/rng.js';
import { seedWorld } from '../world/accounts.js';
import { REGIONS, seedCropRegion } from './region.js';
import { openMapleAccounts, runMapleChain } from './maple.js';

function setUp(seed: number) {
  const ledger = new Ledger();
  seedCropRegion(ledger, REGIONS.sugarBush!);
  seedWorld(ledger, { fields: [] });
  return { ledger, rng: Rng.fromSeed(seed) };
}

describe('maple chain', () => {
  it('taps real sap and boils it down to syrup by real moisture reduction, exactly', () => {
    const { ledger, rng } = setUp(1);
    const accounts = openMapleAccounts(ledger);
    const result = runMapleChain(ledger, rng, REGIONS.sugarBush!, 'sugar-bush-1', accounts);

    expect(result.syrupMassUg).toBeGreaterThan(0n);
    expect(result.syrupMassUg + result.boilOffMassUg).toBe(result.sapMassUg);
    expect(ledger.audit().ok).toBe(true);
  });
});
