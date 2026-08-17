/**
 * Chemical and biological leavening, as actual stoichiometry.
 *
 * Every gram of CO2 that ever puffs up a crumb in this simulation is drawn, by
 * real molar mass, out of the reagents that produced it — never invented. This
 * module only *builds* balanced `Posting`s, exactly like `world/exchange.ts`; it
 * never touches a `Ledger` directly, so there is no path for it to slip gas into
 * a batter's gas phase outside a balanced entry set. See CONTRACT.md rule 1.
 *
 * Two real reactions are modelled:
 *
 * - **Chemical leavening**: sodium bicarbonate plus an acid. The representative
 *   acid used for the stoichiometry is acetic acid (the textbook baking-soda +
 *   vinegar reaction; buttermilk's lactic acid and cream of tartar's tartaric
 *   acid follow the same acid-plus-bicarbonate-yields-CO2-water-and-salt pattern
 *   with different, similarly-sized molar masses — acetic acid is used here as
 *   the single, cleanly-sourced representative, the same way `world/exchange.ts`
 *   uses methane as *the* combustible fuel rather than modelling every possible
 *   fuel gas).
 *
 *       NaHCO3 + CH3COOH -> CH3COONa + H2O + CO2
 *
 * - **Yeast fermentation**: the standard (Gay-Lussac) anaerobic fermentation
 *   equation, glucose to ethanol and carbon dioxide — distinct from the aerobic
 *   respiration in `world/exchange.ts`, which needs free O2 that a proving dough
 *   does not have available in any quantity.
 *
 *       C6H12O6 -> 2 C2H6O + 2 CO2
 *
 * `world/accounts.ts`'s `splitMolecule` only carries molar masses for C, H, N, O
 * — it has no reason to know about sodium. Sodium bicarbonate and sodium acetate
 * need Na, so this module carries its own small molar-mass table (`constants.ts`)
 * and its own copy of the same partition-by-real-ratio technique, rather than
 * reaching into `world/`, which this task does not own.
 */

import type { Composition, Element, Micrograms, Microjoules } from '../core/commodity.js';
import { ENERGY, elementCommodity, partition, roundHalfEven } from '../core/commodity.js';
import type { AccountId, Entry, Posting } from '../core/ledger.js';
import { ATOMIC_WEIGHT } from './constants.js';

type MolecularElement = 'H' | 'C' | 'N' | 'O' | 'Na' | 'K';

interface AtomCount {
  readonly element: MolecularElement;
  readonly atoms: number;
}

/** Fixed-point precision for turning a real molar-mass ratio into an integer
 * partition weight — matches `world/accounts.ts`'s `WEIGHT_PRECISION` exactly,
 * since both only need the *ratio* between elements, not absolute precision. */
const WEIGHT_PRECISION = 1_000_000;

function molarMass(formula: readonly AtomCount[]): number {
  return formula.reduce((sum, part) => sum + part.atoms * ATOMIC_WEIGHT[part.element], 0);
}

/** Split a mass of a molecular substance into its constituent elements, in exact
 * real molar-mass ratio, the whole input mass accounted for. See the identical
 * technique and rationale in `world/accounts.ts`'s `splitMolecule`. */
function splitMolecule(totalMass: bigint, formula: readonly AtomCount[]): Map<Element, bigint> {
  const weights = formula.map((part) =>
    BigInt(Math.round(part.atoms * ATOMIC_WEIGHT[part.element] * WEIGHT_PRECISION)),
  );
  const shares = partition(totalMass, weights);
  const out = new Map<Element, bigint>();
  formula.forEach((part, index) => {
    const share = shares[index] ?? 0n;
    out.set(part.element, (out.get(part.element) ?? 0n) + share);
  });
  return out;
}

function addInto(target: Map<Element, bigint>, source: ReadonlyMap<Element, bigint>): void {
  for (const [element, amount] of source) {
    target.set(element, (target.get(element) ?? 0n) + amount);
  }
}

function subtract(
  total: ReadonlyMap<Element, bigint>,
  minus: ReadonlyMap<Element, bigint>,
): Map<Element, bigint> {
  const out = new Map<Element, bigint>();
  for (const [element, amount] of total) {
    out.set(element, amount - (minus.get(element) ?? 0n));
  }
  return out;
}

function entriesFor(account: AccountId, byElement: ReadonlyMap<Element, bigint>, sign: 1 | -1): Entry[] {
  const out: Entry[] = [];
  const signBig = sign === 1 ? 1n : -1n;
  for (const [element, amount] of byElement) {
    if (amount === 0n) continue;
    out.push({ account, commodity: elementCommodity(element), delta: signBig * amount });
  }
  return out;
}

const SODIUM_BICARBONATE_FORMULA: readonly AtomCount[] = [
  { element: 'Na', atoms: 1 },
  { element: 'H', atoms: 1 },
  { element: 'C', atoms: 1 },
  { element: 'O', atoms: 3 },
];

const ACETIC_ACID_FORMULA: readonly AtomCount[] = [
  { element: 'C', atoms: 2 },
  { element: 'H', atoms: 4 },
  { element: 'O', atoms: 2 },
];

