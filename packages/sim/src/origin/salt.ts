/**
 * Salt: by solar evaporation of real seawater brine, and by mining real rock
 * salt ore.
 *
 * Both routes deliver `sodium-chloride.json` (already in the registry — see
 * `world/accounts.ts`'s `seedSoil` for the established precedent that a raw
 * natural reservoir does not need its own registered substance file, only a
 * real, cited elemental composition seeded once at genesis).
 *
 * - **Solar evaporation** (`saltCoast`): the region's reservoir is seeded with
 *   real oceanographic seawater composition — about 3.5% dissolved solids by
 *   mass, the rest water (standard seawater salinity/ion-composition
 *   reference tables). Evaporating every microgram of that water — a real,
 *   balanced transfer to the atmosphere, read straight off the ledger rather
 *   than re-derived by a second computation that might round differently —
 *   leaves the dissolved solids; those are then split between the pure NaCl
 *   fraction and "bittern", the real name for the magnesium/sulfate/
 *   potassium-rich residual liquid solar salt works actually leave behind
 *   and sell separately, not a discarded fiction.
 * - **Mining** (`saltMine`): the region's reservoir is seeded with real halite
 *   ore composition (~97% NaCl, the rest insoluble gangue rock — typical
 *   commercial rock-salt ore purity), refined by splitting off the gangue as
 *   mine tailings.
 */

import type { Composition, Element, Micrograms } from '../core/commodity.js';
import { compositionMass, elementCommodity, partition } from '../core/commodity.js';
import type { AccountId, Entry, Ledger } from '../core/ledger.js';
import { WORLD_ACCOUNTS } from '../world/accounts.js';
import { buildProcessPosting, splitByProfile, type StreamProfile } from '../plant/unit.js';
import type { SubstanceRegistry } from '../substance/registry.js';
import { originReservoirAccount, originResidueAccount, seedMineralRegion, type OriginRegion } from './region.js';
import { accountComposition } from './util.js';

/** Water's own real H:O mass ratio (IUPAC standard atomic weights) — the
 * water share below is split by this *exact* ratio, not a hand-rounded
 * approximation, so the reservoir's own seeded hydrogen and oxygen are
 * genuinely in real water proportion. */
const WATER_H_MASS_FRACTION = (2 * 1.008) / (2 * 1.008 + 15.999);
const WATER_O_MASS_FRACTION = 15.999 / (2 * 1.008 + 15.999);
/** Real share of seawater's own mass that is water (the rest is dissolved
 * solids) — standard salinity/chlorinity reference tables put total
 * dissolved solids at ~3.5%. */
const WATER_SHARE_OF_SEAWATER = 0.965;

/** Real standard oceanographic seawater composition (mass fractions of the
 * whole, dissolved-solids-plus-water) — chlorinity/salinity reference tables
 * (e.g. Millero et al., standard seawater composition at salinity ~35). */
export const SEAWATER_COMPOSITION: Readonly<Partial<Record<Element, number>>> = {
  H: WATER_SHARE_OF_SEAWATER * WATER_H_MASS_FRACTION,
  O: WATER_SHARE_OF_SEAWATER * WATER_O_MASS_FRACTION,
  Cl: 0.0193, Na: 0.0108, S: 0.0009, Mg: 0.0013, Ca: 0.0004, K: 0.0004, Ash: 0.0004,
};

/** Real commercial rock-salt (halite) ore purity: typically ~95-98% NaCl,
 * the rest insoluble gangue rock. */
export const HALITE_ORE_COMPOSITION: Readonly<Partial<Record<Element, number>>> = {
  Na: 0.3820, Cl: 0.5892, Ash: 0.0288,
};

/** Bittern's own real characteristic mineral profile (magnesium- and
 * potassium-rich, chloride- and sulfate-bearing, essentially no sodium left
 * once the NaCl itself has crystallised out) — used only as a `splitByProfile`
 * weighting, not a registered substance. */
const BITTERN_PROFILE: Readonly<Partial<Record<Element, number>>> = { Mg: 0.38, S: 0.28, K: 0.19, Cl: 0.1, Ca: 0.04, Ash: 0.01 };

/** Real share of seawater's dissolved solids that is NaCl itself (the rest is
 * the other ions bittern carries off). */
