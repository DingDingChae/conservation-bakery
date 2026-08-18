/**
 * Berries and stone fruit: strawberry and cherry, harvested fresh with no
 * further processing chain (both are used as whole fruit) — a real, real-
 * time-limited growth cycle via `growth.ts`, exactly as `cocoa.ts`'s pod or
 * `citrus.ts`'s fruit are grown, without a subsequent transformation.
 */

import type { Micrograms } from '../core/commodity.js';
import type { AccountId, Ledger } from '../core/ledger.js';
import type { Rng } from '../clock/rng.js';
import type { CropDefinition } from '../agri/crop.js';
import { CHERRY_TREE, STRAWBERRY_PLANT } from './crops.js';
import { growAndHarvest } from './growth.js';
import { originResidueAccount, type OriginRegion } from './region.js';

export interface FreshHarvestResult {
  readonly massUg: Micrograms;
  readonly daysGrown: number;
}

function harvestFresh(ledger: Ledger, rng: Rng, region: OriginRegion, definition: CropDefinition, fieldId: string, fruitAccount: AccountId): FreshHarvestResult {
  const biomassAccount = `${fieldId}.biomass`;
  if (!ledger.hasAccount(biomassAccount)) {
    ledger.openAccount({ id: biomassAccount, kind: 'stock', label: `standing ${definition.name} biomass at ${fieldId}` });
  }
  if (!ledger.hasAccount(fruitAccount)) {
    ledger.openAccount({ id: fruitAccount, kind: 'stock', label: fruitAccount });
  }
  const harvest = growAndHarvest({
    ledger,
    rng,
    region,
    definition,
    fieldId,
    biomassAccount,
    primaryAccount: fruitAccount,
    residueAccount: originResidueAccount(region),
  });
  return { massUg: harvest.primaryDryMassUg + harvest.waterAddedUg, daysGrown: harvest.daysGrown };
}

export function harvestStrawberries(ledger: Ledger, rng: Rng, region: OriginRegion, fieldId: string, fruitAccount: AccountId): FreshHarvestResult {
  return harvestFresh(ledger, rng, region, STRAWBERRY_PLANT, fieldId, fruitAccount);
}

export function harvestCherries(ledger: Ledger, rng: Rng, region: OriginRegion, fieldId: string, fruitAccount: AccountId): FreshHarvestResult {
  return harvestFresh(ledger, rng, region, CHERRY_TREE, fieldId, fruitAccount);
}
