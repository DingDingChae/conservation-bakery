/**
 * Minerals and chemistry: sodium bicarbonate refined from a natural trona
 * deposit, cream of tartar crystallised from vineyard lees, and the
 * industrial mineral leavening acids SAPP and MCP synthesised by real
 * molar-mass stoichiometry from a phosphate-rock deposit and a soda-mineral
 * deposit.
 *
 * Every synthesis below draws each element of the target compound's real
 * molecular formula (`origin/constants.ts`'s `splitMolecule`) from a specific,
 * physically appropriate source reservoir — phosphorus and calcium from
 * phosphate rock (real apatite-family deposits are oxide- and phosphate-rich),
 * sodium from a soda-mineral (trona-family) deposit, hydrogen from real
 * process water — clamped to what each source actually holds, so a synthesis
 * can never draw more of an element than the ledger says is really there.
 */

import type { Element, Micrograms } from '../core/commodity.js';
import { elementCommodity } from '../core/commodity.js';
import type { AccountId, Entry, Ledger } from '../core/ledger.js';
import { WORLD_ACCOUNTS } from '../world/accounts.js';
import { getComposition } from '../substance/registry.js';
import { type AtomCount, splitMolecule } from './constants.js';
import { originReservoirAccount, seedMineralRegion, type OriginRegion } from './region.js';
import { minBig } from './util.js';

/**
 * Draw `formula`'s real molar-mass-exact elemental split of `targetMassUg`,
 * one element at a time, from the source account `sources` designates for it
 * (clamped to what that source actually holds), crediting `destinationAccount`.
 * Returns the actual mass produced, which may be less than `targetMassUg` if
 * a source ran short on one element.
 */
export function synthesizeFromReservoirs(
  ledger: Ledger,
  sources: Readonly<Partial<Record<Element, AccountId>>>,
  formula: readonly AtomCount[],
  targetMassUg: Micrograms,
  destinationAccount: AccountId,
  process: string,
): Micrograms {
  if (targetMassUg <= 0n) return 0n;
  if (!ledger.hasAccount(destinationAccount)) {
    ledger.openAccount({ id: destinationAccount, kind: 'stock', label: destinationAccount });
  }
  const target = splitMolecule(targetMassUg, formula);
  const entries: Entry[] = [];
  let producedUg: Micrograms = 0n;

  for (const [element, wantedAmount] of target) {
    if (wantedAmount <= 0n) continue;
    const source = sources[element];
    if (!source) continue;
    const available = ledger.balance(source, elementCommodity(element));
    const drawn = minBig(wantedAmount, available);
    if (drawn <= 0n) continue;
    entries.push({ account: source, commodity: elementCommodity(element), delta: -drawn });
    entries.push({ account: destinationAccount, commodity: elementCommodity(element), delta: drawn });
    producedUg += drawn;
  }

  if (entries.length > 0) ledger.post({ process, entries });
  return producedUg;
}

// ---------------------------------------------------------------------------
// Sodium bicarbonate, refined from a real trona (soda-mineral) deposit.
// ---------------------------------------------------------------------------

/** Real trona (Na2CO3.NaHCO3.2H2O) composition — IUPAC molar masses, the same
 * technique `sodium-bicarbonate.json`'s own `source` field documents for the
 * pure salt itself. */
const TRONA_COMPOSITION: Readonly<Partial<Record<Element, number>>> = { Na: 0.243, C: 0.0637, H: 0.0268, O: 0.6665 };

export function seedSodaDeposit(ledger: Ledger, region: OriginRegion): void {
  seedFrom(ledger, region, TRONA_COMPOSITION);
}

/** Refine `targetMassUg` of sodium bicarbonate directly from `region`'s own
 * seeded trona reservoir, by the substance's own exact registered
 * composition — the natural deposit already carries Na, H, C and O in
 * roughly workable proportion, so no separate synthesis step is needed. */
export function refineSodiumBicarbonate(ledger: Ledger, region: OriginRegion, targetMassUg: Micrograms, destinationAccount: AccountId): Micrograms {
  return drawByRegisteredComposition(ledger, originReservoirAccount(region), 'sodium-bicarbonate', targetMassUg, destinationAccount, 'origin:minerals:refine-soda');
}

// ---------------------------------------------------------------------------
// Cream of tartar, crystallised from vineyard lees.
// ---------------------------------------------------------------------------

/** Real winemaking lees are potassium- and tartaric-acid-rich (the source of
 * cream of tartar's own KC4H5O6); this reservoir is seeded in roughly that
 * compound's own molar ratio, with a little extra organic "must" residue
 * folded into Ash. */
const VINEYARD_LEES_COMPOSITION: Readonly<Partial<Record<Element, number>>> = { K: 0.19, C: 0.24, H: 0.03, O: 0.48, Ash: 0.06 };

export function seedVineyard(ledger: Ledger, region: OriginRegion): void {
  seedFrom(ledger, region, VINEYARD_LEES_COMPOSITION);
}

export function crystalliseCreamOfTartar(ledger: Ledger, region: OriginRegion, targetMassUg: Micrograms, destinationAccount: AccountId): Micrograms {
  return drawByRegisteredComposition(ledger, originReservoirAccount(region), 'cream-of-tartar', targetMassUg, destinationAccount, 'origin:minerals:crystallise-tartrate');
}

