/**
 * Shared physics and mass-split helpers for `plant/equipment/*`.
 *
 * Every equipment file in this directory builds its balanced postings from
 * `unit.ts`'s `buildProcessPosting`/`splitByProfile` — see CLAUDE.md: "Reuse
 * plant/unit.ts's helper for any input-to-output transformation rather than
 * writing a second balance guarantee." This file only adds the pieces of real
 * physics that recur across many named machines (proportional portioning,
 * sensible heat, gas density and composition) so each machine file states
 * only what is different about that machine.
 */

import type { Composition, Element, Micrograms, Microjoules } from '../../core/commodity.js';
import {
  ELEMENTS,
  UG_PER_KG,
  UJ_PER_J,
  addComposition,
  emptyComposition,
  kilograms,
  partition,
  roundHalfEven,
} from '../../core/commodity.js';
import type { AccountId, Posting } from '../../core/ledger.js';
import { ProcessUnit, splitByProfile, type StreamProfile } from '../unit.js';

// ---------------------------------------------------------------------------
// Proportional portioning: splitting an exact composition into several
// streams that each keep the *same* elemental ratios as the input — a sheet
// of dough cut into pieces, or a batch divided into a product stream and its
// trim, is still the same substance, just less of it in each place.
// ---------------------------------------------------------------------------

/** Every tracked element given equal weight, so `splitByProfile` divides an
 * input purely by each stream's `targetShare`, preserving the input's own
 * elemental ratios in every output exactly (as opposed to `mill.ts`'s use of
 * `splitByProfile`, where each stream genuinely has a different profile). */
export const UNIFORM_PROFILE: Readonly<Partial<Record<Element, number>>> = Object.freeze(
  Object.fromEntries(ELEMENTS.map((element) => [element, 1])),
);

export interface MassShare {
  readonly id: string;
  readonly share: number;
}

/** Split `input` proportionally across `shares` by relative mass share,
 * preserving its own elemental ratios in every output stream exactly. The
 * shared technique behind every forming, cutting, dosing and portioning unit
 * in this directory. */
export function splitProportionally(input: Composition, shares: readonly MassShare[]): Composition[] {
  const streams: StreamProfile[] = shares.map((share) => ({
    id: share.id,
    elements: UNIFORM_PROFILE,
    targetShare: share.share,
  }));
  return splitByProfile(input, streams);
}

// ---------------------------------------------------------------------------
// Sensible heat: the same mass * specific-heat * deltaT relationship
// `creamery.ts`'s pasteurisation hold uses, generalised so any equipment
// module can cost a temperature change in real joules without duplicating
// the arithmetic.
// ---------------------------------------------------------------------------

/**
 * Magnitude of the sensible-heat energy to move `massUg` by `deltaTCelsius`
 * — always non-negative. Direction (energy drawn in to heat vs. energy
 * rejected to cool) is the caller's concern, exactly as `creamery.ts`'s own
 * `heatEnergy` treats the pasteurisation hold.
 */
export function sensibleHeatEnergy(
  massUg: Micrograms,
  specificHeatJPerKgK: number,
  deltaTCelsius: number,
): Microjoules {
  if (deltaTCelsius === 0) return 0n;
  const massKg = Number(massUg) / Number(UG_PER_KG);
  const joules = massKg * specificHeatJPerKgK * Math.abs(deltaTCelsius);
  return roundHalfEven(joules * Number(UJ_PER_J));
}

// ---------------------------------------------------------------------------
// Gas density and composition: real physical constants shared by the
// pressure-whisk aerator (mixing.ts), the modified-atmosphere flush and
// headspace purge (packaging.ts).
// ---------------------------------------------------------------------------

/**
 * Gas density at 20 C, 101,325 Pa (standard reference conditions), from the
 * ideal gas law rho = P*M / (R*T), R = 8.314462618 J/(mol K) (CODATA), with
 * IUPAC standard atomic weights for the molar mass. Real-gas deviation from
 * ideal for N2/O2/CO2/air near room temperature and pressure is well under
 * 1%, so the ideal-gas figure is used directly rather than a separately
 * sourced measured density table.
 */
