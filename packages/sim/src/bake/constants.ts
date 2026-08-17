/**
 * Cited physical constants shared across the `bake` module.
 *
 * Every figure here is a real, sourced physical quantity — a molar mass, a specific
 * heat, a latent heat, a rate constant order-of-magnitude from food-science or
 * baking-science literature. None of it is tuned to make a test pass; the tests
 * check that the *model* built from these numbers behaves the way real baking does.
 */

/** IUPAC standard atomic weights (g/mol), to three decimal places, for the
 * elements `bake/` needs beyond the C/H/N/O table already in `world/accounts.ts`.
 * Na and K appear in leavening salts; the rest mirror `world/accounts.ts` exactly
 * so a reaction spanning both modules agrees on molar mass. */
export const ATOMIC_WEIGHT: Readonly<Record<'H' | 'C' | 'N' | 'O' | 'Na' | 'K', number>> = {
  H: 1.008,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  Na: 22.990,
  K: 39.098,
};

/** Universal gas constant, J/(mol K). Exact by SI definition since the 2019
 * redefinition. */
export const GAS_CONSTANT_J_PER_MOL_K = 8.314462618;

/** Stefan-Boltzmann constant, W/(m^2 K^4). Exact by SI definition. */
export const STEFAN_BOLTZMANN_W_PER_M2_K4 = 5.670374419e-8;

/** Absolute zero offset, for converting a Celsius temperature to Kelvin. */
export const CELSIUS_TO_KELVIN = 273.15;

export function celsiusToKelvin(celsius: number): number {
  return celsius + CELSIUS_TO_KELVIN;
}

/**
 * Specific heat capacities, J/(kg K), at typical bakery temperatures. Figures are
 * standard food-engineering handbook values (e.g. Singh & Heldman, "Introduction to
 * Food Engineering"; ASHRAE Handbook — Refrigeration, ch. "Thermal Properties of
 * Foods"), rounded to a representative figure per ingredient class:
 *
 *  - water (liquid):        4,186  (defining value for the calorie/kcal)
 *  - wheat starch/flour:    1,800  (dry wheat flour, ~1.7-1.9 kJ/kg K)
 *  - sucrose (dry sugar):   1,244  (crystalline sucrose)
 *  - butterfat / shortening:2,050  (anhydrous milkfat, ~2.0-2.1 kJ/kg K)
 *  - whole egg:             3,180  (mostly water, USDA/ASHRAE composite figure)
 *  - water vapour (steam):  1,996  (at ~100 C, constant pressure)
 *  - crumb (baked, ~40% moisture): 2,800 (interpolated water/starch mixture)
 */
export const SPECIFIC_HEAT_J_PER_KG_K = {
  water: 4_186,
  flour: 1_800,
  sugar: 1_244,
  fat: 2_050,
  egg: 3_180,
  salt: 880, // dry NaCl, handbook value
  leavening: 1_000, // dry mineral leavening salts, order-of-magnitude with salt
  steam: 1_996,
  crumb: 2_800,
  air: 1_006, // dry air at typical oven temperatures, constant pressure
} as const;

/** Latent heat of vaporisation of water at ~100 C, J/kg. Standard steam-table
 * value (IAPWS-IF97 gives 2,256.5 kJ/kg at 100 C, 1 atm). */
export const LATENT_HEAT_VAPORISATION_J_PER_KG = 2_256_500;

/**
 * Wheat nitrogen-to-protein conversion factor (the "Jones factor" for cereals),
 * 5.7 — the standard conversion used by USDA and cereal chemists because wheat
 * gluten proteins average a lower nitrogen content (~17.5%) than the generic 6.25
 * factor assumes. This lets `bake/batter.ts` derive real protein mass directly
 * from the flour's own nitrogen content in the ledger, rather than a separately
 * declared "protein %" that could drift out of step with the elemental data.
 *
 * Source: Jones, D.B. (1931), USDA Circular No. 183; still the reference factor
 * used for wheat and wheat flour protein labelling today.
 */
export const WHEAT_NITROGEN_TO_PROTEIN_FACTOR = 5.7;

/**
 * Fraction of wheat flour protein that is gluten-forming (gliadin + glutenin),
 * as opposed to the water-soluble albumins/globulins that do not form a gluten
 * network. Cereal-chemistry literature (Osborne fractionation of wheat protein)
 * puts gliadin+glutenin at roughly 80-85% of total wheat flour protein; 0.80 is
 * used here as the representative, slightly conservative figure.
 */
export const GLUTEN_FORMING_PROTEIN_FRACTION = 0.8;

/** Standard atmospheric pressure, Pa — used for the ideal-gas-law volume of
 * trapped CO2 (oven spring). Exact SI reference value (101,325 Pa = 1 atm). */
export const ATMOSPHERIC_PRESSURE_PA = 101_325;

/** Boiling point of water at standard atmospheric pressure, C. Baked-goods
 * crumb and a moist crust surface are both real-world pinned close to this
 * temperature for as long as they still hold free moisture — the physical
 * basis for `transform.ts`'s constant-rate evaporation model. */
export const BOILING_POINT_C = 100;

/**
 * Approximate whole-egg water mass fraction, used only as a documented, literature
 * heuristic when a formulation wants an "effective hydration" figure that credits
 * egg's own water toward total batter liquid. Matches the source proximate
 * composition already cited in `packages/data/substances/hen-egg-whole.json`
 * (761.5 g water per kg whole egg).
 */
export const EGG_WATER_MASS_FRACTION = 0.7615;
