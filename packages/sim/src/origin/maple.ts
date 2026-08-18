/**
 * Maple: sap tapped from a sugar maple, boiled down to finished syrup.
 *
 * Real maple sap is roughly 2% sugar, boiled down to finished syrup at
 * roughly 66% sugar — the widely cited ~40:1 sap-to-syrup ratio. Modelled as
 * a real, balanced water loss via `agri/harvest.ts`'s `dryGrain`, exactly the
 * technique this directory already uses for grain, cocoa, vanilla and honey.
 */

import type { Micrograms } from '../core/commodity.js';
import type { AccountId, Ledger } from '../core/ledger.js';
import type { Rng } from '../clock/rng.js';
import { dryGrain } from '../agri/harvest.js';
import { SUGAR_MAPLE } from './crops.js';
import { growAndHarvest } from './growth.js';
import { originResidueAccount, type OriginRegion } from './region.js';

/** Matches `maple-syrup.json`'s own cited ~33% target moisture (~66 Brix). */
export const SYRUP_TARGET_MOISTURE = 0.33;

export interface MapleChainAccounts {
  readonly sap: AccountId;
  readonly syrup: AccountId;
}

export function openMapleAccounts(ledger: Ledger, prefix = 'maple'): MapleChainAccounts {
  const accounts: MapleChainAccounts = { sap: `${prefix}.sap`, syrup: `${prefix}.syrup` };
  for (const id of Object.values(accounts)) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  return accounts;
}

export interface MapleChainResult {
  readonly sapMassUg: Micrograms;
  readonly boilOffMassUg: Micrograms;
  readonly syrupMassUg: Micrograms;
  readonly daysTapped: number;
}

export function runMapleChain(
  ledger: Ledger,
  rng: Rng,
  region: OriginRegion,
  fieldId: string,
  accounts: MapleChainAccounts,
): MapleChainResult {
  const biomassAccount = `${fieldId}.biomass`;
  if (!ledger.hasAccount(biomassAccount)) {
    ledger.openAccount({ id: biomassAccount, kind: 'stock', label: `standing sugar maple sap reserve at ${fieldId}` });
  }
  const residue = originResidueAccount(region);

  const harvest = growAndHarvest({
    ledger,
    rng,
    region,
    definition: SUGAR_MAPLE,
    fieldId,
    biomassAccount,
    primaryAccount: accounts.sap,
    residueAccount: residue,
  });
  const sapMassUg = harvest.primaryDryMassUg + harvest.waterAddedUg;

  const boiled = dryGrain({
    primaryAccount: accounts.sap,
    dryMassUg: harvest.primaryDryMassUg,
    currentMoistureMassUg: harvest.waterAddedUg,
    targetMoistureContent: SYRUP_TARGET_MOISTURE,
    process: 'origin:maple:boil-down',
  });
  if (boiled.posting.entries.length > 0) ledger.post(boiled.posting);

  if (accounts.sap !== accounts.syrup) {
    const entries = [];
    for (const [commodity, amount] of ledger.balances(accounts.sap)) {
      if (amount === 0n) continue;
      entries.push({ account: accounts.sap, commodity, delta: -amount });
      entries.push({ account: accounts.syrup, commodity, delta: amount });
    }
    if (entries.length > 0) ledger.post({ process: 'origin:maple:bottle', entries });
  }

  return {
    sapMassUg,
    boilOffMassUg: boiled.waterRemovedUg,
    syrupMassUg: sapMassUg - boiled.waterRemovedUg,
    daysTapped: harvest.daysGrown,
  };
}