const GAS_CONSTANT_J_PER_MOL_K = 8.314_462_618;
const STANDARD_TEMPERATURE_K = 293.15; // 20 C
const STANDARD_PRESSURE_PA = 101_325;

function idealGasDensityKgPerM3(molarMassKgPerMol: number): number {
  return (STANDARD_PRESSURE_PA * molarMassKgPerMol) / (GAS_CONSTANT_J_PER_MOL_K * STANDARD_TEMPERATURE_K);
}

/** IUPAC standard atomic weights, g/mol, to three decimal places — the same
 * figures `world/accounts.ts`'s `MOLAR_MASS` table uses, kept as an
 * independent local constant here so this file has no import-time dependency
 * on that module. */
const ATOMIC_WEIGHT_G_PER_MOL = { C: 12.011, N: 14.007, O: 15.999 } as const;

const NITROGEN_MOLAR_MASS_KG_PER_MOL = (2 * ATOMIC_WEIGHT_G_PER_MOL.N) / 1000;
const CARBON_DIOXIDE_MOLAR_MASS_KG_PER_MOL =
  (ATOMIC_WEIGHT_G_PER_MOL.C + 2 * ATOMIC_WEIGHT_G_PER_MOL.O) / 1000;
const DRY_AIR_MOLAR_MASS_KG_PER_MOL = 0.028_964_7; // standard reference dry-air molar mass

export const AIR_DENSITY_KG_PER_M3 = idealGasDensityKgPerM3(DRY_AIR_MOLAR_MASS_KG_PER_MOL);
export const NITROGEN_DENSITY_KG_PER_M3 = idealGasDensityKgPerM3(NITROGEN_MOLAR_MASS_KG_PER_MOL);
export const CARBON_DIOXIDE_DENSITY_KG_PER_M3 = idealGasDensityKgPerM3(CARBON_DIOXIDE_MOLAR_MASS_KG_PER_MOL);

function compositionFromMassShares(
  massUg: Micrograms,
  shares: Readonly<Partial<Record<Element, number>>>,
): Composition {
  const elements = (Object.keys(shares) as Element[]).filter((element) => (shares[element] ?? 0) > 0);
  const weights = elements.map((element) => BigInt(Math.round((shares[element] ?? 0) * 1_000_000)));
  const parts = partition(massUg, weights);
  const out = new Map<Element, Micrograms>();
  elements.forEach((element, index) => {
    const amount = parts[index] ?? 0n;
    if (amount !== 0n) out.set(element, amount);
  });
  return out;
}

/** Standard dry-air mass composition — N2 75.52%, O2 23.15%, Ar + trace gases
 * 1.28%, CO2 0.05% (standard reference composition, the same figures
 * `world/accounts.ts` seeds the atmosphere reservoir with). CO2's own small
 * mass share is folded into the inert `Ash` term here rather than split out
 * by its own molecule, since nothing in this directory needs process air's
 * incidental CO2 tracked apart from its other inert content. */
const AIR_ELEMENT_MASS_SHARE: Readonly<Partial<Record<Element, number>>> = Object.freeze({
  N: 0.7552,
  O: 0.2315,
  Ash: 0.0133, // Ar + trace gases + CO2's small mass share
});

/** Ordinary room/process air, as an elemental composition of exact mass
 * `massUg` — used wherever air moves as real, ledgered mass (incorporated
 * mixing air, a displaced package headspace) rather than as a background
 * reservoir concentration. */
export function airComposition(massUg: Micrograms): Composition {
  return compositionFromMassShares(massUg, AIR_ELEMENT_MASS_SHARE);
}

/**
 * A nitrogen/CO2 modified-atmosphere gas mix, `co2MassFraction` by mass (the
 * rest nitrogen) — real MAP blends for baked goods are commonly an N2/CO2
 * fill, CO2 suppressing mould growth and N2 providing inert bulk (food
 * packaging engineering reference figures; exact blends vary by product and
 * shelf-life target). The split is exact at both levels — CO2's own mass is
 * partitioned again into carbon and oxygen by real molar mass — so the
 * returned composition always sums back to `massUg` exactly.
 */
