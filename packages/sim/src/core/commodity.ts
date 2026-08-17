/**
 * Conserved commodities.
 *
 * Everything this world can gain or lose is one of these, and every one of them is
 * stored as an exact `bigint`. Floating point may be used to *compute* a physical
 * result; it is never used to *store* a conserved quantity. See CONTRACT.md, rule 1.
 */

/**
 * The chemical elements this simulation tracks individually.
 *
 * This is deliberately not the whole periodic table. It is the set that actually
 * moves through a bakery and the land that feeds it: the organic backbone, the
 * plant macronutrients, and the minerals that appear in salt, leavening, dairy and
 * fortified flour. Anything else in a real substance is carried by the catch-all
 * `Ash` pseudo-element so that mass still closes exactly rather than being dropped.
 */
export const ELEMENTS = [
  'C',
  'H',
  'O',
  'N',
  'P',
  'K',
  'S',
  'Na',
  'Cl',
  'Ca',
  'Mg',
  'Fe',
  'Ash',
] as const;

export type Element = (typeof ELEMENTS)[number];

const ELEMENT_SET: ReadonlySet<string> = new Set(ELEMENTS);

export function isElement(value: string): value is Element {
  return ELEMENT_SET.has(value);
}

/**
 * Commodity identifiers.
 *
 * - `el:<Element>` — mass of one element, in **integer micrograms**.
 * - `energy:uJ`    — energy, in **integer microjoules**.
 * - `cash:<CODE>`  — money, in **integer minor units** (pence, cents).
 *
 * There is no commodity for "flour" or "a cake". A parcel of flour *is* its
 * elemental composition plus a label; the label carries no conserved quantity and
 * therefore cannot be created or destroyed by accident.
 */
export type ElementCommodity = `el:${Element}`;
export type EnergyCommodity = 'energy:uJ';
export type CashCommodity = `cash:${string}`;
export type CommodityId = ElementCommodity | EnergyCommodity | CashCommodity;

export const ENERGY: EnergyCommodity = 'energy:uJ';

export function elementCommodity(element: Element): ElementCommodity {
  return `el:${element}`;
}

export function cashCommodity(currency: string): CashCommodity {
  return `cash:${currency}`;
}

export const ELEMENT_COMMODITIES: readonly ElementCommodity[] =
  ELEMENTS.map(elementCommodity);

/** Micrograms. Always an exact integer. */
export type Micrograms = bigint;
/** Microjoules. Always an exact integer. */
export type Microjoules = bigint;

export const UG_PER_MG = 1_000n;
export const UG_PER_G = 1_000_000n;
export const UG_PER_KG = 1_000_000_000n;
export const UG_PER_TONNE = 1_000_000_000_000n;

export const UJ_PER_J = 1_000_000n;
export const UJ_PER_KJ = 1_000_000_000n;
export const UJ_PER_MJ = 1_000_000_000_000n;

export function grams(value: number | bigint): Micrograms {
  return scale(value, UG_PER_G);
}

export function kilograms(value: number | bigint): Micrograms {
  return scale(value, UG_PER_KG);
}

export function tonnes(value: number | bigint): Micrograms {
  return scale(value, UG_PER_TONNE);
}

export function joules(value: number | bigint): Microjoules {
  return scale(value, UJ_PER_J);
}

export function megajoules(value: number | bigint): Microjoules {
  return scale(value, UJ_PER_MJ);
}

/**
 * Convert a human-scale quantity into exact base units.
 *
 * A `number` input is rounded half-to-even at the base unit, once, here — the single
 * sanctioned boundary between real arithmetic and the exact ledger. Once a value is a
 * `bigint` it is never rounded again.
 */
export function scale(value: number | bigint, unitsPerWhole: bigint): bigint {
  if (typeof value === 'bigint') return value * unitsPerWhole;
  if (!Number.isFinite(value)) {
    throw new RangeError(`cannot convert non-finite quantity ${value} to exact units`);
  }
  return roundHalfEven(value * Number(unitsPerWhole));
}

/**
 * Round to the nearest integer, ties to even.
 *
 * Ties-to-even rather than ties-away so that a long run of conversions does not
 * accumulate a directional bias. Bias in a conserved system is not a rounding
 * artefact, it is a slow leak.
 */
export function roundHalfEven(value: number): bigint {
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder > 0.5) return BigInt(floor + 1);
  if (remainder < 0.5) return BigInt(floor);
  return BigInt(floor % 2 === 0 ? floor : floor + 1);
}

/**
 * A composition: how much of each element a parcel of material is made of.
 *
 * Absent keys mean zero. Values are micrograms and are never negative for a real
 * parcel, though a composition *delta* may be negative.
 */
export type Composition = ReadonlyMap<Element, Micrograms>;

export function emptyComposition(): Map<Element, Micrograms> {
  return new Map();
}

/** Total mass of a composition, in micrograms. */
export function compositionMass(composition: Composition): Micrograms {
  let total = 0n;
  for (const amount of composition.values()) total += amount;
  return total;
}

export function addComposition(
  target: Map<Element, Micrograms>,
  source: Composition,
  multiplier = 1n,
): Map<Element, Micrograms> {
  for (const [element, amount] of source) {
    const next = (target.get(element) ?? 0n) + amount * multiplier;
    if (next === 0n) target.delete(element);
    else target.set(element, next);
  }
  return target;
}

export function compositionsEqual(a: Composition, b: Composition): boolean {
  for (const [element, amount] of a) {
    if ((b.get(element) ?? 0n) !== amount) return false;
  }
  for (const [element, amount] of b) {
    if ((a.get(element) ?? 0n) !== amount) return false;
  }
  return true;
}

/**
 * Split an exact amount into `weights.length` parts that sum to *exactly* `amount`.
 *
 * Uses the largest-remainder method: every part gets its floor share, and the
 * leftover units go one each to the parts with the largest fractional remainder,
 * ties broken by index so the result is deterministic.
 *
 * This is the only sanctioned way to divide a conserved quantity. Independently
 * rounding each share is how a ledger silently stops balancing.
 */
export function partition(amount: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) {
    if (amount !== 0n) {
      throw new RangeError(`cannot partition ${amount} across zero parts`);
    }
    return [];
  }

  let totalWeight = 0n;
  for (const weight of weights) {
    if (weight < 0n) throw new RangeError(`partition weight ${weight} is negative`);
    totalWeight += weight;
  }
  if (totalWeight === 0n) {
    if (amount !== 0n) {
      throw new RangeError(`cannot partition ${amount} across zero total weight`);
    }
    return weights.map(() => 0n);
  }

  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;

  const parts: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let assigned = 0n;

  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index] ?? 0n;
    const numerator = magnitude * weight;
    const share = numerator / totalWeight;
    parts.push(share);
    assigned += share;
    remainders.push({ index, remainder: numerator % totalWeight });
  }

  let leftover = magnitude - assigned;
  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  for (const entry of remainders) {
    if (leftover === 0n) break;
    parts[entry.index] = (parts[entry.index] ?? 0n) + 1n;
    leftover -= 1n;
  }

  return negative ? parts.map((part) => -part) : parts;
}