const CO2_FORMULA: readonly AtomCount[] = [
  { element: 'C', atoms: 1 },
  { element: 'O', atoms: 2 },
];

const GLUCOSE_FORMULA: readonly AtomCount[] = [
  { element: 'C', atoms: 6 },
  { element: 'H', atoms: 12 },
  { element: 'O', atoms: 6 },
];

const ETHANOL_FORMULA: readonly AtomCount[] = [
  { element: 'C', atoms: 2 },
  { element: 'H', atoms: 6 },
  { element: 'O', atoms: 1 },
];

const SODIUM_BICARBONATE_MOLAR_MASS = molarMass(SODIUM_BICARBONATE_FORMULA); // 84.006 g/mol
const ACETIC_ACID_MOLAR_MASS = molarMass(ACETIC_ACID_FORMULA); // 60.052 g/mol
const CO2_MOLAR_MASS = molarMass(CO2_FORMULA); // 44.009 g/mol
const GLUCOSE_MOLAR_MASS = molarMass(GLUCOSE_FORMULA); // 180.156 g/mol
/** 46.069 g/mol. Not used directly (ethanol's elements are derived by
 * subtraction — see `fermentGlucose`), exported so the exact molar mass behind
 * the mass-balance claim in this module's doc comment is checkable in tests. */
export const ETHANOL_MOLAR_MASS = molarMass(ETHANOL_FORMULA);

/**
 * Standard enthalpy of ethanolic fermentation, derived from standard enthalpies
 * of formation (kJ/mol): glucose(s) -1273.3, ethanol(l) -277.6 (x2), CO2(g)
 * -393.5 (x2). ΔH = [2(-277.6) + 2(-393.5)] - (-1273.3) = -68.9 kJ/mol —
 * exothermic, which is the real, well-documented reason a bulk-fermenting dough
 * warms gently on its own during proof.
 */
const FERMENTATION_ENTHALPY_J_PER_MOL = -68_900;

function reactionEnergy(mass: Micrograms, enthalpyJPerMol: number, forMolarMass: number): Microjoules {
  // A joule per gram is numerically identical to a microjoule per microgram
  // (both scale factors are 1,000,000) — see the identical note in
  // `world/exchange.ts`'s own `reactionEnergy`.
  return roundHalfEven(Number(mass) * (enthalpyJPerMol / forMolarMass));
}

export interface ChemicalLeaveningParams {
  /** Account holding the sodium bicarbonate's elemental mass. */
  readonly bakingSodaAccount: AccountId;
  /** Account holding the leavening acid's elemental mass (e.g. buttermilk or
   * vinegar's acid content, tracked as acetic-acid-equivalent mass — see the
   * module doc comment for why acetic acid is the representative acid). */
  readonly acidAccount: AccountId;
  /** The batter's trapped-gas phase: where the CO2 produced is credited. */
  readonly gasAccount: AccountId;
  /** Where the reaction's non-gas products (water and the neutral salt) are
   * credited — ordinarily the batter's own liquid/dissolved-solids account. */
  readonly byproductAccount: AccountId;
  readonly bakingSodaMass: Micrograms;
  readonly acidMass: Micrograms;
  readonly process?: string;
}

export interface ChemicalLeaveningResult {
  readonly posting: Posting;
  /** Elemental composition of the CO2 actually produced — the exact mass this
   * reaction added to the batter's gas phase. */
  readonly co2: Composition;
  /** Mass of baking soda and acid actually consumed (the limiting reagent is
   * consumed in full; the other's excess is left unreacted in its account). */
  readonly bakingSodaConsumed: Micrograms;
  readonly acidConsumed: Micrograms;
}

/**
 * NaHCO3 + CH3COOH -> CH3COONa + H2O + CO2, 1:1 molar.
 *
 * Whichever reagent is scarcer (in moles) is the limiting reagent and is
 * consumed exactly — its full input mass moves, no rounding needed. The other
 * reagent's consumed mass is computed from the reaction's real molar ratio and
 * rounded exactly once. CO2's mass is likewise computed from real molar mass and
 * rounded exactly once; the water-and-salt byproduct mass is then derived by
 * subtracting CO2's elements from the total consumed elements, so it needs no
 * rounding of its own and conservation is exact by construction, the same
 * technique `world/exchange.ts`'s `respire` uses for its by-difference oxygen.
 */
