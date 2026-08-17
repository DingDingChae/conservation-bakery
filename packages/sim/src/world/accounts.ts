/**
 * The planetary layer.
 *
 * CONTRACT.md is explicit: "the world has no outside." The oxygen a burner consumes
 * does not appear from nothing, it is drawn down from a finite `atmosphere` account;
 * the water that evaporates off a proving dough does not vanish, it is credited back
 * to the same account. This module opens those accounts on a `Ledger` and gives them
 * a one-time, exactly-accounted starting balance drawn from `GENESIS` — the only
 * account allowed to go arbitrarily negative, and only before `seal()`.
 *
 * Every quantity below is picked to be the right *order of magnitude* for a real
 * physical reservoir (an atmospheric column really does mass ~10 tonnes per square
 * metre; topsoil really is on the order of a few percent organic carbon by mass), not
 * a literal survey of one place on Earth. The point is not geochemical precision, it
 * is that a finite, sourced number stands in every account instead of an assumption
 * that the sky, the ground and the sun are bottomless.
 */

import type { Element } from '../core/commodity.js';
import { elementCommodity, joules, kilograms, ENERGY, partition } from '../core/commodity.js';
import type { AccountId, AccountKind, Ledger } from '../core/ledger.js';
import { GENESIS } from '../core/ledger.js';

/** The fixed, always-open world accounts. `soil.*` accounts are opened per field. */
export const WORLD_ACCOUNTS = {
  atmosphere: 'atmosphere',
  groundwater: 'groundwater',
  surfaceWater: 'surface-water',
  sun: 'sun',
  space: 'space',
  marketSuppliers: 'market.suppliers',
  marketCustomers: 'market.customers',
  marketUtilities: 'market.utilities',
} as const satisfies Record<string, AccountId>;

/** The account a named field's soil lives in. One field, one finite account. */
export function soilAccount(field: string): AccountId {
  return `soil.${field}`;
}

/** Standard atmospheric pressure, expressed as the mass of air above one square
 * metre at sea level: 101,325 Pa / 9.80665 m/s^2. This is the real physical basis
 * for "how much air is in a column of sky", not an arbitrary constant. */
const ATMOSPHERIC_COLUMN_KG_PER_M2 = 10_332n;

/** Bulk density and effective depth of tilled topsoil: ~1,300 kg/m^3 over ~0.15 m. */
const TOPSOIL_KG_PER_M2 = 195n;

/** Bulk density of fresh water. */
const WATER_KG_PER_M3 = 1_000n;

/**
 * The footprint the simulated site draws its air and sunlight from. Large enough that
 * no plausible amount of baking perceptibly depletes it, small enough that the
 * numbers describe a site and its surrounding land rather than the whole planet.
 */
const SITE_AREA_M2 = 2_000_000n; // 2 km^2

/** A representative year-round average insolation at temperate latitudes, after
 * atmospheric losses and the day/night and seasonal cycle are averaged out. Full
 * noon sun is closer to 1,000 W/m^2; this is the honest average, not the peak. */
const AVERAGE_INSOLATION_W_PER_M2 = 200n;

/** How many years of sunlight the `sun` account is seeded with. It is still a
 * finite stock — a world that ran far longer than this would need to re-seed it,
 * exactly as a real ledger would need a new financial year. */
const SUN_BUDGET_YEARS_SECONDS = 10n * 365n * 86_400n;

/**
 * Molar masses, g/mol, IUPAC standard atomic weights (to three decimal places),
 * for the elements that appear in the molecules this module seeds by formula.
 * `combustMethane`, `respire` and friends in `exchange.ts` share this table so that
 * genesis composition and reaction stoichiometry agree with each other.
 */
export const MOLAR_MASS: Readonly<Record<'C' | 'H' | 'N' | 'O', number>> = {
  H: 1.008,
  C: 12.011,
  N: 14.007,
  O: 15.999,
};

/** Fixed-point precision used to turn a real molar mass into an integer partition
 * weight. `partition` only needs weights that are in the right *ratio*; six digits
 * of the underlying real number is far more precision than the ratio needs. */
const WEIGHT_PRECISION = 1_000_000;

interface AtomCount {
  readonly element: 'C' | 'H' | 'N' | 'O';
  readonly atoms: number;
}

/**
 * Split a mass of a molecular substance into its constituent elements, in exactly
 * the mass ratio real molar masses imply, with the whole input mass accounted for.
 *
 * This is the one place float molar-mass arithmetic touches the exact ledger: the
 * *ratio* between elements is computed in floating point, `partition` then assigns
 * every microgram of `totalMass` to a part using that ratio as weights, so the
 * output always sums to exactly `totalMass` regardless of how unevenly the
 * stoichiometry divides.
 */