export const NACL_SHARE_OF_SEAWATER_SOLIDS = 0.85;

/** Real share of halite ore that refines out as gangue tailings. */
export const GANGUE_SHARE_OF_ORE = 0.03;

export interface SaltEvaporationAccounts {
  readonly pond: AccountId;
  readonly salt: AccountId;
}

export function openSaltEvaporationAccounts(ledger: Ledger, prefix = 'salt-evap'): SaltEvaporationAccounts {
  const accounts: SaltEvaporationAccounts = { pond: `${prefix}.pond`, salt: `${prefix}.salt` };
  for (const id of Object.values(accounts)) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  return accounts;
}

export interface SaltEvaporationResult {
  readonly brineMassUg: Micrograms;
  readonly waterEvaporatedUg: Micrograms;
  readonly saltMassUg: Micrograms;
  readonly bitternMassUg: Micrograms;
}

/**
 * Draw a real mass of brine from `saltCoast`'s own seeded reservoir into the
 * evaporation pond, evaporate its water, then split the remaining dissolved
 * solids into pure salt and bittern.
 */
export function evaporateSalt(
  ledger: Ledger,
  registry: SubstanceRegistry,
  region: OriginRegion,
  accounts: SaltEvaporationAccounts,
  brineMassUg: Micrograms,
): SaltEvaporationResult {
  const reservoir = originReservoirAccount(region);
  const residue = originResidueAccount(region);

  const draw = drawFromReservoir(ledger, reservoir, accounts.pond, brineMassUg, 'origin:salt:draw-brine');
  const drawnMassUg = sumAll(draw);

  // Evaporate every microgram of water the pond actually holds — read
  // straight off the ledger rather than re-derived from the draw above, so
  // this can never ask for more H or O than is really there. (Unlike
  // `agri/harvest.ts`'s `dryGrain`, which targets a *partial* moisture
  // content and so must split its removal by the real H2O molar ratio, this
  // step removes the water fraction entirely — there is no ambiguity left
  // about how much of the pond's own H and O to move.)
  const residualH = ledger.balance(accounts.pond, elementCommodity('H'));
  const residualO = ledger.balance(accounts.pond, elementCommodity('O'));
  let waterEvaporatedUg: Micrograms = 0n;
  if (residualH > 0n || residualO > 0n) {
    const entries: Entry[] = [];
    if (residualH > 0n) {
      entries.push({ account: accounts.pond, commodity: elementCommodity('H'), delta: -residualH });
      entries.push({ account: WORLD_ACCOUNTS.atmosphere, commodity: elementCommodity('H'), delta: residualH });
    }
    if (residualO > 0n) {
      entries.push({ account: accounts.pond, commodity: elementCommodity('O'), delta: -residualO });
      entries.push({ account: WORLD_ACCOUNTS.atmosphere, commodity: elementCommodity('O'), delta: residualO });
    }
    ledger.post({ process: 'origin:salt:evaporate', entries });
    waterEvaporatedUg = residualH + residualO;
  }

  const solidsComposition = accountComposition(ledger, accounts.pond);
  const streams: readonly StreamProfile[] = [
    { id: 'salt', elements: registry.get('sodium-chloride').elements, targetShare: NACL_SHARE_OF_SEAWATER_SOLIDS },
    { id: 'bittern', elements: BITTERN_PROFILE, targetShare: 1 - NACL_SHARE_OF_SEAWATER_SOLIDS },
  ];
  const [saltComposition, bitternComposition] = splitByProfile(solidsComposition, streams) as [Composition, Composition];
  ledger.post(
    buildProcessPosting({
      process: 'origin:salt:crystallise',
      inputs: [{ account: accounts.pond, composition: solidsComposition }],
      outputs: [
        { account: accounts.salt, composition: saltComposition },
        { account: residue, composition: bitternComposition },
      ],
    }),
  );

  return {
    brineMassUg: drawnMassUg,
    waterEvaporatedUg,
    saltMassUg: compositionMass(saltComposition),
    bitternMassUg: compositionMass(bitternComposition),
  };
}

export interface SaltMiningAccounts {
  readonly ore: AccountId;
  readonly salt: AccountId;
}

