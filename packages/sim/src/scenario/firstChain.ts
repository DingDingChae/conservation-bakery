/**
 * The first complete provenance loop.
 *
 * This module wires every layer of `packages/sim` into one real chain:
 *
 *     sun + soil + rain + atmosphere
 *       -> winter wheat field -> harvest -> grain dryer -> mill -> white flour
 *       -> dairy cow (fed on tracked feed) -> milk -> creamery -> butter
 *       -> laying hen (fed on tracked feed) -> egg
 *       -> sugar beet -> refinery -> sucrose
 *       -> mixer -> deck oven -> spiral cooler -> flow wrapper -> pallet -> shipped
 *
 * Every gram that moves does so through a balanced `Posting` built by the
 * `agri`, `plant`, `bake` and `world` modules and applied via `Ledger.post()`
 * (CONTRACT.md rule 1). This file's own job is orchestration and provenance
 * bookkeeping — it never credits an account directly.
 *
 * ## Provenance design
 *
 * `provenance/lot.ts` defines a root lot as one "whose material entered the
 * lot graph directly from a ledger reservoir or external account (soil,
 * atmosphere, sun, a supplier)". This scenario creates one root `Lot` per
 * real acquisition from such an account, each carrying that account's own id
 * as its `substance`, so a test can walk the shipped cake's ancestry and
 * confirm those specific accounts were reached *by id* (see
 * `ROOT_LOT_IDS` below). Non-root lots are declared exactly the way
 * `plant/mill.ts` already does it: a lot's declared parent contribution is
 * the *exact* mass a real posting moved, so `provenance/closure.ts`'s check
 * — parent contributions sum to this lot's own mass plus its declared loss —
 * holds at every hop by construction, and therefore (by simple induction
 * over the ancestor tree) the shipped cake's root contributions reconcile
 * exactly with its own mass plus every loss declared along the way.
 *
 * One deliberate simplification: the sun contributes only *energy* to crop
 * growth (`world/exchange.ts`'s `photosynthesize`), and `Lot.mass` is
 * elemental mass only — there is no such thing as an "energy lot" in this
 * model. The sun's contribution is instead reported directly as an exact,
 * ledger-sourced energy draw (`sunEnergyDrawnUj`, `WORLD_ACCOUNTS.sun`'s own
 * balance before and after the growing season), which is the honest way to
 * represent a real conserved quantity that the lot graph's mass-only model
 * cannot carry.
 *
 * ## Atmosphere reconciliation
 *
 * `AtmosphereTracker` (see `atmosphereTracker.ts`) classifies every posting
 * this scenario applies by the real physical cause of any atmosphere-account
 * delta it carries, so the headline test can assert the *exact* contribution
 * of crop photosynthesis, animal respiration, oven fuel combustion, and
 * chemical leavening — not just the final net balance.
 */

import type { Composition, Element, Micrograms } from '../core/commodity.js';
import {
  ENERGY,
  elementCommodity,
  grams,
  isElement,
  partition,
  roundHalfEven,
} from '../core/commodity.js';
import type { AccountId, AppliedPosting, Entry, Posting } from '../core/ledger.js';
import { Ledger } from '../core/ledger.js';
import { Rng } from '../clock/rng.js';
import { MOLAR_MASS, WORLD_ACCOUNTS, seedWorld, soilAccount, splitMolecule } from '../world/accounts.js';
import { WINTER_WHEAT } from '../agri/crop.js';
import { addFieldMoisture, dryGrain, splitStandingBiomass } from '../agri/harvest.js';
import { Field, generateSeasonalWeather } from '../agri/field.js';
import type { AnimalAccounts } from '../agri/livestock.js';
import { Animal, DAIRY_COW, LAYING_HEN, stockRation } from '../agri/livestock.js';
import { createMill, millGrain } from '../plant/mill.js';
import { churnCream, createCreamery, pasteurize, separateMilk } from '../plant/creamery.js';
import { createRefinery, refineSugarBeet } from '../plant/refinery.js';
import { ATOMIC_WEIGHT } from '../bake/constants.js';
import { reactBakingSoda, ventGas } from '../bake/leavening.js';
import { batterSpecificHeat, mixBatter } from '../bake/batter.js';
import type { ResolvedIngredient } from '../bake/formulation.js';
import { evaluateFormulation, type Formulation } from '../bake/formulation.js';
import { deliverHeat, heatFluxes, type HeatTransferGeometry, type OvenEnvironment } from '../bake/oven.js';
import { postMoistureLoss, stepThermal } from '../bake/transform.js';
import { coolingRateConstantPerS, stepCooling, stepStalingMoistureLoss } from '../bake/staling.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';
import type { LotCreationSpec, LotId } from '../provenance/lot.js';
import { deriveLotId, encodeLotCreations } from '../provenance/lot.js';
import { LotGraph } from '../provenance/graph.js';
import { checkGraphClosure, type ClosureReport } from '../provenance/closure.js';
import { AtmosphereTracker } from './atmosphereTracker.js';

// ---------------------------------------------------------------------------
// Scale. Every figure below is chosen only to produce a modest, real batch —
// see packages/sim/src/scenario/firstChain.spec.ts for the empirical basis
// (a real run of each stage, sized so nothing is absurdly large or starves).
// ---------------------------------------------------------------------------

const WHEAT_FIELD_ID = 'wheat-field';
const WHEAT_FIELD_AREA_M2 = 1n;
const WHEAT_WEATHER_DAYS = 400; // comfortable margin over the ~150 days a 1 m^2 plot typically needs
const SECONDS_PER_DAY = 86_400n;
const GRAIN_STORAGE_MOISTURE_CONTENT = 0.1; // drier than the ~14% field-harvest moisture

const COW_FEED_MASS: Micrograms = grams(10_000);
const COW_WATER_MASS: Micrograms = grams(6_000);
const HEN_FEED_MASS: Micrograms = grams(500);
const HEN_WATER_MASS: Micrograms = grams(300);
const BEET_MASS: Micrograms = grams(700);

const BAKING_SODA_MASS: Micrograms = grams(10);
const LEAVENING_ACID_MASS: Micrograms = grams(8); // generous vs. the ~7.15 g a 1:1 molar reaction needs
const BATTER_WATER_MASS: Micrograms = grams(110);
const FILM_MASS: Micrograms = grams(15);
const CARDBOARD_MASS: Micrograms = grams(80);

const METHANE_FUEL_MASS: Micrograms = grams(600); // ~30 MJ gross combustion energy, well over what a small bake needs

const OVEN_ENVIRONMENT: OvenEnvironment = { soleTempC: 180, crownTempC: 200, airTempC: 175 };
const OVEN_GEOMETRY: HeatTransferGeometry = { contactAreaM2: 0.02, crownFacingAreaM2: 0.02, convectiveAreaM2: 0.04 };
const BAKE_TICKS = 180;
const BAKE_DT_SECONDS = 30;

const COOL_TICKS = 40;
const COOL_DT_SECONDS = 60;
const COOL_SURFACE_AREA_M2 = 0.06;
const COOL_CONVECTION_W_PER_M2_K = 15;
const AMBIENT_TEMP_C = 20;

