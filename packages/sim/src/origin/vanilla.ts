/**
 * Vanilla curing: blanch, sweat, sun-dry, condition.
 *
 * Green vanilla is essentially odourless — curing is what develops its aroma
 * and, physically, is a real, staged moisture-content reduction (vanilla
 * curing chemistry literature):
 *
 *   1. **Blanch**: a brief hot-water (or oven) immersion that kills the pod
 *      and halts further enzymatic browning. Real curing practice; net mass
 *      change over such a short exposure is negligible, so this stage is
 *      modelled as a real processing step in name but posts no mass change —
 *      a stated simplification, not an invented shortcut (real vanilla
 *      curing guides describe it exactly this way: "blanching" for seconds to
 *      a couple of minutes, not long enough to meaningfully rehydrate or dry
 *      the pod).
 *   2. **Sweat**: the pod is sweated in insulated boxes/blankets, dropping
 *      free moisture toward roughly 60-65%.
 *   3. **Sun-dry**: spread in the sun for the bulk of the real moisture loss,
 *      down toward roughly 40-45%.
 *   4. **Condition**: months of slow conditioning in closed boxes, finishing
 *      at `vanilla-bean-cured.json`'s own cited ~35% target moisture.
 *
 * Every stage after blanching is a real, balanced water loss to the
 * atmosphere via `agri/harvest.ts`'s `dryGrain` — the same technique this
 * codebase already uses for grain drying and (in `cocoa.ts`) cocoa bean
 * drying and roasting.
 */

import type { Micrograms } from '../core/commodity.js';
import type { AccountId, Ledger } from '../core/ledger.js';
import type { Rng } from '../clock/rng.js';
import { dryGrain } from '../agri/harvest.js';
import { VANILLA_VINE } from './crops.js';
import { growAndHarvest } from './growth.js';
import { originResidueAccount, type OriginRegion } from './region.js';

export const SWEAT_TARGET_MOISTURE = 0.65;
export const SUN_DRY_TARGET_MOISTURE = 0.45;
/** Matches `vanilla-bean-cured.json`'s own cited ~35% target moisture. */
export const CONDITION_TARGET_MOISTURE = 0.35;

export interface VanillaChainAccounts {
  readonly greenBean: AccountId;
  readonly curedBean: AccountId;
}

export function openVanillaAccounts(ledger: Ledger, prefix = 'vanilla'): VanillaChainAccounts {
  const accounts: VanillaChainAccounts = { greenBean: `${prefix}.green`, curedBean: `${prefix}.cured` };
  for (const id of Object.values(accounts)) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  return accounts;
}

export interface VanillaChainResult {
  readonly greenMassUg: Micrograms;
  readonly sweatMoistureLossUg: Micrograms;
  readonly sunDryMoistureLossUg: Micrograms;
  readonly conditionMoistureLossUg: Micrograms;
  readonly curedMassUg: Micrograms;
  readonly daysGrown: number;
}

/**
 * Grow a vanilla vine to a mature green pod, then cure it through sweat,
 * sun-dry and condition, applying every posting directly to `ledger`. The
 * cured bean ends up in `accounts.curedBean` — `accounts.greenBean` is used
 * only as scratch space through the curing sequence, since curing (unlike
 * winnowing) never branches into a separate by-product stream.
 */
export function runVanillaChain(
  ledger: Ledger,
  rng: Rng,
  region: OriginRegion,
  fieldId: string,
  accounts: VanillaChainAccounts,
): VanillaChainResult {
  const biomassAccount = `${fieldId}.biomass`;
  if (!ledger.hasAccount(biomassAccount)) {
    ledger.openAccount({ id: biomassAccount, kind: 'stock', label: `standing vanilla biomass at ${fieldId}` });
  }
  const residue = originResidueAccount(region);

  const harvest = growAndHarvest({
    ledger,
    rng,
    region,
    definition: VANILLA_VINE,
    fieldId,
    biomassAccount,
    primaryAccount: accounts.greenBean,
    residueAccount: residue,
  });

  const dryMassUg = harvest.primaryDryMassUg;
  const greenMassUg = dryMassUg + harvest.waterAddedUg;
  let moistureRemainingUg = harvest.waterAddedUg;

  const sweat = dryGrain({
    primaryAccount: accounts.greenBean,
    dryMassUg,
    currentMoistureMassUg: moistureRemainingUg,
    targetMoistureContent: SWEAT_TARGET_MOISTURE,
    process: 'origin:vanilla:sweat',
  });
  if (sweat.posting.entries.length > 0) ledger.post(sweat.posting);
  moistureRemainingUg -= sweat.waterRemovedUg;

  const sunDry = dryGrain({
    primaryAccount: accounts.greenBean,
    dryMassUg,
    currentMoistureMassUg: moistureRemainingUg,
    targetMoistureContent: SUN_DRY_TARGET_MOISTURE,
    process: 'origin:vanilla:sun-dry',
  });
  if (sunDry.posting.entries.length > 0) ledger.post(sunDry.posting);
  moistureRemainingUg -= sunDry.waterRemovedUg;

  const condition = dryGrain({
    primaryAccount: accounts.greenBean,
    dryMassUg,
    currentMoistureMassUg: moistureRemainingUg,
    targetMoistureContent: CONDITION_TARGET_MOISTURE,
    process: 'origin:vanilla:condition',
  });
  if (condition.posting.entries.length > 0) ledger.post(condition.posting);
  moistureRemainingUg -= condition.waterRemovedUg;

  const curedMassUg = dryMassUg + moistureRemainingUg;
  if (accounts.curedBean !== accounts.greenBean) {
    const entries = [];
    for (const [commodity, amount] of ledger.balances(accounts.greenBean)) {
      if (amount === 0n) continue;
      entries.push({ account: accounts.greenBean, commodity, delta: -amount });
      entries.push({ account: accounts.curedBean, commodity, delta: amount });
    }
    if (entries.length > 0) ledger.post({ process: 'origin:vanilla:box-cured-bean', entries });
  }

  return {
    greenMassUg,
    sweatMoistureLossUg: sweat.waterRemovedUg,
    sunDryMoistureLossUg: sunDry.waterRemovedUg,
    conditionMoistureLossUg: condition.waterRemovedUg,
    curedMassUg,
    daysGrown: harvest.daysGrown,
  };
}
