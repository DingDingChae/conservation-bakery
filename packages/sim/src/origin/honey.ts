/**
 * Honey: foraged nectar, moisture-reduced by the hive to honey, plus beeswax
 * secreted from honey consumed.
 *
 * Real forage nectar is a dilute sugar solution (`forage-nectar.json`'s own
 * cited ~20%); bees concentrate it by fanning off water until it reaches
 * honey's real ~17% moisture — modelled as a real, balanced water loss via
 * `agri/harvest.ts`'s `dryGrain`, the same technique this directory already
 * uses for cocoa and vanilla. A stated simplification: real ripening also
 * inverts nectar's sucrose to glucose and fructose (the bees' own invertase,
 * as `honey.json`'s own file note documents), which this module does not
 * model as a separate molecular reaction — the moisture-loss mechanics are
 * real and exact, only the sugar's precise isomer identity is approximated,
 * the same class of simplification `scenario/firstChain.ts`'s milling stage
 * already accepts for its own registry-versus-actual-composition gap.
 *
 * Beeswax is secreted from honey the hive consumes as its own energy source.
 * `plant/unit.ts`'s `splitByProfile` reallocates a real, cited mass of
 * consumed honey between `beeswax.json`'s own real (markedly more reduced,
 * lower-oxygen) profile and a "spent" residue stream, at the widely cited
 * real ratio of roughly six to eight kilograms of honey consumed per
 * kilogram of wax secreted.
 */

import type { Composition, Element, Micrograms } from '../core/commodity.js';
import { compositionMass, partition } from '../core/commodity.js';
import type { AccountId, Ledger } from '../core/ledger.js';
import type { Rng } from '../clock/rng.js';
import { dryGrain } from '../agri/harvest.js';
import { buildProcessPosting, splitByProfile, type StreamProfile } from '../plant/unit.js';
import type { SubstanceRegistry } from '../substance/registry.js';
import { FORAGE_MEADOW } from './crops.js';
import { growAndHarvest } from './growth.js';
import { originResidueAccount, type OriginRegion } from './region.js';
import { accountComposition } from './util.js';

/** Matches `honey.json`'s own cited ~17% target moisture. */
export const HONEY_TARGET_MOISTURE = 0.17;

/** Real, widely cited beekeeping figure: a hive consumes roughly this many
 * kilograms of honey per kilogram of beeswax secreted; expressed here as the
 * wax's share of the honey consumed (1/7, the midpoint of the commonly cited
 * six-to-eight range). */
export const WAX_SHARE_OF_HONEY_CONSUMED = 1 / 7;

export interface HoneyChainAccounts {
  readonly nectar: AccountId;
  readonly honey: AccountId;
}

export function openHoneyAccounts(ledger: Ledger, prefix = 'honey'): HoneyChainAccounts {
  const accounts: HoneyChainAccounts = { nectar: `${prefix}.nectar`, honey: `${prefix}.honey` };
  for (const id of Object.values(accounts)) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  return accounts;
}

export interface HoneyChainResult {
  readonly nectarMassUg: Micrograms;
  readonly moistureLossUg: Micrograms;
  readonly honeyMassUg: Micrograms;
  readonly daysForaged: number;
}

