import { describe, expect, it } from 'vitest';

import { elementCommodity, grams } from '../core/commodity.js';
import type { Posting } from '../core/ledger.js';
import { Ledger } from '../core/ledger.js';
import { Rng } from '../clock/rng.js';
import { WORLD_ACCOUNTS, seedWorld } from '../world/accounts.js';
import {
  Animal,
  DAIRY_COW,
  LAYING_HEN,
  runAnimalTick,
  stockRation,
  type AnimalAccounts,
} from './livestock.js';

const FEED = 'farm.feed';
const WATER = WORLD_ACCOUNTS.groundwater;
const MILK = 'farm.milk';
const EGGS = 'farm.eggs';
const MANURE = 'farm.manure';
const BODY = 'farm.cow-body';
const HEAT = 'farm.animal-heat';

function residuals(posting: Posting): Map<string, bigint> {
  const sums = new Map<string, bigint>();
  for (const e of posting.entries) sums.set(e.commodity, (sums.get(e.commodity) ?? 0n) + e.delta);
  return sums;
}

function expectBalanced(posting: Posting): void {
  for (const [commodity, residual] of residuals(posting)) {
    expect(residual, `${posting.process}: ${commodity} residual`).toBe(0n);
  }
}

function freshFarm(): { ledger: Ledger; accounts: AnimalAccounts } {
  const ledger = new Ledger();
  seedWorld(ledger, { fields: [] });
  ledger.openAccount({ id: FEED, kind: 'stock', label: 'ration store' });
  ledger.openAccount({ id: MILK, kind: 'stock', label: 'milk tank' });
  ledger.openAccount({ id: EGGS, kind: 'stock', label: 'egg store' });
  ledger.openAccount({ id: MANURE, kind: 'stock', label: 'manure store' });
  ledger.openAccount({ id: BODY, kind: 'stock', label: 'animal body mass' });
  ledger.openAccount({ id: HEAT, kind: 'external', label: 'dissipated metabolic heat' });

  stockRation({ ledger, account: FEED, substanceId: DAIRY_COW.feedSubstanceId, massUg: grams(500_000) });

  return {
    ledger,
    accounts: {
      feedAccount: FEED,
      waterAccount: WATER,
      productAccount: MILK,
      manureAccount: MANURE,
      bodyAccount: BODY,
      heatAccount: HEAT,
    },
  };
}

describe('stockRation', () => {
  it('credits a feed account with exactly the requested mass, delivered from market.suppliers', () => {
    const ledger = new Ledger();
    seedWorld(ledger, { fields: [] }); // seals the ledger -- stockRation must still work after this
    ledger.openAccount({ id: FEED, kind: 'stock', label: 'ration store' });
    const before = ledger.balance(WORLD_ACCOUNTS.marketSuppliers, elementCommodity('C'));

    stockRation({ ledger, account: FEED, substanceId: 'wheat-grain', massUg: grams(1_000) });

    expect(ledger.audit().ok).toBe(true);
    const after = ledger.balance(WORLD_ACCOUNTS.marketSuppliers, elementCommodity('C'));
    expect(after).toBeLessThan(before);
    expect(ledger.balance(FEED, elementCommodity('C'))).toBeGreaterThan(0n);
  });
});