/** Real chemical formula for acetic acid, C2H4O2 — the representative
 * leavening acid `bake/leavening.ts` reacts against sodium bicarbonate (see
 * that module's doc comment). Duplicated locally, the same way
 * `bake/leavening.ts` itself duplicates `world/accounts.ts`'s technique,
 * because this scenario needs to *fund* an exact acid charge before the
 * reaction consumes it, and neither module exports a public "acid
 * composition" helper. */
const ACETIC_ACID_FORMULA: readonly { element: 'C' | 'H' | 'O'; atoms: number }[] = [
  { element: 'C', atoms: 2 },
  { element: 'H', atoms: 4 },
  { element: 'O', atoms: 2 },
];

/** CH4 — duplicated locally for the same reason: `world/exchange.ts`'s own
 * copy is not exported, and this scenario needs to know the fuel's exact
 * elemental split before combusting it. */
const CH4_FORMULA: readonly { element: 'C' | 'H'; atoms: number }[] = [
  { element: 'C', atoms: 1 },
  { element: 'H', atoms: 4 },
];
const CH4_MOLAR_MASS = MOLAR_MASS.C + 4 * MOLAR_MASS.H;
/** Standard enthalpy of combustion, methane — matches `world/exchange.ts` and
 * `bake/oven.ts`'s own cited figure (802.3 kJ/mol), reused here to fund a
 * fuel charge whose stored chemical energy is real and consistent. */
const METHANE_COMBUSTION_J_PER_MOL = 802_300;

/** One root lot id per real acquisition this scenario ever makes from a
 * ledger reservoir or an external counterparty — the wheat crop's sun, soil
 * and rain, the batter's own water, and every market-delivered ingredient
 * and packaging material — named once so both this file and its tests refer
 * to the same ids. See the module doc comment's "Provenance design" section. */
export const ROOT_LOT_IDS = {
  atmosphere: 'root:atmosphere:wheat',
  soilNutrients: 'root:soil-nutrients:wheat-field',
  soilMoisture: 'root:soil-moisture:wheat-field',
  water: 'root:water:groundwater',
  dairyFeed: 'root:dairy-feed',
  henhouseFeed: 'root:henhouse-feed',
  sugarBeetSupply: 'root:sugar-beet-supply',
  bakingSoda: 'root:baking-soda',
  leaveningAcid: 'root:leavening-acid',
  film: 'root:polypropylene-film',
  cardboard: 'root:cardboard',
} as const;

export interface FirstChainAccounts {
  readonly wheatBiomass: AccountId;
  readonly wheatGrain: AccountId;
  readonly wheatStraw: AccountId;
  readonly flour: AccountId;
  readonly bran: AccountId;
  readonly germ: AccountId;
  readonly dust: AccountId;
  readonly dairyFeed: AccountId;
  readonly dairyMilk: AccountId;
  readonly dairyManure: AccountId;
  readonly dairyBody: AccountId;
  readonly dairyHeat: AccountId;
  readonly cream: AccountId;
  readonly skim: AccountId;
  readonly butter: AccountId;
  readonly buttermilk: AccountId;
  readonly henFeed: AccountId;
  readonly henEggs: AccountId;
  readonly henManure: AccountId;
  readonly henBody: AccountId;
  readonly henHeat: AccountId;
  readonly beet: AccountId;
  readonly sucrose: AccountId;
  readonly pulp: AccountId;
  readonly molasses: AccountId;
  readonly bakingSoda: AccountId;
  readonly leaveningAcid: AccountId;
  readonly leaveningGas: AccountId;
  readonly leaveningByproduct: AccountId;
  readonly batterWater: AccountId;
  /** Holds the batter, then (in place) the baked, cooled, wrapped, palletised
   * cake — the same physical parcel throughout, exactly as a real production
   * line's mixing bowl becomes a tin becomes a wrapped, boxed product. */
  readonly product: AccountId;
  readonly fuel: AccountId;
  readonly film: AccountId;
  readonly cardboard: AccountId;
}

function openAccounts(ledger: Ledger): FirstChainAccounts {
  const accounts: FirstChainAccounts = {
    wheatBiomass: 'wheat.biomass',
    wheatGrain: 'wheat.grain',
    wheatStraw: 'wheat.straw',
    flour: 'mill.flour',
    bran: 'mill.bran',
    germ: 'mill.germ',
    dust: 'mill.dust',
    dairyFeed: 'dairy.feed',
    dairyMilk: 'dairy.milk',
    dairyManure: 'dairy.manure',
    dairyBody: 'dairy.body',
    dairyHeat: 'dairy.heat',
    cream: 'creamery.cream',
    skim: 'creamery.skim',
    butter: 'creamery.butter',
    buttermilk: 'creamery.buttermilk',
    henFeed: 'hen.feed',
    henEggs: 'hen.eggs',
    henManure: 'hen.manure',
    henBody: 'hen.body',
    henHeat: 'hen.heat',
    beet: 'refinery.beet',
    sucrose: 'refinery.sucrose',
    pulp: 'refinery.pulp',
    molasses: 'refinery.molasses',
    bakingSoda: 'bake.baking-soda',
    leaveningAcid: 'bake.leavening-acid',
    leaveningGas: 'bake.leavening-gas',
    leaveningByproduct: 'bake.leavening-byproduct',
    batterWater: 'bake.water',
    product: 'bake.product',
    fuel: 'bake.fuel',
    film: 'pack.film',
    cardboard: 'pack.cardboard',
  };

  // Metabolic heat has nowhere useful to accumulate — it dissipates, exactly
  // like the oven's flue loss and the mixer's own friction heat elsewhere in
  // this scenario. `external` accounts are the sanctioned sink for that.
  const externalAccounts: ReadonlySet<AccountId> = new Set([accounts.dairyHeat, accounts.henHeat]);
  for (const id of Object.values(accounts)) {
    ledger.openAccount({ id, kind: externalAccounts.has(id) ? 'external' : 'stock', label: id });
  }

  return accounts;
}

// ---------------------------------------------------------------------------
// Small local helpers. None of these touch a Ledger except through `post`;
// every one of them either builds or applies an already-balanced Posting.
// ---------------------------------------------------------------------------

function elementOf(commodity: string): Element | undefined {
  if (!commodity.startsWith('el:')) return undefined;
  const candidate = commodity.slice(3);
  return isElement(candidate) ? candidate : undefined;
}

/** The exact elemental composition an account currently holds, read straight
 * off the ledger — the same technique `agri/harvest.ts`'s `splitStandingBiomass`
 * uses to divide "whatever this account actually has" rather than an assumed
 * nominal profile. */
function accountComposition(ledger: Ledger, account: AccountId): Map<Element, Micrograms> {
  const out = new Map<Element, Micrograms>();
  for (const [commodity, amount] of ledger.balances(account)) {
    const element = elementOf(commodity);
    if (element && amount !== 0n) out.set(element, amount);
  }
  return out;
}

function accountElementalMass(ledger: Ledger, account: AccountId): Micrograms {
  let total = 0n;
  for (const amount of accountComposition(ledger, account).values()) total += amount;
  return total;
}

function withNote(posting: Posting, note: string): Posting {
  return { ...posting, note };
}

/** Move every element commodity (never energy — see call sites) an account
 * holds into another account, in one balanced posting. Used for every "combine
 * two real parcels into one" step in this scenario: mixing, wrapping,
 * palletising, and the final shipment out to the customer. */