export function reactBakingSoda(params: ChemicalLeaveningParams): ChemicalLeaveningResult {
  const molesSoda = Number(params.bakingSodaMass) / SODIUM_BICARBONATE_MOLAR_MASS;
  const molesAcid = Number(params.acidMass) / ACETIC_ACID_MOLAR_MASS;
  const sodaLimiting = molesSoda <= molesAcid;
  const reactedMoles = Math.min(molesSoda, molesAcid);

  const bakingSodaConsumed = sodaLimiting
    ? params.bakingSodaMass
    : roundHalfEven(reactedMoles * SODIUM_BICARBONATE_MOLAR_MASS);
  const acidConsumed = sodaLimiting
    ? roundHalfEven(reactedMoles * ACETIC_ACID_MOLAR_MASS)
    : params.acidMass;

  const sodaElements = splitMolecule(bakingSodaConsumed, SODIUM_BICARBONATE_FORMULA);
  const acidElements = splitMolecule(acidConsumed, ACETIC_ACID_FORMULA);

  const totalConsumed = new Map<Element, bigint>();
  addInto(totalConsumed, sodaElements);
  addInto(totalConsumed, acidElements);

  const co2Mass = roundHalfEven(reactedMoles * CO2_MOLAR_MASS);
  const co2Elements = splitMolecule(co2Mass, CO2_FORMULA);
  const byproductElements = subtract(totalConsumed, co2Elements);

  const entries: Entry[] = [
    ...entriesFor(params.bakingSodaAccount, sodaElements, -1),
    ...entriesFor(params.acidAccount, acidElements, -1),
    ...entriesFor(params.gasAccount, co2Elements, 1),
    ...entriesFor(params.byproductAccount, byproductElements, 1),
  ];

  return {
    posting: { process: params.process ?? 'leavening:baking-soda', entries },
    co2: co2Elements,
    bakingSodaConsumed,
    acidConsumed,
  };
}

export interface FermentationParams {
  /** Account holding the fermentable sugar's elemental mass and, per the
   * convention `world/exchange.ts` uses for `respire`, its stored chemical
   * potential energy (`energy:uJ`) — the reaction draws real heat from it, it
   * does not invent any. */
  readonly sugarAccount: AccountId;
  readonly gasAccount: AccountId;
  /** Where the ethanol byproduct is credited — the batter's liquid phase; it
   * partly bakes off later (see `ventGas`) and partly remains in the crumb. */
  readonly ethanolAccount: AccountId;
  /** Where the reaction's released metabolic heat is credited. */
  readonly heatAccount: AccountId;
  readonly glucoseMass: Micrograms;
  readonly process?: string;
}

export interface FermentationResult {
  readonly posting: Posting;
  readonly co2: Composition;
  readonly ethanol: Composition;
}

/**
 * C6H12O6 -> 2 C2H6O + 2 CO2. Ethanol's elements are computed by subtracting
 * CO2's elements from glucose's own — glucose (180.156 g/mol) and 2 ethanol +
 * 2 CO2 (2 x 46.069 + 2 x 44.009 = 180.156 g/mol) agree to three decimal places
 * of real IUPAC atomic weight, so no residual mass is invented or lost.
 */
export function fermentGlucose(params: FermentationParams): FermentationResult {
  const glucoseElements = splitMolecule(params.glucoseMass, GLUCOSE_FORMULA);

  const co2MassFraction = (2 * CO2_MOLAR_MASS) / GLUCOSE_MOLAR_MASS;
  const co2Mass = roundHalfEven(Number(params.glucoseMass) * co2MassFraction);
  const co2Elements = splitMolecule(co2Mass, CO2_FORMULA);
  const ethanolElements = subtract(glucoseElements, co2Elements);

  // `reactionEnergy` follows the thermodynamic sign convention: a negative
  // `FERMENTATION_ENTHALPY_J_PER_MOL` (exothermic) yields a negative
  // `energyChange` here, meaning the glucose's own stored chemical potential
  // decreases by exactly that (negative) amount. The heat account is credited
  // the positive magnitude of the same quantity — energy moved, not invented.
  const energyChange = reactionEnergy(
    params.glucoseMass,
    FERMENTATION_ENTHALPY_J_PER_MOL,
    GLUCOSE_MOLAR_MASS,
  );

  const entries: Entry[] = [
    ...entriesFor(params.sugarAccount, glucoseElements, -1),
    ...entriesFor(params.gasAccount, co2Elements, 1),
    ...entriesFor(params.ethanolAccount, ethanolElements, 1),
    { account: params.sugarAccount, commodity: ENERGY, delta: energyChange },
    { account: params.heatAccount, commodity: ENERGY, delta: -energyChange },
  ];

  return {
    posting: { process: params.process ?? 'leavening:fermentation', entries },
    co2: co2Elements,
    ethanol: ethanolElements,
  };
}

export interface VentGasParams {
  readonly gasAccount: AccountId;
  readonly atmosphereAccount: AccountId;
  /** The elemental composition to vent — a fraction of the trapped CO2 (and,
   * for a fermented batter, ethanol vapour) mass, computed by the caller. */
  readonly composition: Composition;
  readonly process?: string;
}

/**
 * Move trapped batter gas (CO2, and any ethanol vapour that boils off during
 * baking — the real, well-documented "alcohol bakes off" effect) out to the
 * atmosphere. A pure element-by-element transfer: nothing is produced or
 * consumed, so it balances by construction for any composition.
 */
export function ventGas(params: VentGasParams): Posting {
  const entries: Entry[] = [
    ...entriesFor(params.gasAccount, params.composition, -1),
    ...entriesFor(params.atmosphereAccount, params.composition, 1),
  ];
  return { process: params.process ?? 'leavening:vent-gas', entries };
}
