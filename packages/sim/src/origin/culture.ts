/**
 * Cultures: baker's yeast propagation, and a sourdough starter built from it.
 *
 * Real industrial baker's yeast production propagates Saccharomyces cerevisiae
 * *aerobically* on a sugar feed (traditionally cane or beet molasses) plus a
 * nitrogen/mineral nutrient charge, precisely because aerobic respiration
 * maximises cell (biomass) yield rather than ethanol yield — the opposite
 * choice from brewing or `bake/leavening.ts`'s anaerobic `fermentGlucose`,
 * which trades biomass for ethanol and CO2 in a dough that has no free
 * oxygen available. A widely cited industrial yield figure is that aerobic
 * propagation converts roughly half the sugar substrate's mass into yeast
 * dry-cell mass, the rest being respired for growth energy — this module's
 * `YEAST_YIELD_FRACTION`.
 *
 * The mechanism mirrors `agri/livestock.ts`'s `runAnimalTick` closely: yeast
 * product is drawn from the feed by real composition, clamped element by
 * element to what the feed can actually supply (never manufacturing an
 * element the feed did not carry — `yeast.json`'s own file note explains why
 * its ash is phosphorus/potassium-weighted, and this is where that nutrient
 * charge actually gets used); the energy-yielding remainder is respired via
 * `world/exchange.ts`'s real `respire` (through `util.ts`'s clamped wrapper),
 * so the CO2 this module produces is, structurally, drawn out of the feed
 * account itself — never invented.
 */

import type { Element, Micrograms } from '../core/commodity.js';
import { ENERGY, elementCommodity, roundHalfEven } from '../core/commodity.js';
import type { AccountId, Entry, Ledger, Posting } from '../core/ledger.js';
import { WORLD_ACCOUNTS } from '../world/accounts.js';
import { getComposition, getSubstance } from '../substance/registry.js';
import { GLUCOSE_ENERGY_PER_UG } from './constants.js';
import { accountComposition, floorMicrograms, minBig, respireClamped } from './util.js';

/** Fund an account's stored chemical potential energy alongside a real mass
 * delivery, at glucose's own real specific combustion energy — the same
 * "organic dry matter is glucose-equivalent for respiration purposes"
 * convention `agri/crop.ts`'s `photosynthesize` calls and `agri/livestock.ts`'s
 * `stockRation` both already rely on (the latter via its own per-substance
 * `TYPICAL_ENERGY_CONTENT_J_PER_KG` table). Without this, `world/exchange.ts`'s
 * `respire` — which prices its energy release purely from a glucose-mass
 * figure, not the account's real composition — would have nothing to draw on. */
function fundEnergy(entries: Entry[], account: AccountId, massUg: Micrograms): void {
  if (massUg <= 0n) return;
  const energyUg = roundHalfEven(Number(massUg) * GLUCOSE_ENERGY_PER_UG);
  if (energyUg <= 0n) return;
  entries.push({ account, commodity: ENERGY, delta: energyUg });
  entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: ENERGY, delta: -energyUg });
}

const TRACKED_ELEMENTS: readonly Element[] = ['C', 'H', 'O', 'N', 'P', 'K', 'S', 'Na', 'Cl', 'Ca', 'Mg', 'Fe', 'Ash'];
const UG_PER_KG = 1_000_000_000;

/** Real, widely cited industrial aerobic yeast propagation yield: roughly
 * half the sugar substrate's mass converts to dry yeast cell mass, the rest
 * respired for growth energy (industrial biotechnology / brewing-science
 * literature). */
export const YEAST_YIELD_FRACTION = 0.5;

/**
 * Real industrial propagation media add a nitrogen/mineral nutrient charge
 * (ammonium and phosphate salts, magnesium sulfate, ...) alongside the sugar
 * feed, because sugar alone carries no nitrogen for the culture to build
 * protein from. Sized here as a fraction of the sugar charge's own mass —
 * illustrative, order-of-magnitude, the same spirit as `agri/crop.ts`'s
 * nutrient ratios.
 */
export const NUTRIENT_CHARGE_FRACTION = 0.06;

export interface YeastAccounts {
  readonly feed: AccountId;
  readonly culture: AccountId;
  /** Where feed mass that became neither yeast biomass nor respired CO2/H2O
   * ends up — a real, conserved spent-broth residue, never discarded. */
  readonly spentBroth: AccountId;
}

export function openYeastAccounts(ledger: Ledger, prefix = 'yeast'): YeastAccounts {
  const accounts: YeastAccounts = { feed: `${prefix}.feed`, culture: `${prefix}.culture`, spentBroth: `${prefix}.spent-broth` };
  for (const id of Object.values(accounts)) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  return accounts;
}

/**
 * Deliver a real sugar-and-nutrient propagation feed to `feedAccount` from
 * `market.suppliers` — a real, sourced, costed (in the sense every other
 * market delivery in this codebase is) charge, applied immediately, the same
 * convention `agri/livestock.ts`'s `stockRation` uses.
 */
