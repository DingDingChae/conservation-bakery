/**
 * Livestock: a dairy cow and a laying hen, modelled as balanced element transfers.
 *
 * Feed and drinking water go in; milk or eggs, manure, retained body growth, and
 * respired CO2 and water vapour come out. Every element is exactly conserved: this
 * module never estimates manure independently and hopes it lines up with the feed --
 * manure is *defined* as whatever the feed supplied of an element that neither became
 * product nor was respired nor was retained, so it closes exactly by construction,
 * the same technique `world/accounts.ts` uses for its `Ash` catch-all. The animal
 * breathes the same tracked atmosphere every other process in this simulation does,
 * via `respire` from `world/exchange.ts`.
 *
 * Animals are livestock, and nothing in this file concerns any person.
 */

import type { Element, Micrograms } from '../core/commodity.js';
import { ENERGY, elementCommodity, isElement, partition, roundHalfEven } from '../core/commodity.js';
import type { AccountId, Entry, Ledger, Posting } from '../core/ledger.js';
import type { Rng } from '../clock/rng.js';
import { MOLAR_MASS, WORLD_ACCOUNTS } from '../world/accounts.js';
import { evaporate, respire } from '../world/exchange.js';
import { getComposition, getSubstance } from '../substance/registry.js';

const UG_PER_KG = 1_000_000_000;

const GLUCOSE_MOLAR_MASS = 6 * MOLAR_MASS.C + 12 * MOLAR_MASS.H + 6 * MOLAR_MASS.O;
const GLUCOSE_C_MASS_FRACTION = (6 * MOLAR_MASS.C) / GLUCOSE_MOLAR_MASS;
const GLUCOSE_H_MASS_FRACTION = (12 * MOLAR_MASS.H) / GLUCOSE_MOLAR_MASS;

/** A conservative integer ceiling: never rounds up past what is actually available.
 * Reserved for bounding a target before it is converted to the ledger's exact unit;
 * `roundHalfEven` remains the only function that performs that conversion itself. */
function floorMicrograms(value: number): Micrograms {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value));
}

function minBig(a: Micrograms, b: Micrograms): Micrograms {
  return a < b ? a : b;
}

/** Every element this module's feed and product substances can carry. A fixed,
 * explicit list keeps every tick's balance sheet built from the same set, regardless
 * of what happens to be present in a given feed or product record. */
const TRACKED_ELEMENTS: readonly Element[] = [
  'C', 'H', 'O', 'N', 'P', 'K', 'S', 'Na', 'Cl', 'Ca', 'Mg', 'Fe', 'Ash',
];

/**
 * An animal's feed conversion parameters. Every ratio is illustrative and order-of-
 * magnitude, in the same spirit as `crop.ts`'s crop definitions -- the point is a
 * real, Liebig-style balance rather than a fixed daily figure, not zootechnical
 * precision.
 */
export interface AnimalDefinition {
  readonly id: string;
  readonly name: string;
  /** Substance id (see packages/data/substances) the ration is drawn from. */
  readonly feedSubstanceId: string;
  /** Substance id the animal's product (milk / egg) is composed as. */
  readonly productSubstanceId: string;
  /** Share of intake feed mass needed just for upkeep, before anything becomes product. */
  readonly maintenanceFeedFraction: number;
  /** Share of the feed surplus beyond maintenance that converts to product mass. */
  readonly productConversionEfficiency: number;
  /** Share of the maintenance feed's organic mass oxidised for metabolic heat. */
  readonly respirationFraction: number;
  /** Share of what remains after product and respiration that is retained as body
   * growth rather than excreted. */
  readonly retainedGrowthFraction: number;
  /** Share of drinking water lost as respired or perspired vapour rather than manure
   * moisture. */
  readonly waterVapourFraction: number;
  /** Day-to-day yield variation (as a +/- fraction) drawn from the animal's own `Rng`. */
  readonly yieldVariation: number;
}

export const DAIRY_COW: AnimalDefinition = {
  id: 'dairy-cow',
  name: 'Dairy cow',
  feedSubstanceId: 'cattle-feed-maize-silage',
  productSubstanceId: 'cow-milk-whole',
  maintenanceFeedFraction: 0.6,
  productConversionEfficiency: 0.55,
  respirationFraction: 0.5,
  retainedGrowthFraction: 0.02,
  waterVapourFraction: 0.35,
  yieldVariation: 0.1,
};

export const LAYING_HEN: AnimalDefinition = {
  id: 'laying-hen',
  name: 'Laying hen',
  feedSubstanceId: 'wheat-grain',
  productSubstanceId: 'hen-egg-whole',
  maintenanceFeedFraction: 0.55,
  productConversionEfficiency: 0.4,
  respirationFraction: 0.55,
  retainedGrowthFraction: 0.015,
  waterVapourFraction: 0.4,
  yieldVariation: 0.15,
};

