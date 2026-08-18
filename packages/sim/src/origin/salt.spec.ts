import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { grams } from '../core/commodity.js';
import { seedWorld } from '../world/accounts.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';
import { REGIONS } from './region.js';
import {
  evaporateSalt,
  mineSalt,
  openSaltEvaporationAccounts,
  openSaltMiningAccounts,
  seedHaliteRegion,
  seedSeawaterRegion,
} from './salt.js';

describe('salt by solar evaporation', () => {
  it('evaporates real seawater brine into pure salt and bittern, exactly', () => {
    const ledger = new Ledger();
    seedSeawaterRegion(ledger, REGIONS.saltCoast!);
    seedWorld(ledger, { fields: [] });
    const registry = defaultSubstanceRegistry();

    const accounts = openSaltEvaporationAccounts(ledger);
    const result = evaporateSalt(ledger, registry, REGIONS.saltCoast!, accounts, grams(10_000));

    expect(result.saltMassUg).toBeGreaterThan(0n);
    expect(result.waterEvaporatedUg).toBeGreaterThan(0n);
    expect(result.saltMassUg + result.bitternMassUg).toBe(result.brineMassUg - result.waterEvaporatedUg);
    expect(ledger.audit().ok).toBe(true);

    // The delivered salt is real sodium chloride: mostly Na and Cl.
    const naBalance = ledger.balance(accounts.salt, 'el:Na');
    const clBalance = ledger.balance(accounts.salt, 'el:Cl');
    expect(naBalance).toBeGreaterThan(0n);
    expect(clBalance).toBeGreaterThan(0n);
  });
});

describe('salt by mining', () => {
  it('refines real rock-salt ore into salt and tailings, exactly', () => {
    const ledger = new Ledger();
    seedHaliteRegion(ledger, REGIONS.saltMine!);
    seedWorld(ledger, { fields: [] });
    const registry = defaultSubstanceRegistry();

    const accounts = openSaltMiningAccounts(ledger);
    const result = mineSalt(ledger, registry, REGIONS.saltMine!, accounts, grams(5_000));

    expect(result.saltMassUg).toBeGreaterThan(0n);
    expect(result.tailingsMassUg).toBeGreaterThan(0n);
    expect(result.saltMassUg + result.tailingsMassUg).toBe(result.oreMassUg);
    expect(ledger.audit().ok).toBe(true);
  });
});
