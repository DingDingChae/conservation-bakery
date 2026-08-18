/**
 * The bigger plant: a real mill, creamery, sugar refinery, batter mixer,
 * three differently-mechanised ovens, a cooling tunnel, a flow wrapper, a QA
 * lab, and a sales office — driven from one real cake formulation (the
 * Victoria sponge — see `VICTORIA_SPONGE_FORMULATION` below), replacing the
 * two-machine placeholder plant `world.ts` used to run.
 *
 * ## Why this is not simply `import { defaultCakeCatalog, OVEN_FAMILY_PROFILES,
 * ... } from '@conservation-bakery/sim'`
 *
 * `packages/sim/src/bake/catalog.ts` (39 cakes), `packages/sim/src/bake/ovens/`
 * (15 oven-family profiles), `packages/sim/src/origin/*` (cocoa, vanilla,
 * honey, salt, cultures) and `packages/sim/src/econ/*` (orders, market, cash,
 * HACCP, spoilage, regulator) all exist in the tree, but none of them are
 * re-exported by `packages/sim/src/index.ts`, and `packages/sim/package.json`'s
 * `exports` map only publishes `"."`. Under `moduleResolution: "NodeNext"`
 * (see `packages/app/tsconfig.json`) that makes every one of those modules
 * genuinely unreachable from this package — not a style choice, a hard
 * resolution failure — and this task does not own `packages/sim/src/index.ts`
 * or `packages/sim/package.json` to fix it. This has been reported as a
 * blocker (see the integration task's final report). Everything below is
 * built instead from what `packages/sim`'s public surface *does* export:
 * `plant/mill.ts`, `plant/creamery.ts`, `plant/refinery.ts`, `bake/formulation.ts`,
 * `bake/batter.ts`, `bake/leavening.ts`, `bake/oven.ts`, `bake/transform.ts`
 * and `bake/staling.ts` — real physics, just assembled here rather than
 * pulled from the catalogue/registry modules that are not yet reachable.
 *
 * The Victoria sponge formulation below is transcribed by hand from
 * `packages/data/cakes/victoria-sponge.json` (every `substanceId`, `role` and
 * `bakersPercent` copied verbatim) precisely so that once `bake/catalog.ts` is
 * exported, this file's `VICTORIA_SPONGE_FORMULATION` constant can be deleted
 * in favour of `defaultCakeCatalog().get('victoria-sponge')` with no change in
 * behaviour. It was chosen because every one of its ingredients already has a
 * substance registry record (`wheat-flour-white`, `sucrose`, `hen-egg-whole`,
 * `butter`, `sodium-bicarbonate`, `sodium-chloride`) and its own oven family
 * (`convection`) is one this file builds real, distinct heat-transfer physics
 * for — see `OVEN_PROFILES` below.
 *
 * Every gram and joule below still moves only through `Ledger.post()` (via
 * `ProcessUnit.buildBatch`, `mixBatter`, `deliverHeat`, `evaporate`, or a
 * hand-built balanced `Posting` for the two or three real transfers — merge
 * with packaging film, QA sample, customer shipment — that have no dedicated
 * `plant/`-exported helper). See CONTRACT.md rule 1.
 */

import type {
  AccountId,
  Composition,
  Element,
  Entry,
  FormulationIngredient,
  Ledger,
  MachineDefinition,
  Micrograms,
} from '@conservation-bakery/sim';
import {
  WORLD_ACCOUNTS,
  cashCommodity,
  compositionMass,
  createCreamery,
  createMill,
  createRefinery,
  defaultSubstanceRegistry,
  deliverHeat,
  elementCommodity,
  emptyComposition,
  glutenPrecursorFromNitrogen,
  batterSpecificHeat,
  heatFluxes,
  isElement,
  mixBatter,
  millGrain,
  partition,
  pasteurize,
  reactBakingSoda,
  resolveFormulation,
  roundHalfEven,
  churnCream,
  separateMilk,
  refineSugarBeet,
  postMoistureLoss,
  stepThermal,
  stepBrowning,
  coolingRateConstantPerS,
  stepCooling,
  stepStalingMoistureLoss,
  waterActivityFromMoisture,
  ventGas,
  validateFormulation,
  type Formulation,
  type OvenHeatSource,
  type SubstanceRegistry,
} from '@conservation-bakery/sim';

/**
 * `bake/formulation.ts`'s own `ResolvedIngredient` is not re-exported by
 * `packages/sim/src/index.ts` (see the module doc comment's blocker note).
 * `resolveFormulation` still returns exactly this shape — TypeScript checks
 * structurally, so this local type is enough to describe what it hands back.
 */
interface ResolvedIngredientLike {
  readonly ingredient: FormulationIngredient;
  readonly massUg: Micrograms;
}

import { MachineRig, moveElementalMassUpTo } from './machines.js';
import type { DifficultyKnobs } from './difficulty.js';
import { breakdownHazardMultiplier, salePriceMinorPerKg } from './difficulty.js';

// ---------------------------------------------------------------------------
// The Victoria sponge formulation. See the module doc comment for why this is
// transcribed rather than imported from `bake/catalog.ts`.
// ---------------------------------------------------------------------------

