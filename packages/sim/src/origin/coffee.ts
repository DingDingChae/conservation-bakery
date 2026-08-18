/**
 * Coffee: cherry through depulping, fermentation/washing and drying to green
 * coffee.
 *
 * The cherry's bean fraction (`BEAN_SHARE_OF_CHERRY`) is separated from skin,
 * pulp and mucilage by a fixed real mass ratio (`util.ts`'s
 * `splitByFixedRatio`, the same technique `cocoa.ts` uses to open a pod), the
 * pulp/skin residue is credited to the region's own residue account, and the
 * parchment-covered bean is washed and dried down to `coffee-bean-green.json`'s
 * own cited target moisture via `agri/harvest.ts`'s `dryGrain`.
 */

import type { Micrograms } from '../core/commodity.js';
import type { AccountId, Ledger } from '../core/ledger.js';
import type { Rng } from '../clock/rng.js';
import { partition } from '../core/commodity.js';
import { dryGrain } from '../agri/harvest.js';
import { COFFEE_TREE } from './crops.js';
import { growAndHarvest } from './growth.js';
import { originResidueAccount, type OriginRegion } from './region.js';
import { splitByFixedRatio } from './util.js';

/** Real, widely cited fraction of a fresh coffee cherry's mass that is bean
 * (with parchment and mucilage still attached); the rest is skin and pulp
 * (coffee post-harvest processing literature). */
export const BEAN_SHARE_OF_CHERRY = 0.2;

/** Matches `coffee-bean-green.json`'s own cited ~10.5% target moisture. */
export const GREEN_TARGET_MOISTURE = 0.105;

export interface CoffeeChainAccounts {
  readonly cherry: AccountId;
  readonly bean: AccountId;
}

export function openCoffeeAccounts(ledger: Ledger, prefix = 'coffee'): CoffeeChainAccounts {
  const accounts: CoffeeChainAccounts = { cherry: `${prefix}.cherry`, bean: `${prefix}.bean` };
  for (const id of Object.values(accounts)) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  return accounts;
}

export interface CoffeeChainResult {
  readonly cherryMassUg: Micrograms;
  readonly pulpMassUg: Micrograms;
  readonly beanMassUg: Micrograms;
  readonly dryingMoistureLossUg: Micrograms;
  readonly greenBeanMassUg: Micrograms;
  readonly daysGrown: number;
}

export function runCoffeeChain(
  ledger: Ledger,
  rng: Rng,
  region: OriginRegion,
  fieldId: string,
  accounts: CoffeeChainAccounts,
): CoffeeChainResult {
  const biomassAccount = `${fieldId}.biomass`;
  if (!ledger.hasAccount(biomassAccount)) {
    ledger.openAccount({ id: biomassAccount, kind: 'stock', label: `standing coffee biomass at ${fieldId}` });
  }
  const residue = originResidueAccount(region);

  const harvest = growAndHarvest({
    ledger,
    rng,
    region,
    definition: COFFEE_TREE,
    fieldId,
    biomassAccount,
    primaryAccount: accounts.cherry,
    residueAccount: residue,
  });
  const cherryMassUg = harvest.primaryDryMassUg + harvest.waterAddedUg;

  const beanWeight = BigInt(Math.round(BEAN_SHARE_OF_CHERRY * 1_000_000));
  const pulpWeight = BigInt(Math.round((1 - BEAN_SHARE_OF_CHERRY) * 1_000_000));
  const depulped = splitByFixedRatio(
    ledger,
    accounts.cherry,
    [
      { account: accounts.bean, weight: beanWeight },
      { account: residue, weight: pulpWeight },
    ],
    'origin:coffee:depulp',
  );
  ledger.post(depulped.posting);
  const beanMassUg = depulped.massUg[0] ?? 0n;
  const pulpMassUg = depulped.massUg[1] ?? 0n;

  const [beanMoistureShare = 0n] = partition(harvest.waterAddedUg, [beanWeight, pulpWeight]);
  const dryMassUg = beanMassUg - beanMoistureShare;

  const dried = dryGrain({
    primaryAccount: accounts.bean,
    dryMassUg,
    currentMoistureMassUg: beanMoistureShare,
    targetMoistureContent: GREEN_TARGET_MOISTURE,
    process: 'origin:coffee:wash-and-dry',
  });
  if (dried.posting.entries.length > 0) ledger.post(dried.posting);

  return {
    cherryMassUg,
    pulpMassUg,
    beanMassUg,
    dryingMoistureLossUg: dried.waterRemovedUg,
    greenBeanMassUg: dryMassUg + (beanMoistureShare - dried.waterRemovedUg),
    daysGrown: harvest.daysGrown,
  };
}
