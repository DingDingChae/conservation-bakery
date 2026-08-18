import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { Rng } from '../clock/rng.js';
import { seedWorld } from '../world/accounts.js';
import { REGIONS, seedCropRegion } from './region.js';
import { harvestCherries, harvestStrawberries } from './berries.js';

function setUp(regionId: keyof typeof REGIONS, seed: number) {
  const ledger = new Ledger();
  seedCropRegion(ledger, REGIONS[regionId]!);
  seedWorld(ledger, { fields: [] });
  return { ledger, rng: Rng.fromSeed(seed) };
}

describe('berries and stone fruit', () => {
  it('harvests real strawberries from a real field, balanced', () => {
    const { ledger, rng } = setUp('berryField', 1);
    const result = harvestStrawberries(ledger, rng, REGIONS.berryField!, 'strawberry-field-1', 'test.strawberries');
    expect(result.massUg).toBeGreaterThan(0n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('harvests real cherries from a real field, balanced', () => {
    const { ledger, rng } = setUp('stoneFruitOrchard', 1);
    const result = harvestCherries(ledger, rng, REGIONS.stoneFruitOrchard!, 'cherry-field-1', 'test.cherries');
    expect(result.massUg).toBeGreaterThan(0n);
    expect(ledger.audit().ok).toBe(true);
  });
});