export function splitMolecule(
  totalMass: bigint,
  formula: readonly AtomCount[],
): Map<Element, bigint> {
  const weights = formula.map((part) =>
    BigInt(Math.round(part.atoms * MOLAR_MASS[part.element] * WEIGHT_PRECISION)),
  );
  const shares = partition(totalMass, weights);
  const out = new Map<Element, bigint>();
  formula.forEach((part, index) => {
    const share = shares[index] ?? 0n;
    out.set(part.element, (out.get(part.element) ?? 0n) + share);
  });
  return out;
}

/** Split a total mass across named shares by relative weight, without any molar-mass
 * meaning attached — used for genesis mixes like "air is mostly N2, some O2, a
 * little Ar, a trace of CO2, a little water vapour". */
function splitByShare<K extends string>(
  totalMass: bigint,
  shares: Readonly<Record<K, number>>,
): Record<K, bigint> {
  const keys = Object.keys(shares) as K[];
  const weights = keys.map((key) => BigInt(Math.round((shares[key] as number) * WEIGHT_PRECISION)));
  const parts = partition(totalMass, weights);
  const out = {} as Record<K, bigint>;
  keys.forEach((key, index) => {
    out[key] = parts[index] ?? 0n;
  });
  return out;
}

function openReservoir(ledger: Ledger, id: AccountId, label: string): void {
  openAccount(ledger, id, 'reservoir', label);
}

function openExternal(ledger: Ledger, id: AccountId, label: string): void {
  openAccount(ledger, id, 'external', label);
}

function openAccount(ledger: Ledger, id: AccountId, kind: AccountKind, label: string): void {
  if (ledger.hasAccount(id)) return;
  ledger.openAccount({ id, kind, label });
}

/** Post a genesis draw: every credited (account, commodity) is matched by an equal
 * and opposite debit from `GENESIS`, in the same posting, so it balances by
 * construction rather than by coincidence. */
function seedFrom(
  ledger: Ledger,
  process: string,
  credits: ReadonlyMap<AccountId, ReadonlyMap<string, bigint>>,
): void {
  const entries: { account: AccountId; commodity: `el:${Element}` | 'energy:uJ'; delta: bigint }[] = [];
  for (const [account, byCommodity] of credits) {
    for (const [commodity, amount] of byCommodity) {
      if (amount === 0n) continue;
      entries.push({ account, commodity: commodity as `el:${Element}` | 'energy:uJ', delta: amount });
      entries.push({ account: GENESIS, commodity: commodity as `el:${Element}` | 'energy:uJ', delta: -amount });
    }
  }
  if (entries.length === 0) return;
  ledger.post({ process, entries });
}

function elementCredits(byElement: ReadonlyMap<Element, bigint>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const [element, amount] of byElement) out.set(elementCommodity(element), amount);
  return out;
}

export interface SeedWorldOptions {
  /** Names of the soil fields to open and seed. Defaults to two working fields. */
  readonly fields?: readonly string[];
  /** Area of each soil field, in square metres. Defaults to 100,000 m^2 (10 ha). */
  readonly fieldAreaM2?: bigint;
}

const DEFAULT_FIELDS: readonly string[] = ['wheat-field', 'orchard'];
const DEFAULT_FIELD_AREA_M2 = 100_000n; // 10 hectares

/**
 * Open every standard world account, give each a realistic finite starting
 * quantity drawn from `GENESIS`, and seal the ledger so that starting quantity is
 * the only material this world will ever have. Everything afterward is a transfer.
 */
export function seedWorld(ledger: Ledger, options: SeedWorldOptions = {}): void {
  const fields = options.fields ?? DEFAULT_FIELDS;
  const fieldAreaM2 = options.fieldAreaM2 ?? DEFAULT_FIELD_AREA_M2;

  openReservoir(ledger, WORLD_ACCOUNTS.atmosphere, 'the air over the site');
  openReservoir(ledger, WORLD_ACCOUNTS.groundwater, 'the aquifer beneath the site');
  openReservoir(ledger, WORLD_ACCOUNTS.surfaceWater, 'the pond and streams serving the site');
  openReservoir(ledger, WORLD_ACCOUNTS.sun, "this world's sunlight budget");
  openExternal(ledger, WORLD_ACCOUNTS.space, 'the radiative sink beyond the sky');
  openExternal(ledger, WORLD_ACCOUNTS.marketSuppliers, 'everyone the bakery buys from');
  openExternal(ledger, WORLD_ACCOUNTS.marketCustomers, 'everyone the bakery sells to');
  openExternal(ledger, WORLD_ACCOUNTS.marketUtilities, 'the grid, the water main, the gas main');
  for (const field of fields) {
    openReservoir(ledger, soilAccount(field), `the soil of ${field}`);
  }

  seedAtmosphere(ledger);
  seedWaterBody(ledger, WORLD_ACCOUNTS.groundwater, 'genesis:groundwater', 50_000_000n);
  seedWaterBody(ledger, WORLD_ACCOUNTS.surfaceWater, 'genesis:surface-water', 500_000n);
  for (const field of fields) {
    seedSoil(ledger, soilAccount(field), fieldAreaM2);
  }
  seedSun(ledger);

  ledger.seal();
}