export function fundYeastFeed(ledger: Ledger, feedAccount: AccountId, sugarMassUg: Micrograms, process?: string): Posting {
  const sugar = getComposition('sucrose', sugarMassUg);
  const yeastRecord = getSubstance('yeast');
  const nutrientMassUg = roundHalfEven(Number(sugarMassUg) * NUTRIENT_CHARGE_FRACTION);

  // The nutrient charge is proportioned like yeast's own mineral/nitrogen
  // content (N, P, K, S, Mg) — a real charge sized to what the culture will
  // actually need, not an arbitrary top-up.
  const nutrientElements: readonly Element[] = ['N', 'P', 'K', 'S', 'Mg'];
  let nutrientWeightTotal = 0;
  for (const element of nutrientElements) nutrientWeightTotal += yeastRecord.elements[element] ?? 0;

  const entries: Entry[] = [];
  const credit = (element: Element, amount: Micrograms) => {
    if (amount <= 0n) return;
    entries.push({ account: feedAccount, commodity: elementCommodity(element), delta: amount });
    entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity(element), delta: -amount });
  };

  for (const [element, amount] of sugar) credit(element, amount);
  if (nutrientWeightTotal > 0 && nutrientMassUg > 0n) {
    for (const element of nutrientElements) {
      const weight = yeastRecord.elements[element] ?? 0;
      if (weight <= 0) continue;
      credit(element, roundHalfEven((Number(nutrientMassUg) * weight) / nutrientWeightTotal));
    }
  }
  // Only the sugar carries fermentable, respirable organic matter — the
  // mineral nutrient charge has no stored chemical energy of its own.
  fundEnergy(entries, feedAccount, sugarMassUg);

  const posting: Posting = { process: process ?? 'origin:yeast:fund-feed', entries };
  return ledger.post(posting);
}

export interface YeastPropagationResult {
  readonly postings: readonly Posting[];
  readonly feedMassUg: Micrograms;
  readonly yeastMassUg: Micrograms;
  readonly co2MassUg: Micrograms;
  readonly spentBrothMassUg: Micrograms;
}

/**
 * Propagate one batch of yeast from whatever `accounts.feed` currently holds:
 * draw yeast biomass by `yeast.json`'s own real composition (clamped element
 * by element to what the feed supplies — `agri/livestock.ts`'s technique),
 * respire a real bounded share of what remains for growth energy (the CO2
 * this produces is drawn directly out of the feed), and credit whatever
 * neither draw could use to `accounts.spentBroth`.
 */
export function propagateYeast(ledger: Ledger, accounts: YeastAccounts, process = 'origin:yeast:propagate'): YeastPropagationResult {
  const feed = new Map<Element, Micrograms>();
  let feedTotalUg: Micrograms = 0n;
  for (const element of TRACKED_ELEMENTS) {
    const amount = ledger.balance(accounts.feed, elementCommodity(element));
    if (amount > 0n) feed.set(element, amount);
    feedTotalUg += amount;
  }
  if (feedTotalUg === 0n) {
    return { postings: [], feedMassUg: 0n, yeastMassUg: 0n, co2MassUg: 0n, spentBrothMassUg: 0n };
  }

  const postings: Posting[] = [];

  // Yeast product, drawn by real composition and clamped to what the feed
  // actually supplies of each element — see agri/livestock.ts's identical
  // reasoning for `productCeilingUg`.
  const yeastRecord = getSubstance('yeast');
  const targetYeastUg = roundHalfEven(Number(feedTotalUg) * YEAST_YIELD_FRACTION);
  let yeastCeilingUg = targetYeastUg;
  for (const element of TRACKED_ELEMENTS) {
    const ratio = (yeastRecord.elements[element] ?? 0) / UG_PER_KG;
    const available = feed.get(element) ?? 0n;
    if (ratio <= 0 || available <= 0n) continue;
    yeastCeilingUg = minBig(yeastCeilingUg, floorMicrograms(Number(available) / ratio));
  }
  const yeastMassUg = yeastCeilingUg > 0n ? yeastCeilingUg : 0n;

  let actualYeastMassUg: Micrograms = 0n;
  if (yeastMassUg > 0n) {
    const yeastComposition = getComposition('yeast', yeastMassUg);
    const entries: Entry[] = [];
    for (const [element, amount] of yeastComposition) {
      const draw = minBig(amount, feed.get(element) ?? 0n);
      if (draw <= 0n) continue;
      actualYeastMassUg += draw;
      entries.push({ account: accounts.feed, commodity: elementCommodity(element), delta: -draw });
      entries.push({ account: accounts.culture, commodity: elementCommodity(element), delta: draw });
    }
    if (entries.length > 0) postings.push(ledger.post({ process: `${process}:yeast`, entries }));
  }

  // Respire a real share of what remains — real aerobic propagation burns
  // roughly the rest of the consumed sugar for growth energy.
  const remainingUg = feedTotalUg - actualYeastMassUg;
  const respireTargetUg = roundHalfEven(Number(remainingUg) * 0.9);
  const respired = respireClamped(
    ledger,
    accounts.feed,
    WORLD_ACCOUNTS.space,
    WORLD_ACCOUNTS.atmosphere,
    respireTargetUg,
    `${process}:respire`,
  );
  const co2MassUg = respired?.glucoseMassUg ?? 0n;
  if (respired) postings.push(respired.posting);

  // Whatever the feed still holds after both draws is real, conserved spent
  // broth — never discarded from the ledger.
  const spentEntries: Entry[] = [];
  let spentBrothMassUg: Micrograms = 0n;
  for (const [commodity, amount] of ledger.balances(accounts.feed)) {
    if (amount === 0n || !commodity.startsWith('el:')) continue;
    spentEntries.push({ account: accounts.feed, commodity, delta: -amount });
    spentEntries.push({ account: accounts.spentBroth, commodity, delta: amount });
    spentBrothMassUg += amount;
  }
  if (spentEntries.length > 0) {
    const spentPosting: Posting = { process: `${process}:spent-broth`, entries: spentEntries };
    ledger.post(spentPosting);
    postings.push(spentPosting);
  }

  return { postings, feedMassUg: feedTotalUg, yeastMassUg: actualYeastMassUg, co2MassUg, spentBrothMassUg };
}