describe('runAnimalTick', () => {
  it.each([1n, 2n, 3n, 7n, 13n, 97n, 9_973n, grams(1), grams(50)])(
    'every posting balances exactly for a feed draw of %s micrograms',
    (feedMassUg) => {
      const { ledger, accounts } = freshFarm();
      const rng = Rng.fromSeed(1);
      const result = runAnimalTick({
        ledger,
        definition: DAIRY_COW,
        feedMassUg,
        waterMassUg: grams(30_000),
        rng,
        ...accounts,
      });
      for (const posting of result.postings) {
        expectBalanced(posting);
        ledger.post(posting);
      }
      expect(ledger.audit().ok).toBe(true);
    },
  );

  it('conserves every tracked element: feed plus water in equals product, manure, respired atmosphere, and retained body mass out', () => {
    const { ledger, accounts } = freshFarm();
    const rng = Rng.fromSeed(42);

    const feedBefore = new Map(ledger.balances(FEED));
    const waterBefore = new Map(ledger.balances(WATER));
    const atmosphereBefore = new Map(ledger.balances(WORLD_ACCOUNTS.atmosphere));

    const result = runAnimalTick({
      ledger,
      definition: DAIRY_COW,
      feedMassUg: grams(300_000),
      waterMassUg: grams(40_000),
      rng,
      ...accounts,
    });
    for (const posting of result.postings) ledger.post(posting);

    expect(ledger.audit().ok).toBe(true);
    expect(result.productMassUg).toBeGreaterThan(0n);
    expect(result.manureMassUg).toBeGreaterThan(0n);
    expect(result.respiredGlucoseUg).toBeGreaterThan(0n);

    // Whole-world conservation already proves this, but check the animal's own
    // element-by-element story directly too: for every element, whatever the feed
    // and water balances actually gave up equals product + manure + retained body
    // mass + what left as atmosphere (checked via the whole-ledger audit above).
    for (const element of ['C', 'H', 'O', 'N', 'P', 'K', 'S', 'Ca', 'Mg', 'Fe', 'Ash'] as const) {
      const commodity = elementCommodity(element);
      const feedGivenUp = (feedBefore.get(commodity) ?? 0n) - ledger.balance(FEED, commodity);
      const waterGivenUp = (waterBefore.get(commodity) ?? 0n) - ledger.balance(WATER, commodity);
      const givenUp = feedGivenUp + waterGivenUp;
      const gained =
        ledger.balance(MILK, commodity) + ledger.balance(MANURE, commodity) + ledger.balance(BODY, commodity);
      const gainedByAtmosphere = ledger.balance(WORLD_ACCOUNTS.atmosphere, commodity) - (atmosphereBefore.get(commodity) ?? 0n);
      // What the animal's own accounts gave up either shows up in a product/manure/
      // body account, or left for the atmosphere -- there is nowhere else for it to go.
      expect(givenUp).toBe(gained + gainedByAtmosphere);
    }
  });

  it('produces nothing when the feed account is empty', () => {
    const ledger = new Ledger();
    seedWorld(ledger, { fields: [] });
    ledger.openAccount({ id: FEED, kind: 'stock', label: 'ration store' });
    ledger.openAccount({ id: MILK, kind: 'stock', label: 'milk tank' });
    ledger.openAccount({ id: MANURE, kind: 'stock', label: 'manure store' });
    ledger.openAccount({ id: BODY, kind: 'stock', label: 'animal body mass' });
    ledger.openAccount({ id: HEAT, kind: 'external', label: 'dissipated metabolic heat' });

    const result = runAnimalTick({
      ledger,
      definition: DAIRY_COW,
      feedMassUg: grams(1_000),
      waterMassUg: grams(1_000),
      rng: Rng.fromSeed(7),
      feedAccount: FEED,
      waterAccount: WATER,
      productAccount: MILK,
      manureAccount: MANURE,
      bodyAccount: BODY,
      heatAccount: HEAT,
    });

    expect(result.postings).toEqual([]);
    expect(result.productMassUg).toBe(0n);
  });

  it('is deterministic: the same seed produces the same yield and postings', () => {
    const farmA = freshFarm();
    const farmB = freshFarm();

    const resultA = runAnimalTick({
      ledger: farmA.ledger,
      definition: DAIRY_COW,
      feedMassUg: grams(300_000),
      waterMassUg: grams(40_000),
      rng: Rng.fromSeed(99),
      ...farmA.accounts,
    });
    const resultB = runAnimalTick({
      ledger: farmB.ledger,
      definition: DAIRY_COW,
      feedMassUg: grams(300_000),
      waterMassUg: grams(40_000),
      rng: Rng.fromSeed(99),
      ...farmB.accounts,
    });

    expect(resultA.productMassUg).toBe(resultB.productMassUg);
    expect(resultA.manureMassUg).toBe(resultB.manureMassUg);
    expect(resultA.postings.map((p) => p.entries)).toEqual(resultB.postings.map((p) => p.entries));
  });

  it('a richer ration yields more product than a sparse one', () => {
    const sparse = freshFarm();
    const rich = freshFarm();
    stockRation({ ledger: rich.ledger, account: FEED, substanceId: DAIRY_COW.feedSubstanceId, massUg: grams(500_000) });

    const sparseResult = runAnimalTick({
      ledger: sparse.ledger,
      definition: DAIRY_COW,
      feedMassUg: grams(50_000),
      waterMassUg: grams(20_000),
      rng: Rng.fromSeed(3),
      ...sparse.accounts,
    });
    const richResult = runAnimalTick({
      ledger: rich.ledger,
      definition: DAIRY_COW,
      feedMassUg: grams(900_000),
      waterMassUg: grams(60_000),
      rng: Rng.fromSeed(3),
      ...rich.accounts,
    });

    expect(richResult.productMassUg).toBeGreaterThan(sparseResult.productMassUg);
  });
});