function transferAllElements(ledger: Ledger, from: AccountId, to: AccountId, process: string, note?: string): AppliedPosting {
  const entries: Entry[] = [];
  for (const [commodity, amount] of ledger.balances(from)) {
    if (amount === 0n || elementOf(commodity) === undefined) continue;
    entries.push({ account: from, commodity, delta: -amount });
    entries.push({ account: to, commodity, delta: amount });
  }
  const posting: Posting = note === undefined ? { process, entries } : { process, entries, note };
  return ledger.post(posting);
}

/** A real, sourced delivery from `market.suppliers` — the external
 * counterparty `world/accounts.ts` opens for exactly this purpose, usable for
 * the whole life of a sealed world (unlike `GENESIS`, which is one-time). */
function acquireFromMarket(
  ledger: Ledger,
  account: AccountId,
  composition: ReadonlyMap<Element, Micrograms>,
  process: string,
  note?: string,
): AppliedPosting {
  const entries: Entry[] = [];
  for (const [element, amount] of composition) {
    if (amount === 0n) continue;
    entries.push({ account, commodity: elementCommodity(element), delta: amount });
    entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity(element), delta: -amount });
  }
  const posting: Posting = note === undefined ? { process, entries } : { process, entries, note };
  return ledger.post(posting);
}

const WEIGHT_PRECISION = 1_000_000;

/** Exact real-molar-mass elemental split of a mass of acetic acid — see the
 * module doc comment on why this is a local, deliberate duplicate of
 * `bake/leavening.ts`'s own internal technique rather than an import. */
function aceticAcidComposition(massUg: Micrograms): Map<Element, Micrograms> {
  const weights = ACETIC_ACID_FORMULA.map((part) =>
    BigInt(Math.round(part.atoms * ATOMIC_WEIGHT[part.element] * WEIGHT_PRECISION)),
  );
  const shares = partition(massUg, weights);
  const out = new Map<Element, Micrograms>();
  ACETIC_ACID_FORMULA.forEach((part, index) => {
    out.set(part.element, (out.get(part.element) ?? 0n) + (shares[index] ?? 0n));
  });
  return out;
}

/** Real methane combustion energy content per microgram, in exact microjoules
 * — see `world/exchange.ts`'s and `bake/oven.ts`'s identical figure and the
 * identical "J/g == uJ/ug" unit identity they both document. */
function methaneEnergyContentUj(massUg: Micrograms): bigint {
  return roundHalfEven(Number(massUg) * (METHANE_COMBUSTION_J_PER_MOL / CH4_MOLAR_MASS));
}

// ---------------------------------------------------------------------------
// The scenario itself.
// ---------------------------------------------------------------------------

export interface FirstChainStep {
  /** Monotonic step counter, unique per `tick()` call — not the same as
   * `Ledger.postingCount`, since one scenario "tick" (a day of field growth,
   * a bake second, a discrete processing action) is typically several
   * postings. */
  readonly index: number;
  readonly phase: string;
  readonly done: boolean;
}

export interface RootLotRecord {
  readonly id: LotId;
  /** The real world account this root's material was drawn from — a
   * reservoir (`atmosphere`, `soil.<field>`, `groundwater`) or an external
   * counterparty (`market.suppliers`), per `provenance/lot.ts`'s own
   * definition of a root lot. */
  readonly account: AccountId;
  readonly massUg: Micrograms;
}

export interface FirstChainOutcome {
  readonly accounts: FirstChainAccounts;
  readonly roots: Readonly<Record<keyof typeof ROOT_LOT_IDS, RootLotRecord>>;
  readonly wheatGrainFreshLotId: LotId;
  readonly wheatGrainDryLotId: LotId;
  readonly flourLotId: LotId;
  readonly milkLotId: LotId;
  readonly creamLotId: LotId;
  readonly butterLotId: LotId;
  readonly eggLotId: LotId;
  readonly beetLotId: LotId;
  readonly sucroseLotId: LotId;
  readonly leaveningByproductLotId: LotId;
  readonly batterLotId: LotId;
  readonly cakeLotId: LotId;
  readonly wrappedLotId: LotId;
  readonly palletisedLotId: LotId;
  readonly shippedLotId: LotId;
  readonly shippedMassUg: Micrograms;
  /** The exact masses actually mixed into the batter — see `bake/formulation.ts`;
   * used to reconstruct and validate the real formulation this scenario baked. */
  readonly ingredientMassesUg: {
    readonly flour: Micrograms;
    readonly butter: Micrograms;
    readonly egg: Micrograms;
    readonly sucrose: Micrograms;
    readonly leaveningByproduct: Micrograms;
    readonly water: Micrograms;
  };
  /** Exact energy drawn from `WORLD_ACCOUNTS.sun` across the wheat crop's
   * growing season — see the module doc comment on why the sun's
   * contribution is reported this way rather than as a `Lot`. */
  readonly sunEnergyDrawnUj: bigint;
  readonly atmosphereBefore: { readonly C: bigint; readonly H: bigint; readonly O: bigint };
  readonly atmosphereAfter: { readonly C: bigint; readonly H: bigint; readonly O: bigint };
  readonly closureReport: ClosureReport;
}

/**
 * Drives the entire first-chain scenario as a JS generator: every `yield` is
 * one scenario "tick", after which the ledger is already asserted balanced
 * (CONTRACT.md rule 1's `assertBalanced` — the same call `field.spec.ts` and
 * `transform.spec.ts` already use after every one of *their* ticks). Calling
 * `.next()` to exhaustion runs the scenario genesis-to-shipped and returns a
 * `FirstChainOutcome`; `FirstChainScenario` (below) wraps this for a
 * step-at-a-time caller.
 */