export function runHoneyChain(
  ledger: Ledger,
  rng: Rng,
  region: OriginRegion,
  fieldId: string,
  accounts: HoneyChainAccounts,
): HoneyChainResult {
  const biomassAccount = `${fieldId}.biomass`;
  if (!ledger.hasAccount(biomassAccount)) {
    ledger.openAccount({ id: biomassAccount, kind: 'stock', label: `standing meadow forage at ${fieldId}` });
  }
  const residue = originResidueAccount(region);

  const harvest = growAndHarvest({
    ledger,
    rng,
    region,
    definition: FORAGE_MEADOW,
    fieldId,
    biomassAccount,
    primaryAccount: accounts.nectar,
    residueAccount: residue,
  });
  const nectarMassUg = harvest.primaryDryMassUg + harvest.waterAddedUg;

  const ripened = dryGrain({
    primaryAccount: accounts.nectar,
    dryMassUg: harvest.primaryDryMassUg,
    currentMoistureMassUg: harvest.waterAddedUg,
    targetMoistureContent: HONEY_TARGET_MOISTURE,
    process: 'origin:honey:ripen',
  });
  if (ripened.posting.entries.length > 0) ledger.post(ripened.posting);

  if (accounts.nectar !== accounts.honey) {
    const entries = [];
    for (const [commodity, amount] of ledger.balances(accounts.nectar)) {
      if (amount === 0n) continue;
      entries.push({ account: accounts.nectar, commodity, delta: -amount });
      entries.push({ account: accounts.honey, commodity, delta: amount });
    }
    if (entries.length > 0) ledger.post({ process: 'origin:honey:jar', entries });
  }

  return {
    nectarMassUg,
    moistureLossUg: ripened.waterRemovedUg,
    honeyMassUg: nectarMassUg - ripened.waterRemovedUg,
    daysForaged: harvest.daysGrown,
  };
}

export interface BeeswaxResult {
  readonly honeyConsumedUg: Micrograms;
  readonly waxMassUg: Micrograms;
  readonly spentMassUg: Micrograms;
}

/**
 * Secrete beeswax from a real, cited mass of honey consumed from
 * `accounts.honey`, crediting the wax to `waxAccount` and the "spent" residue
 * (the honey mass that did not become wax) to the region's residue account.
 */
export function secreteBeeswax(
  ledger: Ledger,
  registry: SubstanceRegistry,
  accounts: HoneyChainAccounts,
  region: OriginRegion,
  waxAccount: AccountId,
  honeyConsumedUg: Micrograms,
): BeeswaxResult {
  if (!ledger.hasAccount(waxAccount)) ledger.openAccount({ id: waxAccount, kind: 'stock', label: waxAccount });
  const residue = originResidueAccount(region);

  const available = accountComposition(ledger, accounts.honey);
  const availableMassUg = compositionMass(available);
  const consumedUg = honeyConsumedUg < availableMassUg ? honeyConsumedUg : availableMassUg;
  if (consumedUg <= 0n) return { honeyConsumedUg: 0n, waxMassUg: 0n, spentMassUg: 0n };

  // Scale the draw through partition() rather than flooring each element and closing the
  // remainder into whichever element happened to be last in Map order. That shortcut sums
  // correctly but is not proportionally safe: the whole remainder can land on a trace
  // element the account barely holds, and the draw is then refused for want of a few
  // micrograms of something incidental. Largest remainder spreads it where it belongs and
  // can never assign an element more than the account has.
  const elements = [...available.keys()];
  const shares = partition(
    consumedUg,
    elements.map((element) => available.get(element) ?? 0n),
  );
  const scaled = new Map<Element, Micrograms>();
  for (const [index, element] of elements.entries()) {
    const share = shares[index] ?? 0n;
    if (share !== 0n) scaled.set(element, share);
  }
  const consumedComposition: Composition = scaled;

  const streams: readonly StreamProfile[] = [
    { id: 'wax', elements: registry.get('beeswax').elements, targetShare: WAX_SHARE_OF_HONEY_CONSUMED },
    { id: 'spent', elements: registry.get('honey').elements, targetShare: 1 - WAX_SHARE_OF_HONEY_CONSUMED },
  ];
  const [waxComposition, spentComposition] = splitByProfile(consumedComposition, streams) as [Composition, Composition];
  ledger.post(
    buildProcessPosting({
      process: 'origin:honey:secrete-wax',
      inputs: [{ account: accounts.honey, composition: consumedComposition }],
      outputs: [
        { account: waxAccount, composition: waxComposition },
        { account: residue, composition: spentComposition },
      ],
    }),
  );

  return { honeyConsumedUg: consumedUg, waxMassUg: compositionMass(waxComposition), spentMassUg: compositionMass(spentComposition) };
}