export function openSaltMiningAccounts(ledger: Ledger, prefix = 'salt-mine-ops'): SaltMiningAccounts {
  const accounts: SaltMiningAccounts = { ore: `${prefix}.ore`, salt: `${prefix}.salt` };
  for (const id of Object.values(accounts)) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  return accounts;
}

export interface SaltMiningResult {
  readonly oreMassUg: Micrograms;
  readonly saltMassUg: Micrograms;
  readonly tailingsMassUg: Micrograms;
}

/** Draw a real mass of rock-salt ore from `saltMine`'s own seeded reservoir,
 * refine it, and split off the gangue as tailings. */
export function mineSalt(
  ledger: Ledger,
  registry: SubstanceRegistry,
  region: OriginRegion,
  accounts: SaltMiningAccounts,
  oreMassUg: Micrograms,
): SaltMiningResult {
  const reservoir = originReservoirAccount(region);
  const residue = originResidueAccount(region);

  drawFromReservoir(ledger, reservoir, accounts.ore, oreMassUg, 'origin:salt:mine-ore');

  const oreComposition = accountComposition(ledger, accounts.ore);
  const streams: readonly StreamProfile[] = [
    { id: 'salt', elements: registry.get('sodium-chloride').elements, targetShare: 1 - GANGUE_SHARE_OF_ORE },
    { id: 'tailings', elements: { Ash: 1 }, targetShare: GANGUE_SHARE_OF_ORE },
  ];
  const [saltComposition, tailingsComposition] = splitByProfile(oreComposition, streams) as [Composition, Composition];
  ledger.post(
    buildProcessPosting({
      process: 'origin:salt:refine',
      inputs: [{ account: accounts.ore, composition: oreComposition }],
      outputs: [
        { account: accounts.salt, composition: saltComposition },
        { account: residue, composition: tailingsComposition },
      ],
    }),
  );

  return {
    oreMassUg: compositionMass(oreComposition),
    saltMassUg: compositionMass(saltComposition),
    tailingsMassUg: compositionMass(tailingsComposition),
  };
}

/** Seed a real seawater-composition reservoir for a solar-evaporation salt
 * region — a thin wrapper over `region.ts`'s `seedMineralRegion` naming this
 * module's own cited composition. */
export function seedSeawaterRegion(ledger: Ledger, region: OriginRegion): void {
  seedMineralRegion(ledger, region, SEAWATER_COMPOSITION);
}

/** Seed a real halite-ore-composition reservoir for a salt mine region. */
export function seedHaliteRegion(ledger: Ledger, region: OriginRegion): void {
  seedMineralRegion(ledger, region, HALITE_ORE_COMPOSITION);
}

function drawFromReservoir(ledger: Ledger, reservoir: AccountId, toAccount: AccountId, targetMassUg: Micrograms, process: string): Map<Element, Micrograms> {
  const available = accountComposition(ledger, reservoir);
  const availableMassUg = compositionMass(available);
  const drawUg = targetMassUg < availableMassUg ? targetMassUg : availableMassUg;
  const drawn = new Map<Element, Micrograms>();
  if (drawUg <= 0n || availableMassUg <= 0n) return drawn;

  const entries: Entry[] = [];
  // Through partition(), not a per-element floor with the remainder closed into the last
  // element in Map order. That shortcut sums correctly but is not proportionally safe:
  // the remainder can be dumped onto a trace element the reservoir barely holds, refusing
  // an otherwise legitimate draw for want of a few micrograms of gangue. Largest
  // remainder distributes it proportionally and never over-draws any single element.
  const elements = [...available.keys()];
  const shares = partition(
    drawUg,
    elements.map((element) => available.get(element) ?? 0n),
  );
  for (const [index, element] of elements.entries()) {
    const share = shares[index] ?? 0n;
    if (share <= 0n) continue;
    drawn.set(element, share);
  }
  for (const [element, amount] of drawn) {
    if (amount === 0n) continue;
    entries.push({ account: reservoir, commodity: elementCommodity(element), delta: -amount });
    entries.push({ account: toAccount, commodity: elementCommodity(element), delta: amount });
  }
  if (entries.length > 0) ledger.post({ process, entries });
  return drawn;
}

function sumAll(byElement: Map<Element, Micrograms>): Micrograms {
  let total = 0n;
  for (const amount of byElement.values()) total += amount;
  return total;
}