/** Typical metabolisable energy content of a ration substance, joules per kilogram --
 * used only so a freshly stocked ration has a believable stored-chemical-energy
 * balance for `respire` to draw down, not an unbounded assumption. */
const TYPICAL_ENERGY_CONTENT_J_PER_KG: Readonly<Record<string, number>> = {
  'cattle-feed-maize-silage': 10_500_000, // ~10.5 MJ/kg as-fed, typical whole-plant maize silage ME.
  'wheat-grain': 13_500_000, // ~13.5 MJ/kg, typical poultry-ration wheat ME.
};

export interface StockRationParams {
  readonly ledger: Ledger;
  readonly account: AccountId;
  readonly substanceId: string;
  readonly massUg: Micrograms;
  readonly process?: string;
}

/**
 * Credit `account` with a mass of a feed substance and its typical stored chemical
 * energy, delivered from `market.suppliers` -- the external counterparty
 * `world/accounts.ts` opens for exactly this purpose, which (unlike `GENESIS`) stays
 * usable for the entire life of a sealed world. A real ration bought in is a
 * delivery, never a one-time genesis event; a field's own harvest would instead
 * flow into a feed account via a plain transfer posting, not through this function
 * at all. Applies the posting itself (unlike this module's other functions, which
 * only build one), because a delivery is inherently a completed transaction, not a
 * draft the caller might choose not to apply.
 */
export function stockRation(params: StockRationParams): Posting {
  const composition = getComposition(params.substanceId, params.massUg);
  const energyPerKg = TYPICAL_ENERGY_CONTENT_J_PER_KG[params.substanceId];
  if (energyPerKg === undefined) {
    throw new RangeError(`no typical energy content is known for substance "${params.substanceId}"`);
  }
  const energyUg = roundHalfEven((Number(params.massUg) / UG_PER_KG) * energyPerKg * 1_000_000);

  const entries: Entry[] = [];
  for (const [element, amount] of composition) {
    if (amount === 0n) continue;
    entries.push({ account: params.account, commodity: elementCommodity(element), delta: amount });
    entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity(element), delta: -amount });
  }
  if (energyUg > 0n) {
    entries.push({ account: params.account, commodity: ENERGY, delta: energyUg });
    entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: ENERGY, delta: -energyUg });
  }

  const posting: Posting = { process: params.process ?? `agri:stock-ration:${params.substanceId}`, entries };
  return params.ledger.post(posting);
}

export interface AnimalAccounts {
  readonly feedAccount: AccountId;
  readonly waterAccount: AccountId;
  readonly productAccount: AccountId;
  readonly manureAccount: AccountId;
  readonly bodyAccount: AccountId;
  readonly heatAccount: AccountId;
  readonly atmosphereAccount?: AccountId;
}

export interface AnimalTickParams extends AnimalAccounts {
  readonly ledger: Ledger;
  readonly definition: AnimalDefinition;
  readonly feedMassUg: Micrograms;
  readonly waterMassUg: Micrograms;
  readonly rng: Rng;
  readonly process?: string;
}

export interface AnimalTickResult {
  readonly postings: readonly Posting[];
  readonly productMassUg: Micrograms;
  readonly manureMassUg: Micrograms;
  readonly retainedMassUg: Micrograms;
  readonly respiredGlucoseUg: Micrograms;
}

/**
 * Feed and water one animal for one tick, returning every balanced posting the
 * result requires -- the caller applies them via `ledger.post`. Read-only against
 * the ledger otherwise, so a caller can preview a tick without committing it.
 */
