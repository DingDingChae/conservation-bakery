import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { Rng } from '../clock/rng.js';
import { seedWorld } from '../world/accounts.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';
import { originResidueAccount, REGIONS, seedCropRegion } from './region.js';
import { openCocoaAccounts, runCocoaChain } from './cocoa.js';

function setUp(seed: number) {
  const ledger = new Ledger();
  seedCropRegion(ledger, REGIONS.cocoaBelt!);
  seedWorld(ledger, { fields: [] }); // seals the ledger — must run after every origin region is seeded
  const rng = Rng.fromSeed(seed);
  const registry = defaultSubstanceRegistry();
  return { ledger, rng, registry };
}

describe('cocoa chain', () => {
  it('grows, ferments, dries, roasts, winnows and presses a real pod to butter and powder', () => {
    const { ledger, rng, registry } = setUp(1);
    const accounts = openCocoaAccounts(ledger);
    const result = runCocoaChain(ledger, rng, registry, REGIONS.cocoaBelt!, 'cocoa-field-1', accounts);

    expect(result.podMassUg).toBeGreaterThan(0n);
    expect(result.huskMassUg).toBeGreaterThan(0n);
    expect(result.nibMassUg).toBeGreaterThan(0n);
    expect(result.shellMassUg).toBeGreaterThan(0n);
    expect(result.butterMassUg).toBeGreaterThan(0n);
    expect(result.powderMassUg).toBeGreaterThan(0n);

    // The whole world stays exactly in balance throughout — CONTRACT.md rule 1.
    const audit = ledger.audit();
    expect(audit.ok).toBe(true);

    // The flagship reconciliation: pod mass in equals every declared loss
    // (husk, fermentation respiration, fermentation/drying/roasting moisture,
    // shell) plus butter and powder mass out, exactly.
    const totalLosses =
      result.huskMassUg +
      result.fermentationRespiredUg +
      result.fermentationMoistureLossUg +
      result.dryingMoistureLossUg +
      result.roastingMoistureLossUg +
      result.shellMassUg;
    const totalOut = totalLosses + result.butterMassUg + result.powderMassUg;
    expect(totalOut).toBe(result.podMassUg);

    // Butter and powder together are exactly the liquor pressed (nib mass).
    expect(result.butterMassUg + result.powderMassUg).toBe(result.nibMassUg);

    // Husk and shell really did go to the region's residue account, not
    // nowhere.
    const residueBalance = ledger.balances(originResidueAccount(REGIONS.cocoaBelt!));
    let residueMass = 0n;
    for (const [commodity, amount] of residueBalance) {
      if (commodity.startsWith('el:')) residueMass += amount;
    }
    expect(residueMass).toBe(result.treeResidueMassUg + result.huskMassUg + result.shellMassUg);
  });

  it('is deterministic for a fixed seed', () => {
    const a = setUp(42);
    const b = setUp(42);
    const accountsA = openCocoaAccounts(a.ledger);
    const accountsB = openCocoaAccounts(b.ledger);
    const resultA = runCocoaChain(a.ledger, a.rng, a.registry, REGIONS.cocoaBelt!, 'f', accountsA);
    const resultB = runCocoaChain(b.ledger, b.rng, b.registry, REGIONS.cocoaBelt!, 'f', accountsB);
    expect(resultA.podMassUg).toBe(resultB.podMassUg);
    expect(resultA.butterMassUg).toBe(resultB.butterMassUg);
    expect(resultA.powderMassUg).toBe(resultB.powderMassUg);
  });

  it('reconciles exactly across a spread of seeds (wide input range)', () => {
    for (const seed of [2, 7, 13, 99, 12345]) {
      const { ledger, rng, registry } = setUp(seed);
      const accounts = openCocoaAccounts(ledger);
      const result = runCocoaChain(ledger, rng, registry, REGIONS.cocoaBelt!, `cocoa-${seed}`, accounts);

      const totalOut =
        result.huskMassUg +
        result.fermentationRespiredUg +
        result.fermentationMoistureLossUg +
        result.dryingMoistureLossUg +
        result.roastingMoistureLossUg +
        result.shellMassUg +
        result.butterMassUg +
        result.powderMassUg;
      expect(totalOut).toBe(result.podMassUg);
      expect(ledger.audit().ok).toBe(true);
    }
  });
});