// ---------------------------------------------------------------------------
// Sourdough starter: an active flour-and-water culture, its own carbohydrate
// share already partly respired away by the wild culture living in it.
// ---------------------------------------------------------------------------

export interface SourdoughAccounts {
  readonly starter: AccountId;
}

export function openSourdoughAccounts(ledger: Ledger, prefix = 'sourdough'): SourdoughAccounts {
  const accounts: SourdoughAccounts = { starter: `${prefix}.starter` };
  if (!ledger.hasAccount(accounts.starter)) ledger.openAccount({ id: accounts.starter, kind: 'stock', label: accounts.starter });
  return accounts;
}

/** Real 1:1 by mass (100% hydration) flour-and-water ratio, the common home-
 * and bakery-baking convention for maintaining a starter. */
export const STARTER_FLOUR_SHARE = 0.5;

/** Real, illustrative fraction of the fed flour's own carbohydrate the wild
 * yeast-and-lactobacilli culture respires away during one feeding/rise cycle
 * — matches `sourdough-starter.json`'s own file note. */
export const STARTER_RESPIRED_FRACTION = 0.05;

export interface FeedStarterResult {
  readonly postings: readonly Posting[];
  readonly totalMassUg: Micrograms;
  readonly co2MassUg: Micrograms;
}

/**
 * Feed a starter with real flour and water (delivered from `market.
 * suppliers`), then respire a real, bounded share of the fed flour's own
 * carbohydrate — the same real aerobic-respiration mechanism `propagateYeast`
 * uses, applied here to an already-active culture being topped up rather
 * than propagated from scratch.
 */
export function feedStarter(ledger: Ledger, accounts: SourdoughAccounts, totalFeedMassUg: Micrograms, process = 'origin:sourdough:feed'): FeedStarterResult {
  const flourMassUg = roundHalfEven(Number(totalFeedMassUg) * STARTER_FLOUR_SHARE);
  const waterMassUg = totalFeedMassUg - flourMassUg;

  const flour = getComposition('wheat-flour-white', flourMassUg);
  const water = getComposition('water-liquid', waterMassUg);
  const entries: Entry[] = [];
  for (const [element, amount] of flour) {
    if (amount <= 0n) continue;
    entries.push({ account: accounts.starter, commodity: elementCommodity(element), delta: amount });
    entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity(element), delta: -amount });
  }
  for (const [element, amount] of water) {
    if (amount <= 0n) continue;
    entries.push({ account: accounts.starter, commodity: elementCommodity(element), delta: amount });
    entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity(element), delta: -amount });
  }
  // Only the flour carries fermentable, respirable organic matter — water has
  // no stored chemical energy of its own.
  fundEnergy(entries, accounts.starter, flourMassUg);
  const postings: Posting[] = [];
  if (entries.length > 0) postings.push(ledger.post({ process: `${process}:deliver`, entries }));

  const respireTargetUg = roundHalfEven(Number(flourMassUg) * STARTER_RESPIRED_FRACTION);
  const respired = respireClamped(ledger, accounts.starter, WORLD_ACCOUNTS.space, WORLD_ACCOUNTS.atmosphere, respireTargetUg, `${process}:respire`);
  const co2MassUg = respired?.glucoseMassUg ?? 0n;
  if (respired) postings.push(respired.posting);

  let totalMassUg: Micrograms = 0n;
  for (const amount of accountComposition(ledger, accounts.starter).values()) totalMassUg += amount;

  return { postings, totalMassUg, co2MassUg };
}