export function runAnimalTick(params: AnimalTickParams): AnimalTickResult {
  const { ledger, definition } = params;
  const atmosphereAccount = params.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere;
  const process = params.process ?? `agri:livestock:${definition.id}`;

  // Feed actually available cannot exceed what is actually in the feed account,
  // element by element -- a defensive clamp, not the primary control on ration size.
  const feedTarget = getComposition(definition.feedSubstanceId, params.feedMassUg);
  const feed = new Map<Element, Micrograms>();
  let feedTotalUg = 0n;
  for (const element of TRACKED_ELEMENTS) {
    const target = feedTarget.get(element) ?? 0n;
    const available = ledger.balance(params.feedAccount, elementCommodity(element));
    const amount = minBig(target, available);
    if (amount > 0n) feed.set(element, amount);
    feedTotalUg += amount;
  }

  if (feedTotalUg === 0n) {
    return { postings: [], productMassUg: 0n, manureMassUg: 0n, retainedMassUg: 0n, respiredGlucoseUg: 0n };
  }

  const postings: Posting[] = [];
  const used = new Map<Element, Micrograms>();

  const maintenanceUg = roundHalfEven(Number(feedTotalUg) * definition.maintenanceFeedFraction);
  const surplusUg = feedTotalUg > maintenanceUg ? feedTotalUg - maintenanceUg : 0n;

  // Day-to-day yield variation, deterministic from the animal's own draw of its
  // seeded stream -- the same seed and the same sequence of ticks always reproduce it.
  const productJitter = 1 + (params.rng.nextFloat() * 2 - 1) * definition.yieldVariation;
  const productTargetUg = roundHalfEven(
    Number(surplusUg) * definition.productConversionEfficiency * Math.max(0, productJitter),
  );

  // Product composition cannot draw more of any one element than the feed actually
  // supplied of it -- real milk or egg content is bounded by real feed content. A
  // trace element the named feed substance carries none of at all (e.g. sodium in a
  // grain ration) is treated as met by an unmodeled supplement rather than as a hard
  // block on the whole product: the entries loop below still only ever credits an
  // element the feed actually gave up, so that one trace element simply falls short
  // of the product's usual ratio rather than zeroing out the entire yield.
  const productRecord = getSubstance(definition.productSubstanceId);
  let productCeilingUg = productTargetUg;
  for (const element of TRACKED_ELEMENTS) {
    const ratio = (productRecord.elements[element] ?? 0) / UG_PER_KG;
    const available = feed.get(element) ?? 0n;
    if (ratio <= 0 || available <= 0n) continue;
    productCeilingUg = minBig(productCeilingUg, floorMicrograms(Number(available) / ratio));
  }
  const productMassUg = productCeilingUg > 0n ? productCeilingUg : 0n;

  let actualProductMassUg = 0n;
  if (productMassUg > 0n) {
    const productComposition = getComposition(definition.productSubstanceId, productMassUg);
    const entries: Entry[] = [];
    for (const element of TRACKED_ELEMENTS) {
      const amount = minBig(productComposition.get(element) ?? 0n, feed.get(element) ?? 0n);
      if (amount <= 0n) continue;
      used.set(element, (used.get(element) ?? 0n) + amount);
      actualProductMassUg += amount;
      entries.push({ account: params.feedAccount, commodity: elementCommodity(element), delta: -amount });
      entries.push({ account: params.productAccount, commodity: elementCommodity(element), delta: amount });
    }
    if (entries.length > 0) postings.push({ process: `${process}:product`, entries });
  }

  // Respiration draws on the maintenance feed that remains after the product's own
  // share, in glucose-equivalent organic matter -- the same simplification `respire`
  // documents for any plant's or culture's biomass, applied here to digested feed.
  const remainingC = (feed.get('C') ?? 0n) - (used.get('C') ?? 0n);
  const remainingH = (feed.get('H') ?? 0n) - (used.get('H') ?? 0n);
  const respirationJitter = 1 + (params.rng.nextFloat() * 2 - 1) * definition.yieldVariation;
  const respirationTargetUg = roundHalfEven(
    Number(maintenanceUg) * definition.respirationFraction * Math.max(0, respirationJitter),
  );
  const glucoseCeilingFromC = floorMicrograms(Number(remainingC) / GLUCOSE_C_MASS_FRACTION);
  const glucoseCeilingFromH = floorMicrograms(Number(remainingH) / GLUCOSE_H_MASS_FRACTION);
  const respiredGlucoseUg = minBig(
    minBig(respirationTargetUg, glucoseCeilingFromC),
    glucoseCeilingFromH,
  );

  if (respiredGlucoseUg > 0n) {
    const respirationPosting = respire({
      biomassAccount: params.feedAccount,
      atmosphereAccount,
      heatAccount: params.heatAccount,
      glucoseMass: respiredGlucoseUg,
      process: `${process}:respiration`,
    });
    postings.push(respirationPosting);
    for (const entry of respirationPosting.entries) {
      if (entry.account !== params.feedAccount || entry.delta >= 0n) continue;
      if (!entry.commodity.startsWith('el:')) continue;
      const elementPart = entry.commodity.slice(3);
      if (!isElement(elementPart)) continue;
      used.set(elementPart, (used.get(elementPart) ?? 0n) + -entry.delta);
    }
  }

  // Whatever the feed actually supplied of an element, and neither became product nor
  // was respired, is retained as body growth or excreted as manure -- the residual,
  // not an independent estimate, so it closes exactly by construction.
  const retainedFraction = Math.max(0, Math.min(1, definition.retainedGrowthFraction));
  const manureEntries: Entry[] = [];
  const bodyEntries: Entry[] = [];
  let manureMassUg = 0n;
  let retainedMassUg = 0n;
  for (const element of TRACKED_ELEMENTS) {
    const supplied = feed.get(element) ?? 0n;
    const consumed = used.get(element) ?? 0n;
    const residual = supplied - consumed; // >= 0: every prior draw was clamped to `feed`.
    if (residual <= 0n) continue;
    const retained = floorMicrograms(Number(residual) * retainedFraction);
    const toManure = residual - retained;
    if (retained > 0n) {
      bodyEntries.push({ account: params.feedAccount, commodity: elementCommodity(element), delta: -retained });
      bodyEntries.push({ account: params.bodyAccount, commodity: elementCommodity(element), delta: retained });
      retainedMassUg += retained;
    }
    if (toManure > 0n) {
      manureEntries.push({ account: params.feedAccount, commodity: elementCommodity(element), delta: -toManure });
      manureEntries.push({ account: params.manureAccount, commodity: elementCommodity(element), delta: toManure });
      manureMassUg += toManure;
    }
  }
  if (bodyEntries.length > 0) postings.push({ process: `${process}:retained-growth`, entries: bodyEntries });
  if (manureEntries.length > 0) postings.push({ process: `${process}:manure`, entries: manureEntries });

  // Drinking water: split between vapour (breath, perspiration) and manure moisture.
  // Both destinations are real, sourced, balanced transfers out of `waterAccount`.
  if (params.waterMassUg > 0n) {
    const vapourWeight = BigInt(Math.round(definition.waterVapourFraction * 1_000_000));
    const manureWeight = BigInt(Math.round((1 - definition.waterVapourFraction) * 1_000_000));
    const [vapourShare = 0n, manureWaterShare = 0n] = partition(params.waterMassUg, [
      vapourWeight,
      manureWeight,
    ]);

    if (vapourShare > 0n) {
      postings.push(
        evaporate({
          waterAccount: params.waterAccount,
          atmosphereAccount,
          waterMass: vapourShare,
          process: `${process}:respired-water`,
        }),
      );
    }
    if (manureWaterShare > 0n) {
      const hydrogenShare = roundHalfEven(
        Number(manureWaterShare) * ((2 * MOLAR_MASS.H) / (2 * MOLAR_MASS.H + MOLAR_MASS.O)),
      );
      const oxygenShare = manureWaterShare - hydrogenShare;
      postings.push({
        process: `${process}:manure-moisture`,
        entries: [
          { account: params.waterAccount, commodity: elementCommodity('H'), delta: -hydrogenShare },
          { account: params.waterAccount, commodity: elementCommodity('O'), delta: -oxygenShare },
          { account: params.manureAccount, commodity: elementCommodity('H'), delta: hydrogenShare },
          { account: params.manureAccount, commodity: elementCommodity('O'), delta: oxygenShare },
        ],
      });
      manureMassUg += manureWaterShare;
    }
  }

  return {
    postings,
    productMassUg: actualProductMassUg,
    manureMassUg,
    retainedMassUg,
    respiredGlucoseUg,
  };
}