/** Dry air is ~75.52% N2, ~23.15% O2, ~1.28% Ar and trace gases, ~0.05% CO2 by
 * mass (standard reference composition). A further ~1% is added as water vapour, a
 * representative moist-air figure, which dilutes the dry fractions exactly as real
 * humidity does. */
function seedAtmosphere(ledger: Ledger): void {
  const totalMassKg = SITE_AREA_M2 * ATMOSPHERIC_COLUMN_KG_PER_M2;
  const totalMass = kilograms(totalMassKg);

  const shares = splitByShare(totalMass, {
    n2: 7552,
    o2: 2315,
    argonAndTrace: 128,
    co2: 5,
    h2o: 100,
  });

  const byElement = new Map<Element, bigint>();
  const add = (element: Element, amount: bigint) =>
    byElement.set(element, (byElement.get(element) ?? 0n) + amount);

  add('N', shares.n2); // N2 is homonuclear: its whole mass is elemental nitrogen.
  add('O', shares.o2); // likewise O2.
  add('Ash', shares.argonAndTrace); // Ar and other untracked trace gases.

  for (const [element, amount] of splitMolecule(shares.co2, [
    { element: 'C', atoms: 1 },
    { element: 'O', atoms: 2 },
  ])) {
    add(element, amount);
  }
  for (const [element, amount] of splitMolecule(shares.h2o, [
    { element: 'H', atoms: 2 },
    { element: 'O', atoms: 1 },
  ])) {
    add(element, amount);
  }

  const credits = new Map([[WORLD_ACCOUNTS.atmosphere, elementCredits(byElement)]]);
  seedFrom(ledger, 'genesis:atmosphere', credits);
}

function seedWaterBody(
  ledger: Ledger,
  account: AccountId,
  process: string,
  volumeM3: bigint,
): void {
  const totalMass = kilograms(volumeM3 * WATER_KG_PER_M3);
  const byElement = splitMolecule(totalMass, [
    { element: 'H', atoms: 2 },
    { element: 'O', atoms: 1 },
  ]);
  seedFrom(ledger, process, new Map([[account, elementCredits(byElement)]]));
}

/**
 * Illustrative, order-of-magnitude topsoil composition: oxygen-dominated mineral
 * mass (the rest of the silicate/oxide matrix this model does not track falls to
 * `Ash`, per commodity.ts), a few percent organic carbon, and the usual trace
 * macronutrients. This is not a soil-science instrument; it exists so a field is a
 * finite, sourced account rather than an assumption.
 */
function seedSoil(ledger: Ledger, account: AccountId, areaM2: bigint): void {
  const totalMass = kilograms(areaM2 * TOPSOIL_KG_PER_M2);

  const shares = splitByShare(totalMass, {
    o: 4900,
    ash: 3316,
    fe: 350,
    ca: 250,
    mg: 150,
    k: 150,
    na: 100,
    s: 20,
    c: 300,
    n: 20,
    p: 5,
    h: 439, // bound moisture and organic-matter hydrogen
  });

  const byElement = new Map<Element, bigint>([
    ['O', shares.o],
    ['Ash', shares.ash],
    ['Fe', shares.fe],
    ['Ca', shares.ca],
    ['Mg', shares.mg],
    ['K', shares.k],
    ['Na', shares.na],
    ['S', shares.s],
    ['C', shares.c],
    ['N', shares.n],
    ['P', shares.p],
    ['H', shares.h],
  ]);

  seedFrom(ledger, `genesis:soil:${account}`, new Map([[account, elementCredits(byElement)]]));
}

/** The sun is seeded with a finite multi-year energy budget, not an unbounded tap:
 * average insolation over the site's footprint, over a fixed number of years. */
function seedSun(ledger: Ledger): void {
  const wattsOverSite = AVERAGE_INSOLATION_W_PER_M2 * SITE_AREA_M2;
  const totalEnergy = joules(wattsOverSite * SUN_BUDGET_YEARS_SECONDS);
  seedFrom(ledger, 'genesis:sun', new Map([[WORLD_ACCOUNTS.sun, new Map([[ENERGY, totalEnergy]])]]));
}