function* runFirstChain(
  seed: number,
  ledger: Ledger,
  graph: LotGraph,
  atmosphereTracker: AtmosphereTracker,
): Generator<FirstChainStep, FirstChainOutcome, void> {
  const registry = defaultSubstanceRegistry();
  const rootRng = Rng.fromSeed(seed);
  const weatherRng = rootRng.fork();
  const cowRng = rootRng.fork();
  const henRng = rootRng.fork();

  const accounts = openAccounts(ledger);
  seedWorld(ledger, { fields: [WHEAT_FIELD_ID], fieldAreaM2: WHEAT_FIELD_AREA_M2 });

  const atmosphereBefore = readAtmosphere(ledger);

  let index = 0;
  function step(phase: string): FirstChainStep {
    ledger.assertBalanced(`${phase} (step ${index})`);
    index += 1;
    return { index, phase, done: false };
  }

  // -------------------------------------------------------------------
  // 1. Winter wheat: sun + soil + rain + atmosphere -> a standing crop.
  // -------------------------------------------------------------------
  const field = new Field({
    id: WHEAT_FIELD_ID,
    definition: WINTER_WHEAT,
    soilAccount: soilAccount(WHEAT_FIELD_ID),
    biomassAccount: accounts.wheatBiomass,
    areaM2: WHEAT_FIELD_AREA_M2,
  });
  field.plant();

  const sunBefore = ledger.balance(WORLD_ACCOUNTS.sun, ENERGY);

  const weather = generateSeasonalWeather(weatherRng, {
    days: WHEAT_WEATHER_DAYS,
    meanTemperatureC: 14,
    temperatureAmplitudeC: 8,
    peakInsolationWPerM2: 500,
    meanRainfallMmPerDay: 4,
    dayOfYearStart: 60,
  });

  for (let day = 0; day < weather.length && !field.readyForHarvest; day += 1) {
    const sample = weather[day];
    if (!sample) break;
    const result = field.tick(ledger, sample, SECONDS_PER_DAY);
    atmosphereTracker.recordAll(result.postings);
    yield step('growing-wheat');
  }
  if (!field.readyForHarvest) {
    throw new Error(
      `wheat did not reach maturity within ${WHEAT_WEATHER_DAYS} simulated days — the scenario's ` +
        'weather or crop parameters need adjustment, not a longer timeout',
    );
  }

  const sunAfter = ledger.balance(WORLD_ACCOUNTS.sun, ENERGY);
  const sunEnergyDrawnUj = sunBefore - sunAfter;

  // -------------------------------------------------------------------
  // 2. Harvest: split standing biomass into grain (primary) and straw
  //    (residue), then bring the grain up to real field moisture content.
  //    Both are exact, sourced transfers — see harvest.ts's own doc comment.
  // -------------------------------------------------------------------
  const split = splitStandingBiomass(
    ledger,
    WINTER_WHEAT,
    accounts.wheatBiomass,
    accounts.wheatGrain,
    accounts.wheatStraw,
    'agri:harvest:wheat-field',
  );
  ledger.post(split.posting);
  yield step('harvest-split');

  let atmosphereOrganicUg = 0n;
  let soilNutrientUg = 0n;
  for (const entry of split.posting.entries) {
    if (entry.account !== accounts.wheatGrain || entry.delta <= 0n) continue;
    const element = elementOf(entry.commodity);
    if (!element) continue; // energy's share of the split carries no lot mass
    if (element === 'C' || element === 'H' || element === 'O') atmosphereOrganicUg += entry.delta;
    else soilNutrientUg += entry.delta;
  }

  const moisture = addFieldMoisture({
    ledger,
    definition: WINTER_WHEAT,
    primaryAccount: accounts.wheatGrain,
    soilAccount: soilAccount(WHEAT_FIELD_ID),
    dryMassUg: split.primaryMassUg,
    process: 'agri:harvest:wheat-field:moisture',
  });
  if (moisture.posting.entries.length > 0) ledger.post(moisture.posting);
  yield step('harvest-moisture');

  const roots: Record<keyof typeof ROOT_LOT_IDS, RootLotRecord> = {
    atmosphere: { id: ROOT_LOT_IDS.atmosphere, account: WORLD_ACCOUNTS.atmosphere, massUg: atmosphereOrganicUg },
    soilNutrients: { id: ROOT_LOT_IDS.soilNutrients, account: soilAccount(WHEAT_FIELD_ID), massUg: soilNutrientUg },
    soilMoisture: { id: ROOT_LOT_IDS.soilMoisture, account: soilAccount(WHEAT_FIELD_ID), massUg: moisture.waterAddedUg },
    water: { id: ROOT_LOT_IDS.water, account: WORLD_ACCOUNTS.groundwater, massUg: BATTER_WATER_MASS },
    dairyFeed: { id: ROOT_LOT_IDS.dairyFeed, account: WORLD_ACCOUNTS.marketSuppliers, massUg: COW_FEED_MASS },
    henhouseFeed: { id: ROOT_LOT_IDS.henhouseFeed, account: WORLD_ACCOUNTS.marketSuppliers, massUg: HEN_FEED_MASS },
    sugarBeetSupply: { id: ROOT_LOT_IDS.sugarBeetSupply, account: WORLD_ACCOUNTS.marketSuppliers, massUg: BEET_MASS },
    bakingSoda: { id: ROOT_LOT_IDS.bakingSoda, account: WORLD_ACCOUNTS.marketSuppliers, massUg: BAKING_SODA_MASS },
    leaveningAcid: { id: ROOT_LOT_IDS.leaveningAcid, account: WORLD_ACCOUNTS.marketSuppliers, massUg: LEAVENING_ACID_MASS },
    film: { id: ROOT_LOT_IDS.film, account: WORLD_ACCOUNTS.marketSuppliers, massUg: FILM_MASS },
    cardboard: { id: ROOT_LOT_IDS.cardboard, account: WORLD_ACCOUNTS.marketSuppliers, massUg: CARDBOARD_MASS },
  };
  for (const root of Object.values(roots)) {
    graph.addLot({ id: root.id, substance: root.account, mass: root.massUg, tick: ledger.tick, process: `genesis:${root.id}`, parents: [], losses: [] });
  }

  const freshMassUg = split.primaryMassUg + moisture.waterAddedUg;
  const freshSpec: LotCreationSpec = {
    substance: 'wheat-grain',
    mass: freshMassUg,
    parents: [
      { lotId: roots.atmosphere.id, mass: atmosphereOrganicUg },
      { lotId: roots.soilNutrients.id, mass: soilNutrientUg },
      { lotId: roots.soilMoisture.id, mass: moisture.waterAddedUg },
    ],
  };
  const freshApplied = ledger.post({ process: 'agri:harvest:wheat-field:lot', entries: [], note: encodeLotCreations([freshSpec]) });
  const wheatGrainFreshLotId = deriveLotId(freshApplied.seq, 0);
  yield step('harvest-lot');

  // -------------------------------------------------------------------
  // 3. Grain dryer: bring the harvested grain down from field moisture to a
  //    storage moisture content, evaporating the exact excess to atmosphere.
  // -------------------------------------------------------------------
  const dried = dryGrain({
    primaryAccount: accounts.wheatGrain,
    atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
    dryMassUg: split.primaryMassUg,
    currentMoistureMassUg: moisture.waterAddedUg,
    targetMoistureContent: GRAIN_STORAGE_MOISTURE_CONTENT,
    process: 'agri:grain-drying:wheat-field',
  });
  const dryMassUg = freshMassUg - dried.waterRemovedUg;
  const drySpec: LotCreationSpec = {
    substance: 'wheat-grain',
    mass: dryMassUg,
    parents: [{ lotId: wheatGrainFreshLotId, mass: freshMassUg }],
    losses: dried.waterRemovedUg > 0n ? [{ reason: 'grain-drying moisture removed to atmosphere', mass: dried.waterRemovedUg }] : [],
  };
  const driedPosting: Posting =
    dried.posting.entries.length > 0
      ? withNote(dried.posting, encodeLotCreations([drySpec]))
      : { process: dried.posting.process, entries: [], note: encodeLotCreations([drySpec]) };
  const driedApplied = ledger.post(driedPosting);
  atmosphereTracker.record(driedPosting);
  const wheatGrainDryLotId = deriveLotId(driedApplied.seq, 0);
  yield step('grain-drying');

  // -------------------------------------------------------------------
  // 4. Mill: grain -> white flour (+ bran, germ, dust, moisture loss).
  //    Only flour continues toward the cake, so this scenario declares its
  //    own flour lot below rather than using `millGrain`'s built-in
  //    grain-lot mechanism (which would give bran, germ and dust their own
  //    lots too, each claiming only its own mass from the grain — correct
  //    for *their* closure, but it would silently leave the untracked
  //    bran/germ/dust/moisture share off of every lot's books, which would
  //    break this scenario's own leaf-contributions-reconcile-exactly
  //    guarantee, not `provenance/closure.ts`'s check). Declaring flour's
  //    parent contribution as grain-dry's *entire* mass, with everything
  //    that did not become flour folded into one declared loss, keeps that
  //    guarantee intact while still being exactly what the batch posting
  //    itself moved.
  // -------------------------------------------------------------------
  const mill = createMill('mill-1', 'flour mill');
  mill.machine.commission();
  mill.machine.requestMode('MANUAL');
  mill.machine.setTag('hopper-level-kg', Number(dryMassUg) / 1e9 + 1);

  const grainComposition = accountComposition(ledger, accounts.wheatGrain);
  const millResult = millGrain(mill, registry, {
    grainAccount: accounts.wheatGrain,
    grainComposition,
    flourAccount: accounts.flour,
    branAccount: accounts.bran,
    germAccount: accounts.germ,
    dustAccount: accounts.dust,
    moistureAccount: WORLD_ACCOUNTS.atmosphere,
  });
  const flourSpec: LotCreationSpec = {
    substance: 'wheat-flour-white',
    mass: millResult.yields.flour,
    parents: [{ lotId: wheatGrainDryLotId, mass: dryMassUg }],
    losses: [
      { reason: 'bran, germ, mill dust and milling moisture loss', mass: dryMassUg - millResult.yields.flour },
    ],
  };
  const millApplied = ledger.post(withNote(millResult.posting, encodeLotCreations([flourSpec])));
  atmosphereTracker.record(millResult.posting);
  const flourLotId = deriveLotId(millApplied.seq, 0);
  yield step('milling');

  // -------------------------------------------------------------------
  // 5. Dairy cow: real tracked feed (market-delivered) -> milk.
  // -------------------------------------------------------------------
  stockRation({ ledger, account: accounts.dairyFeed, substanceId: DAIRY_COW.feedSubstanceId, massUg: COW_FEED_MASS });
  yield step('dairy-ration');

  const cow = new Animal('cow-01', DAIRY_COW, cowRng);
  const cowAccounts: AnimalAccounts = {
    feedAccount: accounts.dairyFeed,
    waterAccount: WORLD_ACCOUNTS.groundwater,
    productAccount: accounts.dairyMilk,
    manureAccount: accounts.dairyManure,
    bodyAccount: accounts.dairyBody,
    heatAccount: accounts.dairyHeat,
  };
  const cowResult = cow.tick(ledger, cowAccounts, COW_FEED_MASS, COW_WATER_MASS);
  if (cowResult.productMassUg <= 0n) {
    throw new Error('the dairy cow produced no milk this tick — feed or water sizing needs adjustment');
  }
  const milkSpec: LotCreationSpec = {
    substance: 'cow-milk-whole',
    mass: cowResult.productMassUg,
    parents: [{ lotId: roots.dairyFeed.id, mass: cowResult.productMassUg }],
  };
  let milkLotId: LotId | undefined;
  for (const posting of cowResult.postings) {
    const creditsMilk = posting.entries.some((e) => e.account === accounts.dairyMilk && e.delta > 0n);
    const applied = ledger.post(creditsMilk ? withNote(posting, encodeLotCreations([milkSpec])) : posting);
    atmosphereTracker.record(posting);
    if (creditsMilk) milkLotId = deriveLotId(applied.seq, 0);
  }
  if (!milkLotId) throw new Error('no posting credited the milk account');
  yield step('dairy-milk');

  // -------------------------------------------------------------------
  // 6. Creamery: milk -> cream (+ skim) -> pasteurised -> butter (+ buttermilk).
  // -------------------------------------------------------------------
  const creamery = createCreamery('creamery-1', 'creamery');
  creamery.machine.commission();
  creamery.machine.requestMode('MANUAL');
  creamery.machine.setTag('vat-level-kg', Number(cowResult.productMassUg) / 1e9 + 1);

  const milkComposition = accountComposition(ledger, accounts.dairyMilk);
  const separated = separateMilk(creamery, registry, {
    milkAccount: accounts.dairyMilk,
    milkComposition,
    creamAccount: accounts.cream,
    skimAccount: accounts.skim,
  });
  const creamSpec: LotCreationSpec = {
    substance: 'cream',
    mass: separated.yields.cream,
    // Cream's parent contribution is the *whole* milk this batch consumed,
    // not just cream's own share -- see the flour lot's identical reasoning
    // above. Skim milk (not carried forward) is the declared loss.
    parents: [{ lotId: milkLotId, mass: cowResult.productMassUg }],
    losses: [{ reason: 'skim milk not carried forward', mass: cowResult.productMassUg - separated.yields.cream }],
  };
  const separatedApplied = ledger.post(withNote(separated.posting, encodeLotCreations([creamSpec])));
  const creamLotId = deriveLotId(separatedApplied.seq, 0);
  yield step('creamery-separate');

  const pasteurized = pasteurize(creamery, {
    composition: separated.compositions.cream,
    utilityAccount: WORLD_ACCOUNTS.marketUtilities,
    wasteHeatAccount: WORLD_ACCOUNTS.space,
    startTempC: 4,
  });
  ledger.post(pasteurized.posting);
  yield step('creamery-pasteurize');

  const churned = churnCream(creamery, registry, {
    creamAccount: accounts.cream,
    creamComposition: separated.compositions.cream,
    butterAccount: accounts.butter,
    buttermilkAccount: accounts.buttermilk,
  });
  const butterSpec: LotCreationSpec = {
    substance: 'butter',
    mass: churned.yields.butter,
    // As with cream above: the whole churned cream, not just butter's own
    // share -- buttermilk (not carried forward) is the declared loss.
    parents: [{ lotId: creamLotId, mass: separated.yields.cream }],
    losses: [{ reason: 'buttermilk not carried forward', mass: separated.yields.cream - churned.yields.butter }],
  };
  const churnedApplied = ledger.post(withNote(churned.posting, encodeLotCreations([butterSpec])));
  const butterLotId = deriveLotId(churnedApplied.seq, 0);
  yield step('creamery-churn');

  // -------------------------------------------------------------------
  // 7. Laying hen: real tracked feed -> egg.
  // -------------------------------------------------------------------
  stockRation({ ledger, account: accounts.henFeed, substanceId: LAYING_HEN.feedSubstanceId, massUg: HEN_FEED_MASS });
  yield step('hen-ration');

  const hen = new Animal('hen-01', LAYING_HEN, henRng);
  const henAccounts: AnimalAccounts = {
    feedAccount: accounts.henFeed,
    waterAccount: WORLD_ACCOUNTS.groundwater,
    productAccount: accounts.henEggs,
    manureAccount: accounts.henManure,
    bodyAccount: accounts.henBody,
    heatAccount: accounts.henHeat,
  };
  const henResult = hen.tick(ledger, henAccounts, HEN_FEED_MASS, HEN_WATER_MASS);
  if (henResult.productMassUg <= 0n) {
    throw new Error('the laying hen produced no egg this tick — feed or water sizing needs adjustment');
  }
  const eggSpec: LotCreationSpec = {
    substance: 'hen-egg-whole',
    mass: henResult.productMassUg,
    parents: [{ lotId: roots.henhouseFeed.id, mass: henResult.productMassUg }],
  };
  let eggLotId: LotId | undefined;
  for (const posting of henResult.postings) {
    const creditsEgg = posting.entries.some((e) => e.account === accounts.henEggs && e.delta > 0n);
    const applied = ledger.post(creditsEgg ? withNote(posting, encodeLotCreations([eggSpec])) : posting);
    atmosphereTracker.record(posting);
    if (creditsEgg) eggLotId = deriveLotId(applied.seq, 0);
  }
  if (!eggLotId) throw new Error('no posting credited the egg account');
  yield step('hen-egg');

  // -------------------------------------------------------------------
  // 8. Sugar beet -> refinery -> refined sucrose.
  // -------------------------------------------------------------------
  const beetTarget = registry.getComposition('sugar-beet', BEET_MASS);
  const beetSpec: LotCreationSpec = {
    substance: 'sugar-beet',
    mass: BEET_MASS,
    parents: [{ lotId: roots.sugarBeetSupply.id, mass: BEET_MASS }],
  };
  const beetApplied = acquireFromMarket(
    ledger,
    accounts.beet,
    beetTarget,
    'market:acquire:sugar-beet',
    encodeLotCreations([beetSpec]),
  );
  const beetLotId = deriveLotId(beetApplied.seq, 0);
  yield step('sugar-beet-acquire');

  const refinery = createRefinery('refinery-1', 'sugar refinery');
  refinery.machine.commission();
  refinery.machine.requestMode('MANUAL');
  refinery.machine.setTag('hopper-level-kg', Number(BEET_MASS) / 1e9 + 1);

  const beetComposition = accountComposition(ledger, accounts.beet);
  const refined = refineSugarBeet(refinery, registry, {
    beetAccount: accounts.beet,
    beetComposition,
    sucroseAccount: accounts.sucrose,
    pulpAccount: accounts.pulp,
    molassesAccount: accounts.molasses,
    evaporationAccount: WORLD_ACCOUNTS.atmosphere,
  });
  const sucroseSpec: LotCreationSpec = {
    substance: 'sucrose',
    mass: refined.yields.sucrose,
    // The whole beet batch, not just sucrose's own share -- pulp, molasses
    // and the evaporation loss (none carried forward) are the declared loss.
    parents: [{ lotId: beetLotId, mass: BEET_MASS }],
    losses: [{ reason: 'pulp, molasses and evaporation loss not carried forward', mass: BEET_MASS - refined.yields.sucrose }],
  };
  const refinedApplied = ledger.post(withNote(refined.posting, encodeLotCreations([sucroseSpec])));
  atmosphereTracker.record(refined.posting);
  const sucroseLotId = deriveLotId(refinedApplied.seq, 0);
  yield step('sugar-refine');

  // -------------------------------------------------------------------
  // 9. Leavening: sodium bicarbonate + acid -> CO2 (vented) + water/salt
  //    byproduct (folded into the batter).
  // -------------------------------------------------------------------
  const sodaComposition = registry.getComposition('sodium-bicarbonate', BAKING_SODA_MASS);
  acquireFromMarket(ledger, accounts.bakingSoda, sodaComposition, 'market:acquire:baking-soda');
  yield step('leavening-acquire-soda');

  const acidComposition = aceticAcidComposition(LEAVENING_ACID_MASS);
  acquireFromMarket(ledger, accounts.leaveningAcid, acidComposition, 'market:acquire:leavening-acid');
  yield step('leavening-acquire-acid');

  const reacted = reactBakingSoda({
    bakingSodaAccount: accounts.bakingSoda,
    acidAccount: accounts.leaveningAcid,
    gasAccount: accounts.leaveningGas,
    byproductAccount: accounts.leaveningByproduct,
    bakingSodaMass: BAKING_SODA_MASS,
    acidMass: LEAVENING_ACID_MASS,
    process: 'leavening:baking-soda:cake',
  });
  const byproductMassUg = reacted.bakingSodaConsumed + reacted.acidConsumed - massOf(reacted.co2);
  const byproductSpec: LotCreationSpec = {
    substance: 'leavening-byproduct',
    mass: byproductMassUg,
    parents: [
      { lotId: roots.bakingSoda.id, mass: reacted.bakingSodaConsumed },
      { lotId: roots.leaveningAcid.id, mass: reacted.acidConsumed },
    ],
    losses: [{ reason: 'CO2 vented to atmosphere', mass: massOf(reacted.co2) }],
  };
  const reactedApplied = ledger.post(withNote(reacted.posting, encodeLotCreations([byproductSpec])));
  const leaveningByproductLotId = deriveLotId(reactedApplied.seq, 0);
  yield step('leavening-react');

  const vented = ventGas({ gasAccount: accounts.leaveningGas, atmosphereAccount: WORLD_ACCOUNTS.atmosphere, composition: reacted.co2, process: 'leavening:vent-gas' });
  ledger.post(vented);
  atmosphereTracker.record(vented);
  yield step('leavening-vent');

  // -------------------------------------------------------------------
  // 10. Draw batter water directly from a real world reservoir.
  // -------------------------------------------------------------------
  const waterSplit = splitMolecule(BATTER_WATER_MASS, [
    { element: 'H', atoms: 2 },
    { element: 'O', atoms: 1 },
  ]);
  const waterEntries: Entry[] = [];
  for (const [element, amount] of waterSplit) {
    if (amount === 0n) continue;
    waterEntries.push({ account: WORLD_ACCOUNTS.groundwater, commodity: elementCommodity(element), delta: -amount });
    waterEntries.push({ account: accounts.batterWater, commodity: elementCommodity(element), delta: amount });
  }
  ledger.post({ process: 'bake:draw-water', entries: waterEntries });
  yield step('draw-water');

  // -------------------------------------------------------------------
  // 11. Mix: combine flour, butter, egg, sucrose, leavening byproduct and
  //     water into the batter, then spend real mixer energy on it.
  // -------------------------------------------------------------------
  const flourMassUg = accountElementalMass(ledger, accounts.flour);
  const flourNitrogenUg = ledger.balance(accounts.flour, elementCommodity('N'));
  const butterMassUg = accountElementalMass(ledger, accounts.butter);
  const eggMassUg = accountElementalMass(ledger, accounts.henEggs);
  const sucroseMassUg = accountElementalMass(ledger, accounts.sucrose);
  const byproductMassInAccountUg = accountElementalMass(ledger, accounts.leaveningByproduct);
  const waterMassUg = accountElementalMass(ledger, accounts.batterWater);

  transferAllElements(ledger, accounts.flour, accounts.product, 'bake:mix:flour');
  yield step('mix-flour');
  transferAllElements(ledger, accounts.butter, accounts.product, 'bake:mix:butter');
  yield step('mix-butter');
  transferAllElements(ledger, accounts.henEggs, accounts.product, 'bake:mix:egg');
  yield step('mix-egg');
  transferAllElements(ledger, accounts.sucrose, accounts.product, 'bake:mix:sucrose');
  yield step('mix-sucrose');
  transferAllElements(ledger, accounts.leaveningByproduct, accounts.product, 'bake:mix:leavening');
  yield step('mix-leavening');

  const batterMassUg = flourMassUg + butterMassUg + eggMassUg + sucroseMassUg + byproductMassInAccountUg + waterMassUg;
  const batterSpec: LotCreationSpec = {
    substance: 'cake-batter',
    mass: batterMassUg,
    parents: [
      { lotId: flourLotId, mass: flourMassUg },
      { lotId: butterLotId, mass: butterMassUg },
      { lotId: eggLotId, mass: eggMassUg },
      { lotId: sucroseLotId, mass: sucroseMassUg },
      { lotId: leaveningByproductLotId, mass: byproductMassInAccountUg },
      { lotId: roots.water.id, mass: waterMassUg },
    ],
  };
  const mixWaterApplied = transferAllElements(ledger, accounts.batterWater, accounts.product, 'bake:mix:water', encodeLotCreations([batterSpec]));
  const batterLotId = deriveLotId(mixWaterApplied.seq, 0);
  yield step('mix-water');

  const resolvedForHeat: readonly ResolvedIngredient[] = [
    { ingredient: { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 0 }, massUg: flourMassUg },
    { ingredient: { substanceId: 'butter', role: 'fat', bakersPercent: 0 }, massUg: butterMassUg },
    { ingredient: { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 0 }, massUg: eggMassUg },
    { ingredient: { substanceId: 'sucrose', role: 'sugar', bakersPercent: 0 }, massUg: sucroseMassUg },
    { ingredient: { substanceId: 'sodium-bicarbonate', role: 'leavening', bakersPercent: 0 }, massUg: byproductMassInAccountUg },
    { ingredient: { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 0 }, massUg: waterMassUg },
  ];
  const specificHeatJPerKgK = batterSpecificHeat(resolvedForHeat);
  const batterMassKg = Number(batterMassUg) / 1e9;

  const formulation: Formulation = {
    name: 'first-chain test cake',
    ingredients: [
      { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
      { substanceId: 'sucrose', role: 'sugar', bakersPercent: (Number(sucroseMassUg) / Number(flourMassUg)) * 100 },
      { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: (Number(eggMassUg) / Number(flourMassUg)) * 100 },
      { substanceId: 'butter', role: 'fat', bakersPercent: (Number(butterMassUg) / Number(flourMassUg)) * 100 },
      { substanceId: 'water-liquid', role: 'liquid', bakersPercent: (Number(waterMassUg) / Number(flourMassUg)) * 100 },
      {
        substanceId: 'leavening-byproduct',
        role: 'leavening',
        bakersPercent: (Number(byproductMassInAccountUg) / Number(flourMassUg)) * 100,
      },
    ],
  };
  // Exercised for its own sake (this scenario's mass targets were sized
  // empirically, not derived from `resolveFormulation`) -- see
  // firstChain.spec.ts for the assertion that this lands in a sane range.
  evaluateFormulation(formulation);

  const gluten = glutenPrecursorMass(flourNitrogenUg);
  const mechanicalEnergy = roundHalfEven(batterMassKg * 25_000 * 1_000_000); // ~25 kJ/kg, near peak development
  const mixed = mixBatter({
    mechanicalEnergyAccount: WORLD_ACCOUNTS.marketUtilities,
    thermalAccount: accounts.product,
    mechanicalEnergy,
    totalBatterMassUg: batterMassUg,
    specificHeatJPerKgK,
    glutenFormingMassUg: gluten,
  });
  ledger.post(mixed.posting);
  yield step('mix-energy');

  // -------------------------------------------------------------------
  // 12. Deck oven: real gas-fired heat transfer, tick by tick, evaporating
  //     the batter's added water as it bakes.
  // -------------------------------------------------------------------
  const fuelSplit = splitMolecule(METHANE_FUEL_MASS, CH4_FORMULA);
  const fuelEnergy = methaneEnergyContentUj(METHANE_FUEL_MASS);
  const fuelEntries: Entry[] = [];
  for (const [element, amount] of fuelSplit) {
    if (amount === 0n) continue;
    fuelEntries.push({ account: accounts.fuel, commodity: elementCommodity(element), delta: amount });
    fuelEntries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity(element), delta: -amount });
  }
  fuelEntries.push({ account: accounts.fuel, commodity: ENERGY, delta: fuelEnergy });
  fuelEntries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: ENERGY, delta: -fuelEnergy });
  ledger.post({ process: 'market:acquire:oven-fuel', entries: fuelEntries });
  yield step('oven-fuel');

  let surfaceTempC = AMBIENT_TEMP_C;
  let moistureRemainingUg = waterMassUg;
  let moistureEvaporatedUg = 0n;

  for (let tick = 0; tick < BAKE_TICKS; tick += 1) {
    const fluxes = heatFluxes(OVEN_ENVIRONMENT, OVEN_GEOMETRY, surfaceTempC);
    const targetJ = Math.max(0, fluxes.totalW) * BAKE_DT_SECONDS;
    const delivery = deliverHeat(
      { kind: 'gas', fuelAccount: accounts.fuel, wasteHeatAccount: WORLD_ACCOUNTS.space },
      accounts.product,
      targetJ,
      `oven:bake:${tick}`,
    );
    for (const posting of delivery.postings) {
      ledger.post(posting);
      atmosphereTracker.record(posting);
    }

    const deliveredJ = Number(delivery.deliveredEnergy) / 1_000_000;
    const thermal = stepThermal({
      currentTempC: surfaceTempC,
      deliveredEnergyJ: deliveredJ,
      massKg: batterMassKg,
      specificHeatJPerKgK,
      moistureRemainingUg,
    });
    surfaceTempC = thermal.nextTempC;

    if (thermal.evaporatedMassUg > 0n) {
      const loss = postMoistureLoss(accounts.product, WORLD_ACCOUNTS.atmosphere, thermal.evaporatedMassUg, `bake:oven-moisture-loss:${tick}`);
      if (loss) {
        ledger.post(loss.posting);
        atmosphereTracker.record(loss.posting);
        moistureRemainingUg -= thermal.evaporatedMassUg;
        moistureEvaporatedUg += thermal.evaporatedMassUg;
      }
    }

    yield step('baking');
  }

  // -------------------------------------------------------------------
  // 13. Spiral cooler: Newton's-law cooling back toward ambient, with a
  //     little further, real, weighed moisture loss before wrapping.
  // -------------------------------------------------------------------
  const coolingRate = coolingRateConstantPerS(COOL_CONVECTION_W_PER_M2_K, COOL_SURFACE_AREA_M2, batterMassKg, specificHeatJPerKgK);
  for (let tick = 0; tick < COOL_TICKS; tick += 1) {
    surfaceTempC = stepCooling(surfaceTempC, AMBIENT_TEMP_C, coolingRate, COOL_DT_SECONDS);
    const staled = stepStalingMoistureLoss({
      productAccount: accounts.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      moistureRemainingUg,
      surfaceAreaM2: COOL_SURFACE_AREA_M2,
      dtSeconds: COOL_DT_SECONDS,
      packaged: false,
      process: `bake:cooling-moisture-loss:${tick}`,
    });
    if (staled) {
      ledger.post(staled.posting);
      atmosphereTracker.record(staled.posting);
      moistureRemainingUg -= staled.evaporatedMassUg;
      moistureEvaporatedUg += staled.evaporatedMassUg;
    }
    yield step('cooling');
  }

  const cakeMassUg = batterMassUg - moistureEvaporatedUg;
  const cakeSpec: LotCreationSpec = {
    substance: 'baked-cake',
    mass: cakeMassUg,
    parents: [{ lotId: batterLotId, mass: batterMassUg }],
    losses: moistureEvaporatedUg > 0n ? [{ reason: 'oven and cooling moisture loss', mass: moistureEvaporatedUg }] : [],
  };
  const cakeApplied = ledger.post({ process: 'bake:finish', entries: [], note: encodeLotCreations([cakeSpec]) });
  const cakeLotId = deriveLotId(cakeApplied.seq, 0);
  yield step('bake-finish');

  // -------------------------------------------------------------------
  // 14. Flow wrapper and pallet: real packaging materials, physically
  //     combined with the product, each a real, sourced delivery.
  // -------------------------------------------------------------------
  const filmComposition = registry.getComposition('polypropylene-film', FILM_MASS);
  acquireFromMarket(ledger, accounts.film, filmComposition, 'market:acquire:film');
  yield step('film-acquire');

  const wrappedSpec: LotCreationSpec = {
    substance: 'wrapped-cake',
    mass: cakeMassUg + FILM_MASS,
    parents: [
      { lotId: cakeLotId, mass: cakeMassUg },
      { lotId: roots.film.id, mass: FILM_MASS },
    ],
  };
  const wrapApplied = transferAllElements(ledger, accounts.film, accounts.product, 'pack:wrap', encodeLotCreations([wrappedSpec]));
  const wrappedLotId = deriveLotId(wrapApplied.seq, 0);
  yield step('wrap');

  const cardboardComposition = registry.getComposition('cardboard', CARDBOARD_MASS);
  acquireFromMarket(ledger, accounts.cardboard, cardboardComposition, 'market:acquire:cardboard');
  yield step('cardboard-acquire');

  const palletisedMassUg = cakeMassUg + FILM_MASS + CARDBOARD_MASS;
  const palletisedSpec: LotCreationSpec = {
    substance: 'palletised-cake',
    mass: palletisedMassUg,
    parents: [
      { lotId: wrappedLotId, mass: cakeMassUg + FILM_MASS },
      { lotId: roots.cardboard.id, mass: CARDBOARD_MASS },
    ],
  };
  const palletApplied = transferAllElements(ledger, accounts.cardboard, accounts.product, 'pack:palletise', encodeLotCreations([palletisedSpec]));
  const palletisedLotId = deriveLotId(palletApplied.seq, 0);
  yield step('palletise');

  // -------------------------------------------------------------------
  // 15. Ship: transfer the finished, palletised order to the customer.
  // -------------------------------------------------------------------
  const shippedSpec: LotCreationSpec = {
    substance: 'shipped-cake',
    mass: palletisedMassUg,
    parents: [{ lotId: palletisedLotId, mass: palletisedMassUg }],
  };
  const shipApplied = transferAllElements(ledger, accounts.product, WORLD_ACCOUNTS.marketCustomers, 'market:ship', encodeLotCreations([shippedSpec]));
  const shippedLotId = deriveLotId(shipApplied.seq, 0);
  yield step('shipped');

  const atmosphereAfter = readAtmosphere(ledger);
  const closureReport = checkGraphClosure(graph);

  return {
    accounts,
    roots,
    wheatGrainFreshLotId,
    wheatGrainDryLotId,
    flourLotId,
    milkLotId,
    creamLotId,
    butterLotId,
    eggLotId,
    beetLotId,
    sucroseLotId,
    leaveningByproductLotId,
    batterLotId,
    cakeLotId,
    wrappedLotId,
    palletisedLotId,
    shippedLotId,
    shippedMassUg: palletisedMassUg,
    ingredientMassesUg: {
      flour: flourMassUg,
      butter: butterMassUg,
      egg: eggMassUg,
      sucrose: sucroseMassUg,
      leaveningByproduct: byproductMassInAccountUg,
      water: waterMassUg,
    },
    sunEnergyDrawnUj,
    atmosphereBefore,
    atmosphereAfter,
    closureReport,
  };
}

