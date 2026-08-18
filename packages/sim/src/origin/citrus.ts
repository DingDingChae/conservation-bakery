/**
 * Citrus: orange through juicing (peel vs juice, by real composition) and
 * pectin extraction from the peel.
 *
 * Juicing splits the whole fruit's own exact composition between
 * `orange-juice.json` and `orange-peel.json` via `plant/unit.ts`'s
 * `splitByProfile` — the same composition-driven technique `plant/mill.ts`
 * uses for flour/bran/germ. Pectin extraction then splits the peel's own
 * composition between `pectin.json` and the remaining pomace (a real,
 * conserved by-product credited to the region's residue account), using a
 * real cited yield: pectin is typically 20-30% of dried citrus peel mass.
 */

import type { Composition, Micrograms } from '../core/commodity.js';
import { compositionMass } from '../core/commodity.js';
import type { AccountId, Ledger } from '../core/ledger.js';
import type { Rng } from '../clock/rng.js';
import { buildProcessPosting, splitByProfile, type StreamProfile } from '../plant/unit.js';
import type { SubstanceRegistry } from '../substance/registry.js';
import { CITRUS_TREE } from './crops.js';
import { growAndHarvest } from './growth.js';
import { originResidueAccount, type OriginRegion } from './region.js';
import { accountComposition } from './util.js';

/** Real, widely cited juice yield: roughly half a whole orange's mass presses
 * out as juice, the rest remaining as peel and pulp (citrus processing
 * literature). */
export const JUICE_SHARE_OF_FRUIT = 0.5;

/** Real, widely cited pectin content of dried citrus peel: roughly a quarter
 * of peel mass (citrus by-product/pectin extraction literature). */
export const PECTIN_SHARE_OF_PEEL = 0.25;

export interface CitrusChainAccounts {
  readonly fruit: AccountId;
  readonly juice: AccountId;
  readonly peel: AccountId;
  readonly pectin: AccountId;
}

export function openCitrusAccounts(ledger: Ledger, prefix = 'citrus'): CitrusChainAccounts {
  const accounts: CitrusChainAccounts = {
    fruit: `${prefix}.fruit`,
    juice: `${prefix}.juice`,
    peel: `${prefix}.peel`,
    pectin: `${prefix}.pectin`,
  };
  for (const id of Object.values(accounts)) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  return accounts;
}

export interface CitrusChainResult {
  readonly fruitMassUg: Micrograms;
  readonly juiceMassUg: Micrograms;
  readonly peelMassUg: Micrograms;
  readonly pectinMassUg: Micrograms;
  readonly pomaceMassUg: Micrograms;
  readonly daysGrown: number;
}

export function runCitrusChain(
  ledger: Ledger,
  rng: Rng,
  registry: SubstanceRegistry,
  region: OriginRegion,
  fieldId: string,
  accounts: CitrusChainAccounts,
): CitrusChainResult {
  const biomassAccount = `${fieldId}.biomass`;
  if (!ledger.hasAccount(biomassAccount)) {
    ledger.openAccount({ id: biomassAccount, kind: 'stock', label: `standing citrus biomass at ${fieldId}` });
  }
  const residue = originResidueAccount(region);

  const harvest = growAndHarvest({
    ledger,
    rng,
    region,
    definition: CITRUS_TREE,
    fieldId,
    biomassAccount,
    primaryAccount: accounts.fruit,
    residueAccount: residue,
  });
  const fruitMassUg = harvest.primaryDryMassUg + harvest.waterAddedUg;

  const fruitComposition = accountComposition(ledger, accounts.fruit);
  const juiceStreams: readonly StreamProfile[] = [
    { id: 'juice', elements: registry.get('orange-juice').elements, targetShare: JUICE_SHARE_OF_FRUIT },
    { id: 'peel', elements: registry.get('orange-peel').elements, targetShare: 1 - JUICE_SHARE_OF_FRUIT },
  ];
  const [juiceComposition, peelComposition] = splitByProfile(fruitComposition, juiceStreams) as [Composition, Composition];
  ledger.post(
    buildProcessPosting({
      process: 'origin:citrus:juice',
      inputs: [{ account: accounts.fruit, composition: fruitComposition }],
      outputs: [
        { account: accounts.juice, composition: juiceComposition },
        { account: accounts.peel, composition: peelComposition },
      ],
    }),
  );

  const pectinStreams: readonly StreamProfile[] = [
    { id: 'pectin', elements: registry.get('pectin').elements, targetShare: PECTIN_SHARE_OF_PEEL },
    { id: 'pomace', elements: registry.get('orange-peel').elements, targetShare: 1 - PECTIN_SHARE_OF_PEEL },
  ];
  const [pectinComposition, pomaceComposition] = splitByProfile(peelComposition, pectinStreams) as [Composition, Composition];
  ledger.post(
    buildProcessPosting({
      process: 'origin:citrus:extract-pectin',
      inputs: [{ account: accounts.peel, composition: peelComposition }],
      outputs: [
        { account: accounts.pectin, composition: pectinComposition },
        { account: residue, composition: pomaceComposition },
      ],
    }),
  );

  return {
    fruitMassUg,
    juiceMassUg: compositionMass(juiceComposition),
    peelMassUg: compositionMass(peelComposition),
    pectinMassUg: compositionMass(pectinComposition),
    pomaceMassUg: compositionMass(pomaceComposition),
    daysGrown: harvest.daysGrown,
  };
}