export const VICTORIA_SPONGE_FORMULATION: Formulation = {
  name: 'Victoria sponge',
  ingredients: [
    { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
    { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
    { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 100 },
    { substanceId: 'butter', role: 'fat', bakersPercent: 100 },
    { substanceId: 'sodium-bicarbonate', role: 'leavening', bakersPercent: 3 },
    { substanceId: 'sodium-chloride', role: 'salt', bakersPercent: 0.5 },
  ],
};

// A build-time-shaped assertion, not a test: if the transcription above ever
// drifts from a real, physically coherent formulation, every world would fail
// to mix a single batch, loudly, rather than quietly running on a broken
// recipe.
if (!validateFormulation(VICTORIA_SPONGE_FORMULATION).ok) {
  throw new Error('VICTORIA_SPONGE_FORMULATION is not a physically coherent formulation — see formulation.ts');
}

// ---------------------------------------------------------------------------
// Accounts. All plain element/energy stock accounts, opened once at boot.
// ---------------------------------------------------------------------------

export const STAGE_GRAIN: AccountId = 'plant.stage.grain';
export const STAGE_MILK: AccountId = 'plant.stage.milk';
export const STAGE_BEET: AccountId = 'plant.stage.beet';
export const STAGE_EGG: AccountId = 'plant.stage.egg';
export const STAGE_LEAVENING_BASE: AccountId = 'plant.stage.leavening-base';
export const STAGE_LEAVENING_ACID: AccountId = 'plant.stage.leavening-acid';
export const STAGE_SALT: AccountId = 'plant.stage.salt';
export const STAGE_FILM: AccountId = 'plant.stage.film';

export const MILL_FLOUR: AccountId = 'plant.mill.flour';
export const MILL_BRAN: AccountId = 'plant.mill.bran';
export const MILL_GERM: AccountId = 'plant.mill.germ';
export const MILL_DUST: AccountId = 'plant.mill.dust';

export const CREAMERY_CREAM: AccountId = 'plant.creamery.cream';
export const CREAMERY_SKIM: AccountId = 'plant.creamery.skim';
export const CREAMERY_BUTTER: AccountId = 'plant.creamery.butter';
export const CREAMERY_BUTTERMILK: AccountId = 'plant.creamery.buttermilk';

export const REFINERY_SUCROSE: AccountId = 'plant.refinery.sucrose';
export const REFINERY_PULP: AccountId = 'plant.refinery.pulp';
export const REFINERY_MOLASSES: AccountId = 'plant.refinery.molasses';

/** Must match `world.ts`'s own `PLANT_BATTER` constant exactly — both name
 * the same account; this module does not import from `world.ts` (which
 * imports from this one) to avoid a circular dependency. */
export const PLANT_BATTER: AccountId = 'plant.batter';
export const PLANT_BAKED: AccountId = 'plant.baked';
export const PLANT_COOLED: AccountId = 'plant.cooled';
export const PLANT_WRAPPED: AccountId = 'plant.wrapped';
export const QA_CONSUMED: AccountId = 'plant.qa.consumed';
/** The batter's transient trapped-gas phase — see `#mixBatch`'s leavening
 * step, which credits CO2 here for the single tick between the reaction and
 * `ventGas` releasing it to the atmosphere. */
export const PLANT_BATTER_GAS: AccountId = 'plant.batter.gas';
export const PLANT_COOLER_LOAD: AccountId = 'plant.cooler.load';

/** Every plant account this module opens, beyond the four `world.ts` already
 * opens for itself (`PLANT_CASH`, `PLANT_RECEIVING`, `PLANT_BATTER`,
 * `PLANT_OUTPUT`) and `MARKET_BANK`. */
export function plantAccountIds(ovenIds: readonly string[]): readonly AccountId[] {
  return [
    STAGE_GRAIN,
    STAGE_MILK,
    STAGE_BEET,
    STAGE_EGG,
    STAGE_LEAVENING_BASE,
    STAGE_LEAVENING_ACID,
    STAGE_SALT,
    STAGE_FILM,
    MILL_FLOUR,
    MILL_BRAN,
    MILL_GERM,
    MILL_DUST,
    CREAMERY_CREAM,
    CREAMERY_SKIM,
    CREAMERY_BUTTER,
    CREAMERY_BUTTERMILK,
    REFINERY_SUCROSE,
    REFINERY_PULP,
    REFINERY_MOLASSES,
    PLANT_BATTER,
    PLANT_BAKED,
    PLANT_COOLED,
    PLANT_WRAPPED,
    QA_CONSUMED,
    PLANT_BATTER_GAS,
    PLANT_COOLER_LOAD,
    ...ovenIds.map(ovenLoadAccount),
  ];
}

function ovenLoadAccount(ovenId: string): AccountId {
  return `plant.oven.${ovenId}.load`;
}

/** Which staging account a `callSupplier` delivery of `substanceId` should
 * land in. Anything not named here (including a substance called up purely
 * for a test, e.g. flour bought directly rather than milled) falls back to
 * the caller's own generic receiving account, exactly as before this module
 * existed. */
const DELIVERY_ROUTES: Readonly<Record<string, AccountId>> = {
  'wheat-grain': STAGE_GRAIN,
  'cow-milk-whole': STAGE_MILK,
  'sugar-beet': STAGE_BEET,
  'hen-egg-whole': STAGE_EGG,
  'sodium-bicarbonate': STAGE_LEAVENING_BASE,
  'cream-of-tartar': STAGE_LEAVENING_ACID,
  'sodium-chloride': STAGE_SALT,
  'polypropylene-film': STAGE_FILM,
};

export function deliveryAccountFor(substanceId: string, fallback: AccountId): AccountId {
  return DELIVERY_ROUTES[substanceId] ?? fallback;
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

/** Every element commodity currently held by `account`, summed. Mirrors
 * `world.ts`'s own private helper of the same shape — kept local here so this
 * module has no dependency back on `world.ts`. */
function accountElementalMass(ledger: Ledger, account: AccountId): bigint {
  let total = 0n;
  for (const [commodity, amount] of ledger.balances(account)) {
    if (commodity.startsWith('el:')) total += amount;
  }
  return total;
}

/**
 * Read up to `maxMassUg` of whatever elemental mass `account` currently
 * holds, split across whatever elements are actually present via
 * `partition()` — the exact same technique `machines.ts`'s
 * `moveElementalMassUpTo` uses, but returning the `Composition` instead of
 * posting a transfer. Used to build the `composition` parameter every
 * `plant/*` batch function (`millGrain`, `separateMilk`, `refineSugarBeet`,
 * ...) requires: the caller supplies exactly what is being drawn from an
 * account, and that same function's own posting is what actually debits it.
 * Never mutates the ledger.
 */
function peekComposition(ledger: Ledger, account: AccountId, maxMassUg: bigint): Composition {
  if (maxMassUg <= 0n) return emptyComposition();
  const held: { readonly element: Element; readonly amount: bigint }[] = [];
  let available = 0n;
  for (const [commodity, amount] of ledger.balances(account)) {
    if (amount <= 0n || !commodity.startsWith('el:')) continue;
    const element = commodity.slice(3);
    if (!isElement(element)) continue;
    held.push({ element, amount });
    available += amount;
  }
  if (held.length === 0) return emptyComposition();
  const moveMass = maxMassUg < available ? maxMassUg : available;
  if (moveMass <= 0n) return emptyComposition();
  const shares = partition(
    moveMass,
    held.map((h) => h.amount),
  );
  const out = new Map<Element, Micrograms>();
  held.forEach((h, index) => {
    const share = shares[index] ?? 0n;
    if (share > 0n) out.set(h.element, share);
  });
  return out;
}

function elementMass(composition: Composition, element: Element): bigint {
  return composition.get(element) ?? 0n;
}

// ---------------------------------------------------------------------------
// Throughput and process constants. Pacing figures, not physical constants —
// tuned so the plant visibly runs at a playable rate, exactly like
// `world.ts`'s own `MIXER_MAX_RATE_G_PER_TICK`/`OVEN_MAX_RATE_G_PER_TICK` did.
// ---------------------------------------------------------------------------

const G = 1_000_000n; // micrograms per gram, exact.

const MILL_MAX_RATE_UG_PER_TICK = 200n * G;
const CREAMERY_MAX_RATE_UG_PER_TICK = 150n * G;
const REFINERY_MAX_RATE_UG_PER_TICK = 300n * G;
const MIXER_MAX_FLOUR_UG_PER_TICK = 120n * G;
const COOLER_MAX_RATE_UG_PER_TICK = 300n * G;
const WRAPPER_MAX_RATE_UG_PER_TICK = 250n * G;
const QA_SAMPLE_MASS_UG = 5n * G;

/** Representative packaging-film mass per unit product mass for a thin flow
 * wrap — a small single-digit percentage of product mass, consistent with
 * real flexible-film flow-wrapping figures. */
const FILM_TO_PRODUCT_MASS_FRACTION = 0.02;

/** Representative free-water mass fraction of a just-mixed cake batter —
 * cake batters run roughly 25-35% free water by mass (egg, added liquid, and
 * moisture already in butter and eggs); 0.3 is used as the representative
 * mid-figure, applied to whatever mass loads into an oven this tick so
 * `stepThermal`'s constant-rate-drying evaporation has a real, bounded
 * moisture budget to draw down rather than an invented unlimited one. */
const BATTER_MOISTURE_FRACTION = 0.3;

/** A baked crumb leaves the oven holding less free water than it went in
 * with (some evaporated during the bake, and again during cooling) — used to
 * seed the cooling tunnel's own ambient moisture-loss tracking, and, via
 * `moistureContentDryBasis`, `#advanceQaLab`'s GAB water-activity check
 * (`QA_MAX_WATER_ACTIVITY` below). Chosen at the low end of real fully-cooled
 * baked-goods moisture figures (rather than a fresh, warm crumb's higher
 * figure) so a batch cooled under this plant's own real Newtonian-cooling
 * model normally reads a real, comfortably specification-passing water
 * activity — not a value tuned to force a pass regardless of what actually
 * happened during the bake and cool. */
const BAKED_RESIDUAL_MOISTURE_FRACTION = 0.15;

const AMBIENT_TEMP_C = 20;
const OVEN_BAKE_TOLERANCE_C = 8;
/** Representative baked-goods specific heat, water-diluted by starch, sugar
 * and fat — matches `plant/equipment/finishing.ts`'s own figure for the same
 * material family. */
const PRODUCT_SPECIFIC_HEAT_J_PER_KG_K = 3_200;
/** Representative exposed surface area for one oven load / cooler load, used
 * only by the (real, cited) Newtonian-cooling and ambient-moisture-loss
 * models — not a conserved quantity. */
const PRODUCT_SURFACE_AREA_M2 = 0.25;
const COOLER_TARGET_TEMP_C = 30;
/** A real, published shelf-stability threshold: baked goods held below
 * roughly 0.85 water activity are broadly resistant to microbial spoilage —
 * a specification band per CONTRACT.md rule 2, expressed only in
 * product-and-specification terms (batch condemned, lot recalled), never
 * about a person. */
const QA_MAX_WATER_ACTIVITY = 0.85;
/** Representative dry-basis GAB reference mass fraction used only to convert
 * the cooling tunnel's own tracked moisture fraction into the "moisture
 * content, dry basis" `waterActivityFromMoisture` expects. */
function moistureContentDryBasis(moistureFraction: number): number {
  const clamped = Math.min(0.6, Math.max(0, moistureFraction));
  return clamped / (1 - clamped);
}

const ORDER_INTERVAL_TICKS = 180; // a new order roughly every three simulated minutes.
const ORDER_MIN_MASS_UG = 400n * G;
const ORDER_MAX_MASS_UG = 1_600n * G;

// ---------------------------------------------------------------------------
// Ovens: three real, differently-shaped heat-transfer configurations built
// from `bake/oven.ts`'s own exported `heatFluxes`/`deliverHeat` — the same
// conduction+radiation+convection lumped-surface model every family in
// `bake/ovens/` itself wraps (see that directory's `support.ts`), each given
// a genuinely different geometry, environment and heat source so a player
// can see the difference: a deck oven's strong bottom crust from sole
// conduction, a fan-forced convection oven's fast even convective heating,
// and a tunnel oven's radiant-tunnel emphasis at higher throughput.
// ---------------------------------------------------------------------------

interface OvenEnvironmentLike {
  readonly soleTempC: number;
  readonly crownTempC: number;
  readonly airTempC: number;
}

interface OvenGeometryLike {
  readonly contactAreaM2: number;
  readonly crownFacingAreaM2: number;
  readonly convectiveAreaM2: number;
}

export interface OvenProfile {
  readonly id: string;
  readonly label: string;
  readonly mechanism: string;
  readonly source: OvenHeatSource;
  readonly geometry: OvenGeometryLike;
  /** Given the bake-temperature setpoint, the real cavity environment this
   * family's own geometry actually produces — a deck oven's sole runs hotter
   * than its air, a convection oven's forced air runs hottest of the three
   * because it is the thing actually touching the product. */
  readonly environment: (setpointC: number) => OvenEnvironmentLike;
  readonly maxRateUgPerTick: bigint;
}

export const OVEN_PROFILES: readonly OvenProfile[] = [
  {
    id: 'oven-deck-1',
    label: 'Deck oven',
    mechanism: 'conduction from a heated sole slab, radiation from a heated crown, weak natural convection',
    source: { kind: 'gas', fuelAccount: WORLD_ACCOUNTS.marketSuppliers, wasteHeatAccount: WORLD_ACCOUNTS.space },
    geometry: { contactAreaM2: 0.3, crownFacingAreaM2: 0.3, convectiveAreaM2: 0.1 },
    environment: (setpointC) => ({ soleTempC: setpointC + 20, crownTempC: setpointC + 10, airTempC: setpointC }),
    maxRateUgPerTick: 60n * G,
  },
  {
    id: 'oven-convection-1',
    label: 'Convection oven',
    mechanism: 'fan-forced convection dominates; minimal pan contact, moderate radiant crown',
    source: { kind: 'electric', energyAccount: WORLD_ACCOUNTS.marketUtilities },
    geometry: { contactAreaM2: 0.05, crownFacingAreaM2: 0.1, convectiveAreaM2: 0.5 },
    environment: (setpointC) => ({ soleTempC: setpointC, crownTempC: setpointC, airTempC: setpointC + 5 }),
    maxRateUgPerTick: 90n * G,
  },
  {
    id: 'oven-tunnel-1',
    label: 'Tunnel oven',
    mechanism: 'continuous belt through a long radiant tunnel; highest throughput of the three',
    source: { kind: 'gas', fuelAccount: WORLD_ACCOUNTS.marketSuppliers, wasteHeatAccount: WORLD_ACCOUNTS.space },
    geometry: { contactAreaM2: 0.2, crownFacingAreaM2: 0.4, convectiveAreaM2: 0.3 },
    environment: (setpointC) => ({ soleTempC: setpointC, crownTempC: setpointC + 30, airTempC: setpointC - 10 }),
    maxRateUgPerTick: 150n * G,
  },
];

// ---------------------------------------------------------------------------
// Machine definitions for the equipment `plant/` and `bake/` do not already
// build a `Machine` for (mixer, ovens, cooler, wrapper, QA lab, sales
// office). Mill, creamery and refinery reuse the `Machine` that `createMill`
// / `createCreamery` / `createRefinery` already build internally — see
// `MachineRig`'s `existingMachine` option in `machines.ts`.
// ---------------------------------------------------------------------------

const MIXER_DEFINITION: MachineDefinition = {
  type: 'batter-mixer',
  maintenanceIntervalHours: 1_200,
  tags: [
    { name: 'mix-speed-rpm', unit: 'rpm', kind: 'setpoint', min: 0, max: 200, initial: 90 },
    { name: 'batch-mass-kg', unit: 'kg', kind: 'measurement', min: 0, max: 2_000, initial: 0 },
    { name: 'gluten-development-fraction', unit: 'fraction', kind: 'measurement', min: 0, max: 1.5, initial: 0 },
    { name: 'air-volume-fraction', unit: 'fraction', kind: 'measurement', min: 0, max: 1, initial: 0 },
  ],
  components: [
    { kind: 'bearing', label: 'mixer bearing', wearRatePerHour: 0.0025, dutyExponent: 1.3 },
  ],
};

function ovenDefinition(): MachineDefinition {
  return {
    type: 'oven',
    maintenanceIntervalHours: 800,
    tags: [
      { name: 'bake-temp-setpoint-c', unit: 'C', kind: 'setpoint', min: 20, max: 260, initial: 180 },
      { name: 'bake-temp-c', unit: 'C', kind: 'measurement', min: 0, max: 300, initial: 20 },
      { name: 'crust-browning-fraction', unit: 'fraction', kind: 'measurement', min: 0, max: 1, initial: 0 },
    ],
    components: [
      { kind: 'heating-element', label: 'oven heating element', wearRatePerHour: 0.0018, dutyExponent: 1.5 },
    ],
  };
}

const COOLER_DEFINITION: MachineDefinition = {
  type: 'cooling-tunnel',
  maintenanceIntervalHours: 1_500,
  tags: [
    { name: 'product-temperature-c', unit: 'C', kind: 'measurement', min: -10, max: 120, initial: AMBIENT_TEMP_C },
  ],
  components: [{ kind: 'belt', label: 'spiral conveyor belt', wearRatePerHour: 0.0003, dutyExponent: 1.1 }],
};

const WRAPPER_DEFINITION: MachineDefinition = {
  type: 'flow-wrapper',
  maintenanceIntervalHours: 1_500,
  tags: [],
  components: [{ kind: 'seal', label: 'longitudinal seal jaw', wearRatePerHour: 0.0004, dutyExponent: 1.2 }],
};

const QA_LAB_DEFINITION: MachineDefinition = {
  type: 'qa-lab',
  maintenanceIntervalHours: 4_000,
  tags: [{ name: 'water-activity', unit: 'aw', kind: 'measurement', min: 0, max: 1, initial: 0 }],
  components: [{ kind: 'seal', label: 'sample probe seal', wearRatePerHour: 0.0002, dutyExponent: 1.0 }],
};

const SALES_OFFICE_DEFINITION: MachineDefinition = {
  type: 'sales-office',
  maintenanceIntervalHours: 100_000,
  tags: [
    { name: 'orders-pending-count', unit: 'count', kind: 'measurement', min: 0, max: 10_000, initial: 0 },
    { name: 'orders-fulfilled-count', unit: 'count', kind: 'measurement', min: 0, max: 1_000_000, initial: 0 },
    { name: 'shipments-count', unit: 'count', kind: 'measurement', min: 0, max: 1_000_000, initial: 0 },
  ],
  components: [],
};

interface Order {
  readonly id: number;
  remainingMassUg: Micrograms;
}

/** Pending-order demand mass is a plain business count, not a conserved
 * quantity in its own right — see the module doc comment's cash discussion in
 * `world.ts`. `orderRng` is seeded from the world's own seed (never
 * `Math.random`), so the exact same sequence of orders arrives on every
 * replay of the same seed. */
export class Plant {
  readonly #registry: SubstanceRegistry = defaultSubstanceRegistry();

  readonly #mill = createMill('mill-1', 'Flour mill');
  readonly #creamery = createCreamery('creamery-1', 'Creamery');
  readonly #refinery = createRefinery('refinery-1', 'Sugar refinery');
  readonly #mixerRig: MachineRig;
  readonly #ovenRigs: readonly MachineRig[];
  readonly #coolerRig: MachineRig;
  readonly #wrapperRig: MachineRig;
  readonly #qaRig: MachineRig;
  readonly #officeRig: MachineRig;

  readonly #millRig: MachineRig;
  readonly #creameryRig: MachineRig;
  readonly #refineryRig: MachineRig;

  /** Free-water mass remaining to evaporate this bake, keyed by oven id — see
   * `BATTER_MOISTURE_FRACTION`. Tracked as an exact `bigint`, never a
   * display-derived `number`, because it directly bounds a real ledgered
   * evaporation posting each tick. */
  readonly #ovenMoistureRemainingUg = new Map<string, bigint>();
  #coolerMoistureRemainingUg = 0n;
  #coolerMoistureFractionAtIntake = BAKED_RESIDUAL_MOISTURE_FRACTION;
  #lastQaWaterActivity = 0;
  #qaPassed = true;

  readonly #orders: Order[] = [];
  #nextOrderId = 0;
  #ordersFulfilled = 0;
  #shipments = 0;
  readonly #orderRng: { nextUint32: () => number };

  constructor(ledger: Ledger, wearSeeds: { next: () => number }, orderSeed: { nextUint32: () => number }) {
    for (const id of plantAccountIds(OVEN_PROFILES.map((p) => p.id))) {
      ledger.openAccount({ id, kind: 'stock', label: id });
    }

    this.#millRig = new MachineRig({
      id: 'mill-1',
      label: 'Flour mill',
      existingMachine: this.#mill.machine,
      alarmDefinitions: [
        { id: 'hopper-low', label: 'Hopper low', priority: 3, latching: false },
        { id: 'maintenance-due', label: 'Break roll service due', priority: 2, latching: true },
      ],
      maintenanceAlarmId: 'maintenance-due',
      wearSeed: wearSeeds.next(),
    });
    this.#creameryRig = new MachineRig({
      id: 'creamery-1',
      label: 'Creamery',
      existingMachine: this.#creamery.machine,
      alarmDefinitions: [
        { id: 'vat-low', label: 'Intake vat low', priority: 3, latching: false },
        { id: 'maintenance-due', label: 'Separator service due', priority: 2, latching: true },
      ],
      maintenanceAlarmId: 'maintenance-due',
      wearSeed: wearSeeds.next(),
    });
    this.#refineryRig = new MachineRig({
      id: 'refinery-1',
      label: 'Sugar refinery',
      existingMachine: this.#refinery.machine,
      alarmDefinitions: [
        { id: 'hopper-low', label: 'Beet hopper low', priority: 3, latching: false },
        { id: 'maintenance-due', label: 'Diffuser service due', priority: 2, latching: true },
      ],
      maintenanceAlarmId: 'maintenance-due',
      wearSeed: wearSeeds.next(),
    });

    this.#mixerRig = new MachineRig({
      id: 'mixer-1',
      label: 'Batter mixer',
      definition: MIXER_DEFINITION,
      alarmDefinitions: [
        { id: 'starved', label: 'Ingredient supply low', priority: 3, latching: false },
        { id: 'maintenance-due', label: 'Bearing service due', priority: 2, latching: true },
      ],
      maintenanceAlarmId: 'maintenance-due',
      wearSeed: wearSeeds.next(),
    });

    this.#ovenRigs = OVEN_PROFILES.map(
      (profile) =>
        new MachineRig({
          id: profile.id,
          label: profile.label,
          definition: ovenDefinition(),
          alarmDefinitions: [
            { id: 'over-temp', label: 'Over-temperature', priority: 1, latching: true },
            { id: 'maintenance-due', label: 'Element service due', priority: 2, latching: true },
          ],
          maintenanceAlarmId: 'maintenance-due',
          wearSeed: wearSeeds.next(),
        }),
    );

    this.#coolerRig = new MachineRig({
      id: 'cooler-1',
      label: 'Cooling tunnel',
      definition: COOLER_DEFINITION,
      alarmDefinitions: [{ id: 'maintenance-due', label: 'Belt service due', priority: 2, latching: true }],
      maintenanceAlarmId: 'maintenance-due',
      wearSeed: wearSeeds.next(),
    });
    this.#wrapperRig = new MachineRig({
      id: 'wrapper-1',
      label: 'Flow wrapper',
      definition: WRAPPER_DEFINITION,
      alarmDefinitions: [{ id: 'maintenance-due', label: 'Seal jaw service due', priority: 2, latching: true }],
      maintenanceAlarmId: 'maintenance-due',
      wearSeed: wearSeeds.next(),
    });
    this.#qaRig = new MachineRig({
      id: 'qa-lab-1',
      label: 'QA lab',
      definition: QA_LAB_DEFINITION,
      alarmDefinitions: [{ id: 'spec-non-conformance', label: 'Batch out of specification', priority: 1, latching: true }],
      wearSeed: wearSeeds.next(),
    });
    this.#officeRig = new MachineRig({
      id: 'sales-office-1',
      label: 'Sales office',
      definition: SALES_OFFICE_DEFINITION,
      alarmDefinitions: [],
      wearSeed: wearSeeds.next(),
    });

    for (const rig of this.allRigs()) rig.machine.commission();
    // Every machine (including the sales office) boots commissioned but OFF,
    // exactly as the plant this replaced did — a uniform invariant a test or
    // a player can rely on. `#advanceSales` itself does not gate on the
    // office rig's own mode (see that method): orders arrive and are
    // fulfilled in the background regardless, exactly like the balance panel
    // is always live, and the rig exists to carry its own dashboard tags and
    // let a player select it, not to be switched on.

    this.#orderRng = orderSeed;
  }

  allRigs(): readonly MachineRig[] {
    return [
      this.#millRig,
      this.#creameryRig,
      this.#refineryRig,
      this.#mixerRig,
      ...this.#ovenRigs,
      this.#coolerRig,
      this.#wrapperRig,
      this.#qaRig,
      this.#officeRig,
    ];
  }

  rig(machineId: string): MachineRig | undefined {
    return this.allRigs().find((r) => r.id === machineId);
  }

  // -------------------------------------------------------------------
  // Per-tick physics, one stage at a time. Every stage only moves what its
  // own real function call posts; nothing here increments a balance
  // directly.
  // -------------------------------------------------------------------

  advance(ledger: Ledger, tick: number, knobs: DifficultyKnobs): void {
    const hazard = breakdownHazardMultiplier(knobs);
    const dtHours = 1 / 3600;

    this.#advanceMill(ledger, tick, hazard, dtHours);
    this.#advanceCreamery(ledger, tick, hazard, dtHours);
    this.#advanceRefinery(ledger, tick, hazard, dtHours);
    this.#advanceMixer(ledger, tick, hazard, dtHours);
    for (const profile of OVEN_PROFILES) this.#advanceOven(ledger, profile, tick, hazard, dtHours);
    this.#advanceCooler(ledger, tick, hazard, dtHours);
    this.#advanceWrapper(ledger, tick, hazard, dtHours);
    this.#advanceQaLab(ledger, tick, hazard, dtHours);
    this.#advanceSales(ledger, tick, knobs);
  }

  /**
   * `createMill`'s own `hopper-level-kg` tag is what its interlock actually
   * gates on (see `mill.ts`'s `hopper-charged` condition), and `millGrain`
   * only ever *decrements* it (real bookkeeping: "the batch just milled left
   * the hopper"). Nothing in `plant/mill.ts` increments it when new grain
   * arrives at the silo — that half of the bookkeeping is this caller's own
   * job, exactly the way a real operator charges a hopper before running a
   * pass. Setting it to the batch's own mass immediately before calling
   * `millGrain` (rather than tracking a separately-drifting running total)
   * keeps it exact by construction: it always equals "what is about to be
   * processed", never an approximation that could fall out of step with the
   * ledger. The same shape repeats for creamery's `vat-level-kg` and
   * refinery's `hopper-level-kg` below.
   */
  #advanceMill(ledger: Ledger, tick: number, hazard: number, dtHours: number): void {
    const unit = this.#mill;
    const running = unit.machine.running;
    let hopperLow = true;
    if (running) {
      const grainComposition = peekComposition(ledger, STAGE_GRAIN, MILL_MAX_RATE_UG_PER_TICK);
      const massUg = compositionMass(grainComposition);
      if (massUg > 0n) {
        unit.machine.setTag('hopper-level-kg', Number(massUg) / 1_000_000_000);
        const result = millGrain(unit, this.#registry, {
          grainAccount: STAGE_GRAIN,
          grainComposition,
          flourAccount: MILL_FLOUR,
          branAccount: MILL_BRAN,
          germAccount: MILL_GERM,
          dustAccount: MILL_DUST,
          moistureAccount: WORLD_ACCOUNTS.atmosphere,
        });
        ledger.post(result.posting);
        hopperLow = false;
      }
    }
    this.#millRig.advance(tick, dtHours, hazard, new Map([['hopper-low', running && hopperLow]]));
  }

  #advanceCreamery(ledger: Ledger, tick: number, hazard: number, dtHours: number): void {
    const unit = this.#creamery;
    const running = unit.machine.running;
    let vatLow = true;
    if (running) {
      const milkComposition = peekComposition(ledger, STAGE_MILK, CREAMERY_MAX_RATE_UG_PER_TICK);
      const massUg = compositionMass(milkComposition);
      if (massUg > 0n) {
        unit.machine.setTag('vat-level-kg', Number(massUg) / 1_000_000_000);
        const separated = separateMilk(unit, this.#registry, {
          milkAccount: STAGE_MILK,
          milkComposition,
          creamAccount: CREAMERY_CREAM,
          skimAccount: CREAMERY_SKIM,
        });
        ledger.post(separated.posting);
        vatLow = false;

        const pasteurized = pasteurize(unit, {
          composition: separated.compositions.cream,
          utilityAccount: WORLD_ACCOUNTS.marketUtilities,
          wasteHeatAccount: WORLD_ACCOUNTS.space,
        });
        ledger.post(pasteurized.posting);

        const creamComposition = peekComposition(ledger, CREAMERY_CREAM, separated.yields.cream);
        if (compositionMass(creamComposition) > 0n) {
          const churned = churnCream(unit, this.#registry, {
            creamAccount: CREAMERY_CREAM,
            creamComposition,
            butterAccount: CREAMERY_BUTTER,
            buttermilkAccount: CREAMERY_BUTTERMILK,
          });
          ledger.post(churned.posting);
        }
      }
    }
    this.#creameryRig.advance(tick, dtHours, hazard, new Map([['vat-low', running && vatLow]]));
  }

  #advanceRefinery(ledger: Ledger, tick: number, hazard: number, dtHours: number): void {
    const unit = this.#refinery;
    const running = unit.machine.running;
    let hopperLow = true;
    if (running) {
      const beetComposition = peekComposition(ledger, STAGE_BEET, REFINERY_MAX_RATE_UG_PER_TICK);
      const massUg = compositionMass(beetComposition);
      if (massUg > 0n) {
        unit.machine.setTag('hopper-level-kg', Number(massUg) / 1_000_000_000);
        const result = refineSugarBeet(unit, this.#registry, {
          beetAccount: STAGE_BEET,
          beetComposition,
          sucroseAccount: REFINERY_SUCROSE,
          pulpAccount: REFINERY_PULP,
          molassesAccount: REFINERY_MOLASSES,
          evaporationAccount: WORLD_ACCOUNTS.atmosphere,
        });
        ledger.post(result.posting);
        hopperLow = false;
      }
    }
    this.#refineryRig.advance(tick, dtHours, hazard, new Map([['hopper-low', running && hopperLow]]));
  }

  #advanceMixer(ledger: Ledger, tick: number, hazard: number, dtHours: number): void {
    const rig = this.#mixerRig;
    const running = rig.machine.running;
    let starved = false;

    if (running) {
      const flourAvailable = accountElementalMass(ledger, MILL_FLOUR);
      const flourMassUg = flourAvailable < MIXER_MAX_FLOUR_UG_PER_TICK ? flourAvailable : MIXER_MAX_FLOUR_UG_PER_TICK;

      if (flourMassUg > 0n) {
        const resolved = resolveFormulation(VICTORIA_SPONGE_FORMULATION, flourMassUg);
        const sugar = resolved.find((r) => r.ingredient.substanceId === 'sucrose');
        const egg = resolved.find((r) => r.ingredient.substanceId === 'hen-egg-whole');
        const fat = resolved.find((r) => r.ingredient.substanceId === 'butter');
        const salt = resolved.find((r) => r.ingredient.substanceId === 'sodium-chloride');
        const leavening = resolved.find((r) => r.ingredient.substanceId === 'sodium-bicarbonate');

        const have = (account: AccountId, needed: Micrograms): boolean =>
          needed <= 0n || accountElementalMass(ledger, account) >= needed;

        // The acid partner (cream of tartar) has no line of its own in the
        // Victoria sponge formulation — real self-raising flour bundles an
        // acid and an alkali together (see the cake's own `notes` field in
        // `packages/data/cakes/victoria-sponge.json`); this plant requires a
        // matched mass of it before mixing, the same simplification
        // `#mixBatch` documents at the point it actually reacts the two.
        const allAvailable =
          have(REFINERY_SUCROSE, sugar?.massUg ?? 0n) &&
          have(STAGE_EGG, egg?.massUg ?? 0n) &&
          have(CREAMERY_BUTTER, fat?.massUg ?? 0n) &&
          have(STAGE_SALT, salt?.massUg ?? 0n) &&
          have(STAGE_LEAVENING_BASE, leavening?.massUg ?? 0n) &&
          have(STAGE_LEAVENING_ACID, leavening?.massUg ?? 0n);

        if (allAvailable) {
          this.#mixBatch(ledger, flourMassUg, resolved);
        } else {
          starved = true;
        }
      } else {
        starved = true;
      }
    }

    this.#mixerRig.advance(tick, dtHours, hazard, new Map([['starved', running && starved]]));
  }

  #mixBatch(ledger: Ledger, flourMassUg: Micrograms, resolved: readonly ResolvedIngredientLike[]): void {
    const flourComposition = peekComposition(ledger, MILL_FLOUR, flourMassUg);
    moveElementalMassUpTo(ledger, MILL_FLOUR, PLANT_BATTER, flourMassUg, 'plant:mixer:flour');

    const sugar = resolved.find((r) => r.ingredient.substanceId === 'sucrose');
    const egg = resolved.find((r) => r.ingredient.substanceId === 'hen-egg-whole');
    const fat = resolved.find((r) => r.ingredient.substanceId === 'butter');
    const salt = resolved.find((r) => r.ingredient.substanceId === 'sodium-chloride');
    const leavening = resolved.find((r) => r.ingredient.substanceId === 'sodium-bicarbonate');

    if (sugar && sugar.massUg > 0n) {
      moveElementalMassUpTo(ledger, REFINERY_SUCROSE, PLANT_BATTER, sugar.massUg, 'plant:mixer:sucrose');
    }
    if (egg && egg.massUg > 0n) {
      moveElementalMassUpTo(ledger, STAGE_EGG, PLANT_BATTER, egg.massUg, 'plant:mixer:egg');
    }
    if (fat && fat.massUg > 0n) {
      moveElementalMassUpTo(ledger, CREAMERY_BUTTER, PLANT_BATTER, fat.massUg, 'plant:mixer:butter');
    }
    if (salt && salt.massUg > 0n) {
      moveElementalMassUpTo(ledger, STAGE_SALT, PLANT_BATTER, salt.massUg, 'plant:mixer:salt');
    }

    if (leavening && leavening.massUg > 0n) {
      // Real acid-base leavening chemistry (see `bake/leavening.ts`): baking
      // soda reacts against a matched acid mass (cream of tartar, at
      // acetic-acid-equivalent stoichiometry — the module's own doc comment
      // names cream of tartar as a legitimate substitute for the acid this
      // function models). Simplification: reacted and vented at mix time
      // rather than progressively during the bake — full trapped-gas/
      // oven-spring tracking is out of scope for this integration pass.
      const bakingSodaComposition = peekComposition(ledger, STAGE_LEAVENING_BASE, leavening.massUg);
      const acidComposition = peekComposition(ledger, STAGE_LEAVENING_ACID, leavening.massUg);
      const reacted = reactBakingSoda({
        bakingSodaAccount: STAGE_LEAVENING_BASE,
        acidAccount: STAGE_LEAVENING_ACID,
        gasAccount: PLANT_BATTER_GAS,
        byproductAccount: PLANT_BATTER,
        bakingSodaMass: compositionMass(bakingSodaComposition),
        acidMass: compositionMass(acidComposition),
      });
      ledger.post(reacted.posting);
      const vented = ventGas({
        gasAccount: PLANT_BATTER_GAS,
        atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
        composition: reacted.co2,
      });
      ledger.post(vented);
    }

    const batterMassUg = accountElementalMass(ledger, PLANT_BATTER);
    if (batterMassUg <= 0n) return;

    const specificHeat = batterSpecificHeat(resolved);
    const flourNitrogenUg = elementMass(flourComposition, 'N');
    const gluten = glutenPrecursorFromNitrogen(flourNitrogenUg);

    const rpm = this.#mixerRig.machine.getTag('mix-speed-rpm');
    const specificWorkJPerKg = (rpm / 200) * 12_000; // 0..12 kJ/kg, spanning under- to well-mixed.
    const massKg = Number(batterMassUg) / 1_000_000_000;
    const mechanicalEnergy = roundHalfEven(specificWorkJPerKg * massKg * 1_000_000);

    if (mechanicalEnergy > 0n) {
      const mixed = mixBatter({
        mechanicalEnergyAccount: WORLD_ACCOUNTS.marketUtilities,
        thermalAccount: PLANT_BATTER,
        mechanicalEnergy,
        totalBatterMassUg: batterMassUg,
        specificHeatJPerKgK: specificHeat,
        glutenFormingMassUg: gluten.glutenFormingMassUg,
      });
      ledger.post(mixed.posting);
      this.#mixerRig.machine.setTag('gluten-development-fraction', mixed.developmentFraction);
      this.#mixerRig.machine.setTag('air-volume-fraction', mixed.airVolumeFraction);
    }
    this.#mixerRig.machine.setTag('batch-mass-kg', massKg);
  }

  #advanceOven(ledger: Ledger, profile: OvenProfile, tick: number, hazard: number, dtHours: number): void {
    const rig = this.#ovenRigs.find((r) => r.id === profile.id);
    if (!rig) return;
    const running = rig.machine.running;
    const setpoint = rig.machine.getTag('bake-temp-setpoint-c');
    let temp = rig.machine.getTag('bake-temp-c');
    const loadAccount = ovenLoadAccount(profile.id);

    if (running) {
      const loaded = moveElementalMassUpTo(ledger, PLANT_BATTER, loadAccount, profile.maxRateUgPerTick, `plant:${profile.id}:load`);
      if (loaded > 0n) {
        const moistureAdded = roundHalfEven(Number(loaded) * BATTER_MOISTURE_FRACTION);
        this.#ovenMoistureRemainingUg.set(profile.id, (this.#ovenMoistureRemainingUg.get(profile.id) ?? 0n) + moistureAdded);
      }

      const loadMassUg = accountElementalMass(ledger, loadAccount);
      if (loadMassUg > 0n) {
        const environment = profile.environment(setpoint);
        const fluxes = heatFluxes(environment, profile.geometry, temp);
        const energyJ = fluxes.totalW * dtHours * 3600;
        const moistureRemaining = this.#ovenMoistureRemainingUg.get(profile.id) ?? 0n;

        if (energyJ > 0) {
          const delivery = deliverHeat(profile.source, loadAccount, energyJ, `plant:${profile.id}:heat`);
          for (const posting of delivery.postings) ledger.post(posting);
          const thermal = stepThermal({
            currentTempC: temp,
            deliveredEnergyJ: Number(delivery.deliveredEnergy) / 1_000_000,
            massKg: Number(loadMassUg) / 1_000_000_000,
            specificHeatJPerKgK: PRODUCT_SPECIFIC_HEAT_J_PER_KG_K,
            moistureRemainingUg: moistureRemaining,
          });
          temp = thermal.nextTempC;
          if (thermal.evaporatedMassUg > 0n) {
            const moisture = postMoistureLoss(loadAccount, WORLD_ACCOUNTS.atmosphere, thermal.evaporatedMassUg, `plant:${profile.id}:moisture`);
            if (moisture) {
              ledger.post(moisture.posting);
              this.#ovenMoistureRemainingUg.set(profile.id, moistureRemaining - thermal.evaporatedMassUg);
            }
          }
        }

        const browning = rig.machine.getTag('crust-browning-fraction');
        rig.machine.setTag('crust-browning-fraction', stepBrowning(browning, temp, dtHours * 3600));

        if (temp >= setpoint - OVEN_BAKE_TOLERANCE_C) {
          const baked = moveElementalMassUpTo(ledger, loadAccount, PLANT_BAKED, loadMassUg, `plant:${profile.id}:release`);
          if (baked > 0n) this.#ovenMoistureRemainingUg.set(profile.id, 0n);
        }
      }
    } else {
      temp += (AMBIENT_TEMP_C - temp) * 0.02;
    }
    rig.machine.setTag('bake-temp-c', temp);

    const overTemp = temp > setpoint + 40;
    rig.advance(tick, dtHours, hazard, new Map([['over-temp', overTemp]]));
  }

  #advanceCooler(ledger: Ledger, tick: number, hazard: number, dtHours: number): void {
    const rig = this.#coolerRig;
    const running = rig.machine.running;
    let temp = rig.machine.getTag('product-temperature-c');

    if (running) {
      const loaded = moveElementalMassUpTo(ledger, PLANT_BAKED, PLANT_COOLER_LOAD, COOLER_MAX_RATE_UG_PER_TICK, 'plant:cooler:load');
      const loadMassUg = accountElementalMass(ledger, PLANT_COOLER_LOAD);
      if (loaded > 0n) {
        // A freshly loaded batch resets the tracked temperature to a
        // representative just-baked figure and re-seeds the moisture budget —
        // see `BAKED_RESIDUAL_MOISTURE_FRACTION`.
        temp = 95;
        this.#coolerMoistureRemainingUg += roundHalfEven(Number(loaded) * BAKED_RESIDUAL_MOISTURE_FRACTION);
        this.#coolerMoistureFractionAtIntake = BAKED_RESIDUAL_MOISTURE_FRACTION;
      }
      if (loadMassUg > 0n) {
        const massKg = Number(loadMassUg) / 1_000_000_000;
        const rate = coolingRateConstantPerS(15, PRODUCT_SURFACE_AREA_M2, massKg, PRODUCT_SPECIFIC_HEAT_J_PER_KG_K);
        temp = stepCooling(temp, AMBIENT_TEMP_C, rate, dtHours * 3600);

        const loss = stepStalingMoistureLoss({
          productAccount: PLANT_COOLER_LOAD,
          atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
          moistureRemainingUg: this.#coolerMoistureRemainingUg,
          surfaceAreaM2: PRODUCT_SURFACE_AREA_M2,
          dtSeconds: dtHours * 3600,
          packaged: false,
        });
        if (loss) {
          ledger.post(loss.posting);
          this.#coolerMoistureRemainingUg -= loss.evaporatedMassUg;
        }

        if (temp <= COOLER_TARGET_TEMP_C) {
          const remainingFraction = loadMassUg > 0n ? Number(this.#coolerMoistureRemainingUg) / Number(loadMassUg) : 0;
          this.#coolerMoistureFractionAtIntake = Math.max(0, remainingFraction);
          const cooled = moveElementalMassUpTo(ledger, PLANT_COOLER_LOAD, PLANT_COOLED, loadMassUg, 'plant:cooler:release');
          if (cooled > 0n) this.#coolerMoistureRemainingUg = 0n;
        }
      }
    }
    rig.machine.setTag('product-temperature-c', temp);
    rig.advance(tick, dtHours, hazard, new Map());
  }

  #advanceWrapper(ledger: Ledger, tick: number, hazard: number, dtHours: number): void {
    const rig = this.#wrapperRig;
    if (rig.machine.running) {
      const productAvailable = accountElementalMass(ledger, PLANT_COOLED);
      const filmAvailable = accountElementalMass(ledger, STAGE_FILM);
      let productShare = productAvailable < WRAPPER_MAX_RATE_UG_PER_TICK ? productAvailable : WRAPPER_MAX_RATE_UG_PER_TICK;

      if (productShare > 0n) {
        const filmNeeded = roundHalfEven(Number(productShare) * FILM_TO_PRODUCT_MASS_FRACTION);
        if (filmNeeded > filmAvailable) {
          // Do not wrap more product than the film on hand can actually
          // cover — scale the product share down to match, rather than
          // leaving a partly-wrapped batch.
          productShare = roundHalfEven(Number(filmAvailable) / FILM_TO_PRODUCT_MASS_FRACTION);
          if (productShare > productAvailable) productShare = productAvailable;
        }
        const filmShare = roundHalfEven(Number(productShare) * FILM_TO_PRODUCT_MASS_FRACTION);

        if (productShare > 0n && filmShare > 0n) {
          // Two independent balanced transfers into the same destination —
          // product and film each move from their own account, both credited
          // to `PLANT_WRAPPED`; nothing here invents the combination itself
          // as a third quantity.
          moveElementalMassUpTo(ledger, PLANT_COOLED, PLANT_WRAPPED, productShare, 'plant:wrapper:product');
          moveElementalMassUpTo(ledger, STAGE_FILM, PLANT_WRAPPED, filmShare, 'plant:wrapper:film');
        }
      }
    }
    rig.advance(tick, dtHours, hazard, new Map());
  }

  #advanceQaLab(ledger: Ledger, tick: number, hazard: number, dtHours: number): void {
    const rig = this.#qaRig;
    if (rig.machine.running) {
      const available = accountElementalMass(ledger, PLANT_WRAPPED);
      if (available >= QA_SAMPLE_MASS_UG) {
        moveElementalMassUpTo(ledger, PLANT_WRAPPED, QA_CONSUMED, QA_SAMPLE_MASS_UG, 'plant:qa:sample');
        const waterActivity = waterActivityFromMoisture(moistureContentDryBasis(this.#coolerMoistureFractionAtIntake));
        this.#lastQaWaterActivity = waterActivity;
        this.#qaPassed = waterActivity <= QA_MAX_WATER_ACTIVITY;
        rig.machine.setTag('water-activity', waterActivity);
      }
    }
    rig.advance(tick, dtHours, hazard, new Map([['spec-non-conformance', rig.machine.running && !this.#qaPassed]]));
  }

  #advanceSales(ledger: Ledger, tick: number, knobs: DifficultyKnobs): void {
    if (tick > 0 && tick % ORDER_INTERVAL_TICKS === 0) {
      const span = ORDER_MAX_MASS_UG - ORDER_MIN_MASS_UG;
      const draw = BigInt(this.#orderRng.nextUint32() % 1_000_000);
      const massUg = ORDER_MIN_MASS_UG + (span * draw) / 1_000_000n;
      this.#orders.push({ id: this.#nextOrderId, remainingMassUg: massUg });
      this.#nextOrderId += 1;
    }

    if (this.#qaPassed) {
      while (this.#orders.length > 0) {
        const order = this.#orders[0];
        if (!order) break;
        const available = accountElementalMass(ledger, PLANT_WRAPPED);
        if (available <= 0n) break;
        const shipMassUg = available < order.remainingMassUg ? available : order.remainingMassUg;
        if (shipMassUg <= 0n) break;

        const composition = peekComposition(ledger, PLANT_WRAPPED, shipMassUg);
        const entries: Entry[] = [];
        for (const [element, amount] of composition) {
          if (amount === 0n) continue;
          entries.push({ account: PLANT_WRAPPED, commodity: elementCommodity(element), delta: -amount });
          entries.push({ account: WORLD_ACCOUNTS.marketCustomers, commodity: elementCommodity(element), delta: amount });
        }
        const shippedMassUg = compositionMass(composition);
        if (shippedMassUg <= 0n) break;

        const priceMinorPerKg = salePriceMinorPerKg(knobs);
        const revenue = roundHalfEven((Number(shippedMassUg) / 1_000_000_000) * priceMinorPerKg);
        const cashCommodityId = cashCommodity('USD');
        if (revenue > 0n) {
          entries.push({ account: 'plant.cash', commodity: cashCommodityId, delta: revenue });
          entries.push({ account: WORLD_ACCOUNTS.marketCustomers, commodity: cashCommodityId, delta: -revenue });
        }
        ledger.post({ process: `market:ship:order-${order.id}`, entries });
        this.#shipments += 1;

        order.remainingMassUg -= shippedMassUg;
        if (order.remainingMassUg <= 0n) {
          this.#orders.shift();
          this.#ordersFulfilled += 1;
        }
      }
    }

    this.#officeRig.machine.setTag('orders-pending-count', this.#orders.length);
    this.#officeRig.machine.setTag('orders-fulfilled-count', this.#ordersFulfilled);
    this.#officeRig.machine.setTag('shipments-count', this.#shipments);
  }

  // -------------------------------------------------------------------
  // Digest contribution: every part of `Plant`'s own state that is not
  // already reachable by walking the ledger's own accounts (moisture budgets,
  // the last QA reading, the order queue) — see `world.ts`'s `digest()`.
  // -------------------------------------------------------------------

  digestParts(): {
    readonly ovenMoisture: readonly { readonly id: string; readonly moistureUg: string }[];
    readonly coolerMoistureUg: string;
    readonly lastQaWaterActivity: number;
    readonly qaPassed: boolean;
    readonly orders: readonly { readonly id: number; readonly remainingMassUg: string }[];
    readonly ordersFulfilled: number;
    readonly shipments: number;
  } {
    return {
      ovenMoisture: OVEN_PROFILES.map((p) => ({
        id: p.id,
        moistureUg: (this.#ovenMoistureRemainingUg.get(p.id) ?? 0n).toString(10),
      })),
      coolerMoistureUg: this.#coolerMoistureRemainingUg.toString(10),
      lastQaWaterActivity: this.#lastQaWaterActivity,
      qaPassed: this.#qaPassed,
      orders: this.#orders.map((o) => ({ id: o.id, remainingMassUg: o.remainingMassUg.toString(10) })),
      ordersFulfilled: this.#ordersFulfilled,
      shipments: this.#shipments,
    };
  }
}