function readAtmosphere(ledger: Ledger): { readonly C: bigint; readonly H: bigint; readonly O: bigint } {
  return {
    C: ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity('C')),
    H: ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity('H')),
    O: ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity('O')),
  };
}

function massOf(composition: Composition): bigint {
  let total = 0n;
  for (const amount of composition.values()) total += amount;
  return total;
}

/** Jones-factor protein mass, then its gluten-forming share — the same two
 * steps `bake/batter.ts`'s `glutenPrecursorFromNitrogen` performs; called out
 * as a tiny local wrapper only so this file reads as "flour nitrogen in,
 * gluten-forming mass out" at its call site. */
function glutenPrecursorMass(flourNitrogenUg: Micrograms): Micrograms {
  const WHEAT_NITROGEN_TO_PROTEIN_FACTOR = 5.7;
  const GLUTEN_FORMING_PROTEIN_FRACTION = 0.8;
  const proteinMassUg = roundHalfEven(Number(flourNitrogenUg) * WHEAT_NITROGEN_TO_PROTEIN_FACTOR);
  return roundHalfEven(Number(proteinMassUg) * GLUTEN_FORMING_PROTEIN_FRACTION);
}

export interface FirstChainSeed {
  readonly seed: number;
}

/**
 * A step-at-a-time wrapper over `runFirstChain`'s generator, for a caller
 * (see `run.ts`) that wants to advance the scenario a bounded number of
 * ticks at a time rather than run it to completion in one call.
 */
