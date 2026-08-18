/**
 * Cited physical constants shared across `origin/`.
 *
 * `world/accounts.ts`'s `MOLAR_MASS` only carries C, H, N and O (the elements its
 * own genesis mixes need); `bake/constants.ts`'s `ATOMIC_WEIGHT` adds Na and K for
 * leavening salts. Neither carries P, S, Cl, Ca, Mg or Fe, which the mineral
 * chemistry in this directory (SAPP, MCP, gelatin's calcium, cocoa's potash-rich
 * ash, ...) needs. Rather than reach into either module — `origin/` does not own
 * `world/` or `bake/`, exactly the reasoning `bake/leavening.ts`'s own doc comment
 * gives for keeping its own small local table — this module carries a single,
 * complete table for every element `core/commodity.ts` tracks (`Ash` excepted: it
 * is a pseudo-element with no atomic weight of its own).
 *
 * Every value is the IUPAC standard atomic weight (g/mol), to three decimal
 * places, matching the figures already used throughout this codebase (see
 * `world/accounts.ts`, `bake/constants.ts`, and the `source` fields of
 * `packages/data/substances/sodium-bicarbonate.json` and `sucrose.json`).
 */

import type { Element } from '../core/commodity.js';
import { partition } from '../core/commodity.js';

export const ATOMIC_WEIGHT: Readonly<Record<Exclude<Element, 'Ash'>, number>> = {
  C: 12.011,
  H: 1.008,
  O: 15.999,
  N: 14.007,
  P: 30.974,
  K: 39.098,
  S: 32.06,
  Na: 22.990,
  Cl: 35.453,
  Ca: 40.078,
  Mg: 24.305,
  Fe: 55.845,
};

/** Fixed-point precision for turning a real molar-mass ratio into an integer
 * `partition()` weight — matches `world/accounts.ts`'s and `bake/leavening.ts`'s
 * own `WEIGHT_PRECISION` exactly, since all three only need the *ratio* between
 * elements, not absolute precision. */
export const WEIGHT_PRECISION = 1_000_000;

export interface AtomCount {
  readonly element: Exclude<Element, 'Ash'>;
  readonly atoms: number;
}

export function molarMass(formula: readonly AtomCount[]): number {
  return formula.reduce((sum, part) => sum + part.atoms * ATOMIC_WEIGHT[part.element], 0);
}

/** Glucose C6H12O6 molar mass, g/mol — matches `world/exchange.ts`'s and
 * `agri/crop.ts`'s own copies exactly (same IUPAC atomic weights). */
export const GLUCOSE_MOLAR_MASS = 6 * ATOMIC_WEIGHT.C + 12 * ATOMIC_WEIGHT.H + 6 * ATOMIC_WEIGHT.O;

/** Standard enthalpy of combustion, glucose: ~2,803 kJ/mol — matches
 * `world/exchange.ts`'s cited figure exactly. */
export const GLUCOSE_COMBUSTION_J_PER_MOL = 2_803_000;

export const GLUCOSE_C_MASS_FRACTION = (6 * ATOMIC_WEIGHT.C) / GLUCOSE_MOLAR_MASS;
export const GLUCOSE_H_MASS_FRACTION = (12 * ATOMIC_WEIGHT.H) / GLUCOSE_MOLAR_MASS;
/** Microjoules of stored chemical energy per microgram of glucose — the same
 * "J/g == uJ/ug" unit identity `world/exchange.ts`'s `reactionEnergy` documents. */
export const GLUCOSE_ENERGY_PER_UG = GLUCOSE_COMBUSTION_J_PER_MOL / GLUCOSE_MOLAR_MASS;

/**
 * Split a mass of a real molecular compound into its constituent elements, in
 * exact real molar-mass ratio, the whole input mass accounted for — the same
 * technique `world/accounts.ts`'s `splitMolecule` and `bake/leavening.ts`'s own
 * local copy use, generalised here to any element this table covers (needed for
 * mineral compounds like SAPP and MCP that carry P, Ca, and other elements
 * neither of those two tables tracks).
 */
export function splitMolecule(totalMass: bigint, formula: readonly AtomCount[]): Map<Element, bigint> {
  const weights = formula.map((part) => BigInt(Math.round(part.atoms * ATOMIC_WEIGHT[part.element] * WEIGHT_PRECISION)));
  const shares = partition(totalMass, weights);
  const out = new Map<Element, bigint>();
  formula.forEach((part, index) => {
    const share = shares[index] ?? 0n;
    out.set(part.element, (out.get(part.element) ?? 0n) + share);
  });
  return out;
}