/**
 * One individually tracked animal. Each instance carries its own forked `Rng`
 * stream (see `Rng.fork`), so a herd's outcomes are deterministic per-animal and
 * independent of how many animals are ticked before or after it in a given pass.
 */
export class Animal {
  readonly id: string;
  readonly definition: AnimalDefinition;
  readonly #rng: Rng;
  #totalProductUg: Micrograms = 0n;
  #totalManureUg: Micrograms = 0n;
  #bodyMassUg: Micrograms = 0n;

  constructor(id: string, definition: AnimalDefinition, rng: Rng) {
    this.id = id;
    this.definition = definition;
    this.#rng = rng;
  }

  get totalProductUg(): Micrograms {
    return this.#totalProductUg;
  }

  get totalManureUg(): Micrograms {
    return this.#totalManureUg;
  }

  get bodyMassUg(): Micrograms {
    return this.#bodyMassUg;
  }

  tick(
    ledger: Ledger,
    accounts: AnimalAccounts,
    feedMassUg: Micrograms,
    waterMassUg: Micrograms,
  ): AnimalTickResult {
    const result = runAnimalTick({
      ledger,
      definition: this.definition,
      feedMassUg,
      waterMassUg,
      rng: this.#rng,
      process: `agri:livestock:${this.definition.id}:${this.id}`,
      ...accounts,
    });
    this.#totalProductUg += result.productMassUg;
    this.#totalManureUg += result.manureMassUg;
    this.#bodyMassUg += result.retainedMassUg;
    return result;
  }
}