// ---------------------------------------------------------------------------
// SAPP and MCP, synthesised from phosphate rock and a soda deposit.
// ---------------------------------------------------------------------------

/** Real apatite-family phosphate rock is oxide- and phosphate-rich, with
 * substantial associated calcium — illustrative, order-of-magnitude, in the
 * same spirit as `world/accounts.ts`'s own reservoir figures. */
const PHOSPHATE_ROCK_COMPOSITION: Readonly<Partial<Record<Element, number>>> = { Ca: 0.33, P: 0.14, O: 0.45, Ash: 0.08 };

export function seedPhosphateBelt(ledger: Ledger, region: OriginRegion): void {
  seedFrom(ledger, region, PHOSPHATE_ROCK_COMPOSITION);
}

const SAPP_FORMULA: readonly AtomCount[] = [
  { element: 'Na', atoms: 2 },
  { element: 'H', atoms: 2 },
  { element: 'P', atoms: 2 },
  { element: 'O', atoms: 7 },
];

const MCP_FORMULA: readonly AtomCount[] = [
  { element: 'Ca', atoms: 1 },
  { element: 'H', atoms: 4 },
  { element: 'P', atoms: 2 },
  { element: 'O', atoms: 8 },
];

/** Fund the ledger's own H2O reservoir (`groundwater`) as the hydrogen source
 * for a phosphate-acidification synthesis — real MCP and SAPP manufacture
 * both react phosphate rock with water and acid. */
const WATER_SOURCE: AccountId = WORLD_ACCOUNTS.groundwater;

export function synthesizeSapp(ledger: Ledger, phosphateRegion: OriginRegion, sodaRegion: OriginRegion, targetMassUg: Micrograms, destinationAccount: AccountId): Micrograms {
  return synthesizeFromReservoirs(
    ledger,
    {
      Na: originReservoirAccount(sodaRegion),
      P: originReservoirAccount(phosphateRegion),
      O: originReservoirAccount(phosphateRegion),
      H: WATER_SOURCE,
    },
    SAPP_FORMULA,
    targetMassUg,
    destinationAccount,
    'origin:minerals:synthesize-sapp',
  );
}

export function synthesizeMcp(ledger: Ledger, phosphateRegion: OriginRegion, targetMassUg: Micrograms, destinationAccount: AccountId): Micrograms {
  return synthesizeFromReservoirs(
    ledger,
    {
      Ca: originReservoirAccount(phosphateRegion),
      P: originReservoirAccount(phosphateRegion),
      O: originReservoirAccount(phosphateRegion),
      H: WATER_SOURCE,
    },
    MCP_FORMULA,
    targetMassUg,
    destinationAccount,
    'origin:minerals:synthesize-mcp',
  );
}

// ---------------------------------------------------------------------------
// Edible gold leaf, from a gold reef.
// ---------------------------------------------------------------------------

/** Au is not a tracked element (see `core/commodity.ts`); a gold reef's whole
 * seeded mass is therefore entirely `Ash`, exactly as `gold-leaf.json`'s own
 * file note explains. */
const GOLD_REEF_COMPOSITION: Readonly<Partial<Record<Element, number>>> = { Ash: 1 };

export function seedGoldReef(ledger: Ledger, region: OriginRegion): void {
  seedFrom(ledger, region, GOLD_REEF_COMPOSITION);
}

export function refineGoldLeaf(ledger: Ledger, region: OriginRegion, targetMassUg: Micrograms, destinationAccount: AccountId): Micrograms {
  return drawByRegisteredComposition(ledger, originReservoirAccount(region), 'gold-leaf', targetMassUg, destinationAccount, 'origin:minerals:refine-gold');
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

function seedFrom(ledger: Ledger, region: OriginRegion, composition: Readonly<Partial<Record<Element, number>>>): void {
  seedMineralRegion(ledger, region, composition);
}

/** Draw `targetMassUg` of `substanceId` (by its own exact registered
 * composition) from `reservoir`, clamped element by element to what the
 * reservoir actually holds, crediting `destinationAccount`. */
function drawByRegisteredComposition(
  ledger: Ledger,
  reservoir: AccountId,
  substanceId: string,
  targetMassUg: Micrograms,
  destinationAccount: AccountId,
  process: string,
): Micrograms {
  if (!ledger.hasAccount(destinationAccount)) {
    ledger.openAccount({ id: destinationAccount, kind: 'stock', label: destinationAccount });
  }
  const target = getComposition(substanceId, targetMassUg);
  const entries: Entry[] = [];
  let producedUg: Micrograms = 0n;
  for (const [element, wantedAmount] of target) {
    if (wantedAmount <= 0n) continue;
    const available = ledger.balance(reservoir, elementCommodity(element));
    const drawn = minBig(wantedAmount, available);
    if (drawn <= 0n) continue;
    entries.push({ account: reservoir, commodity: elementCommodity(element), delta: -drawn });
    entries.push({ account: destinationAccount, commodity: elementCommodity(element), delta: drawn });
    producedUg += drawn;
  }
  if (entries.length > 0) ledger.post({ process, entries });
  return producedUg;
}