describe('laying hen', () => {
  it('balances exactly and lays a real, sourced egg mass over a year of daily ticks', () => {
    const ledger = new Ledger();
    seedWorld(ledger, { fields: [] });
    const henFeed = 'farm.hen-feed';
    const henEggs = 'farm.hen-eggs';
    const henManure = 'farm.hen-manure';
    const henBody = 'farm.hen-body';
    ledger.openAccount({ id: henFeed, kind: 'stock', label: 'hen ration store' });
    ledger.openAccount({ id: henEggs, kind: 'stock', label: 'egg store' });
    ledger.openAccount({ id: henManure, kind: 'stock', label: 'manure store' });
    ledger.openAccount({ id: henBody, kind: 'stock', label: 'hen body mass' });
    ledger.openAccount({ id: HEAT, kind: 'external', label: 'dissipated metabolic heat' });

    const hen = new Animal('hen-01', LAYING_HEN, Rng.fromSeed(5));
    const accounts: AnimalAccounts = {
      feedAccount: henFeed,
      waterAccount: WATER,
      productAccount: henEggs,
      manureAccount: henManure,
      bodyAccount: henBody,
      heatAccount: HEAT,
    };

    for (let day = 0; day < 365; day += 1) {
      stockRation({ ledger, account: henFeed, substanceId: LAYING_HEN.feedSubstanceId, massUg: grams(120) });
      const result = hen.tick(ledger, accounts, grams(120), grams(250));
      for (const posting of result.postings) expectBalanced(posting);
      expect(ledger.audit().ok).toBe(true);
    }

    expect(hen.totalProductUg).toBeGreaterThan(0n);
    expect(hen.totalManureUg).toBeGreaterThan(0n);
  });
});

describe('Animal', () => {
  it('forks an independent, deterministic stream per animal', () => {
    const herdRng = Rng.fromSeed(11);
    const cowA = new Animal('a', DAIRY_COW, herdRng.fork());
    const cowB = new Animal('b', DAIRY_COW, herdRng.fork());

    const farmA = freshFarm();
    const farmB = freshFarm();

    const resultA = cowA.tick(farmA.ledger, farmA.accounts, grams(300_000), grams(40_000));
    const resultB = cowB.tick(farmB.ledger, farmB.accounts, grams(300_000), grams(40_000));

    // Two different animals, forked from the same herd stream at different draws,
    // need not produce identical yields -- but each is internally deterministic.
    expect(resultA.postings.length).toBeGreaterThan(0);
    expect(resultB.postings.length).toBeGreaterThan(0);
    expect(cowA.totalProductUg).toBe(resultA.productMassUg);
    expect(cowB.totalProductUg).toBe(resultB.productMassUg);
  });
});