export class FirstChainScenario {
  readonly seed: number;
  readonly ledger: Ledger;
  readonly graph: LotGraph;
  readonly atmosphereTracker: AtmosphereTracker;

  readonly #generator: Generator<FirstChainStep, FirstChainOutcome, void>;
  #outcome: FirstChainOutcome | undefined;
  #lastStep: FirstChainStep | undefined;

  constructor(options: FirstChainSeed) {
    this.seed = options.seed;
    this.graph = new LotGraph();
    this.ledger = new Ledger({ onPosting: this.graph.consume });
    this.atmosphereTracker = new AtmosphereTracker(WORLD_ACCOUNTS.atmosphere);
    this.#generator = runFirstChain(this.seed, this.ledger, this.graph, this.atmosphereTracker);
  }

  get done(): boolean {
    return this.#outcome !== undefined;
  }

  get outcome(): FirstChainOutcome {
    if (!this.#outcome) throw new Error('FirstChainScenario has not finished running yet');
    return this.#outcome;
  }

  /** Advance by exactly one scenario tick. Returns the same terminal step
   * repeatedly once the scenario has shipped. */
  tick(): FirstChainStep {
    if (this.#outcome) {
      return this.#lastStep ?? { index: 0, phase: 'shipped', done: true };
    }
    const result = this.#generator.next();
    if (result.done) {
      this.#outcome = result.value;
      this.#lastStep = { index: this.#lastStep ? this.#lastStep.index + 1 : 0, phase: 'shipped', done: true };
      return this.#lastStep;
    }
    this.#lastStep = result.value;
    return result.value;
  }
}