export function mapGasComposition(massUg: Micrograms, co2MassFraction: number): Composition {
  if (co2MassFraction < 0 || co2MassFraction > 1) {
    throw new RangeError(`co2MassFraction must be within [0, 1], got ${co2MassFraction}`);
  }
  const co2Weight = BigInt(Math.round(co2MassFraction * 1_000_000));
  const n2Weight = BigInt(Math.round((1 - co2MassFraction) * 1_000_000));
  const [co2Mass, n2Mass] = partition(massUg, [co2Weight, n2Weight]) as [Micrograms, Micrograms];

  const carbonWeight = BigInt(Math.round(ATOMIC_WEIGHT_G_PER_MOL.C * 1_000_000));
  const oxygenWeight = BigInt(Math.round(2 * ATOMIC_WEIGHT_G_PER_MOL.O * 1_000_000));
  const [carbonMass, oxygenMass] = partition(co2Mass, [carbonWeight, oxygenWeight]) as [
    Micrograms,
    Micrograms,
  ];

  const out = new Map<Element, Micrograms>();
  if (n2Mass !== 0n) out.set('N', n2Mass);
  if (carbonMass !== 0n) out.set('C', carbonMass);
  if (oxygenMass !== 0n) out.set('O', oxygenMass);
  return out;
}

/**
 * How much real air mass must be folded into a base of `baseMassUg` (at
 * `baseDensityKgPerM3`) to reach `airVolumeFraction` of the aerated output's
 * own volume. Air is roughly 800x less dense than a typical batter or cream,
 * so even a large air volume fraction is still a tiny mass addition — this is
 * real, not a modelling shortcut: whipped cream roughly doubles in volume
 * (approaching 50% air by volume) while gaining only a few percent in mass.
 */
export function airMassForVolumeFraction(
  baseMassUg: Micrograms,
  baseDensityKgPerM3: number,
  airVolumeFraction: number,
): Micrograms {
  if (airVolumeFraction < 0 || airVolumeFraction >= 1) {
    throw new RangeError(`airVolumeFraction must be within [0, 1), got ${airVolumeFraction}`);
  }
  if (airVolumeFraction === 0 || baseMassUg === 0n) return 0n;
  const baseMassKg = Number(baseMassUg) / Number(UG_PER_KG);
  const baseVolumeM3 = baseMassKg / baseDensityKgPerM3;
  const airVolumeM3 = (baseVolumeM3 * airVolumeFraction) / (1 - airVolumeFraction);
  const airMassKg = airVolumeM3 * AIR_DENSITY_KG_PER_M3;
  return kilograms(airMassKg);
}

// ---------------------------------------------------------------------------
// Wash-down: the CIP (clean-in-place) rinse every piece of product-contact
// equipment in this directory periodically needs between batches or
// products. Shared here rather than duplicated per machine file, since the
// balance shape is identical regardless of which machine is being rinsed.
// ---------------------------------------------------------------------------

export interface WashDownParams {
  /** Where the residue being rinsed off currently sits (typically the same
   * account the previous batch's product occupied). */
  readonly residueAccount: AccountId;
  /** The trace of previous product actually carried away by the rinse. */
  readonly residueComposition: Composition;
  readonly waterSupplyAccount: AccountId;
  readonly waterComposition: Composition;
  readonly wasteWaterAccount: AccountId;
  readonly process?: string;
}

export interface WashDownResult {
  readonly posting: Posting;
  readonly wasteWaterComposition: Composition;
}

/** Rinse a machine down: real wash water in from the main, real rinse water
 * and residue out to the drain — never a mass that simply stops being
 * tracked once it is "washed away". */
export function washDownEquipment(unit: ProcessUnit, params: WashDownParams): WashDownResult {
  const wasteWaterComposition = addComposition(
    addComposition(emptyComposition(), params.residueComposition),
    params.waterComposition,
  );

  const posting = unit.buildBatch({
    process: params.process ?? `${unit.machine.definition.type}:wash-down`,
    inputs: [
      { account: params.residueAccount, composition: params.residueComposition },
      { account: params.waterSupplyAccount, composition: params.waterComposition },
    ],
    outputs: [{ account: params.wasteWaterAccount, composition: wasteWaterComposition }],
  });

  return { posting, wasteWaterComposition };
}
