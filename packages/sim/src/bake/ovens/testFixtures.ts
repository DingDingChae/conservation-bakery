/**
 * Shared test scaffolding for this directory's own spec files — not part of
 * the public oven-family surface (not re-exported from `index.ts`), the same
 * role `provenance/fixture.ts` plays for that directory's tests.
 */

import { elementCommodity, grams, type CommodityId } from '../../core/commodity.js';
import { GENESIS, Ledger, type AccountId } from '../../core/ledger.js';
import { WORLD_ACCOUNTS, splitMolecule } from '../../world/accounts.js';

export const TEST_ACCOUNTS = {
  product: 'test:product',
  fuel: 'test:fuel-tank',
  ashBin: 'test:ash-bin',
  boilerWater: 'test:boiler-water',
  condensate: 'test:condensate-drain',
  chamberZone: 'test:chamber-zone',
} as const;

/** Generous starting water mass funded into the test product account, in
 * exact H2O molar-mass proportion, so any family's evaporation posting has
 * real elemental mass to draw down from a real composition rather than an
 * account that merely happens to share a number with `moistureRemainingUg`. */
const PRODUCT_WATER_RESERVE_UG = grams(1_000_000);

/** A fresh, unsealed ledger with every account a family under test might
 * touch already open — product (pre-funded with real water composition), fuel,
 * an ash bin, boiler/condensate water, a product-zone chamber (distinct from
 * the world atmosphere, to test whether a family's combustion products do or
 * do not reach it), plus the fixed world accounts every family's default
 * sinks/sources point at. */
export function buildOvenTestLedger(): Ledger {
  const ledger = new Ledger();
  ledger.openAccount({ id: TEST_ACCOUNTS.product, kind: 'stock', label: 'test product' });
  ledger.openAccount({ id: TEST_ACCOUNTS.fuel, kind: 'stock', label: 'test fuel tank' });
  ledger.openAccount({ id: TEST_ACCOUNTS.ashBin, kind: 'stock', label: 'test ash bin' });
  ledger.openAccount({ id: TEST_ACCOUNTS.boilerWater, kind: 'stock', label: 'test boiler feed water' });
  ledger.openAccount({ id: TEST_ACCOUNTS.condensate, kind: 'stock', label: 'test condensate drain' });
  ledger.openAccount({ id: TEST_ACCOUNTS.chamberZone, kind: 'reservoir', label: 'test product-zone chamber air' });
  ledger.openAccount({ id: WORLD_ACCOUNTS.atmosphere, kind: 'reservoir', label: 'world atmosphere' });
  ledger.openAccount({ id: WORLD_ACCOUNTS.space, kind: 'external', label: 'space sink' });
  ledger.openAccount({ id: WORLD_ACCOUNTS.marketUtilities, kind: 'external', label: 'grid' });

  const water = splitMolecule(PRODUCT_WATER_RESERVE_UG, [
    { element: 'H', atoms: 2 },
    { element: 'O', atoms: 1 },
  ]);
  fund(ledger, TEST_ACCOUNTS.product, elementCommodity('H'), water.get('H') ?? 0n);
  fund(ledger, TEST_ACCOUNTS.product, elementCommodity('O'), water.get('O') ?? 0n);

  return ledger;
}

/** Post a genesis draw of `amount` of `commodity` into `account` — a real,
 * balanced source, exactly like `world/accounts.ts`'s own genesis seeding,
 * just scoped to what one test needs rather than a whole world. */
export function fund(ledger: Ledger, account: AccountId, commodity: CommodityId, amount: bigint): void {
  if (amount === 0n) return;
  ledger.post({
    process: 'test:fund',
    entries: [
      { account: GENESIS, commodity, delta: -amount },
      { account, commodity, delta: amount },
    ],
  });
}
