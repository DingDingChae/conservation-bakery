/**
 * The substance schema: the shape a data file in `packages/data/substances` must
 * take, and the hand-written validator that enforces it.
 *
 * Every substance declares how one kilogram of it splits across the elements the
 * ledger tracks (see core/commodity.ts). The split is expressed in integer
 * micrograms and must sum to exactly `UG_PER_KG`. That is not a convention this
 * loader is polite about — a file whose elements do not sum exactly is a bug in
 * the data, and `validateSubstance` rejects it before it can reach the registry.
 * See CONTRACT.md rule 1: nothing here may quietly gain or lose mass.
 */

import { ELEMENTS, UG_PER_KG, type Element, isElement } from '../core/commodity.js';

/**
 * Broad groupings used for organisation and filtering. Deliberately coarse: this
 * is a classification for content authors and UI, not a physical property the
 * ledger cares about.
 */
export const SUBSTANCE_CATEGORIES = [
  'atmospheric-gas',
  'water',
  'crop',
  'crop-fraction',
  'sugar',
  'dairy',
  'egg',
  'leavening-mineral',
  'mineral',
  'fuel-gas',
  'soil-nutrient',
  'feed',
  'packaging',
] as const;

export type SubstanceCategory = (typeof SUBSTANCE_CATEGORIES)[number];

const SUBSTANCE_CATEGORY_SET: ReadonlySet<string> = new Set(SUBSTANCE_CATEGORIES);

export const SUBSTANCE_STATES = ['solid', 'liquid', 'gas'] as const;
export type SubstanceState = (typeof SUBSTANCE_STATES)[number];

const SUBSTANCE_STATE_SET: ReadonlySet<string> = new Set(SUBSTANCE_STATES);

/** `kebab-case`, starting with a letter. Matches the data file's own basename. */
const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Micrograms of each element per kilogram of substance. Every key present must
 * be a known `Element` (see core/commodity.ts, including the `Ash` catch-all);
 * an absent key means zero. Values are non-negative integers, and the ones that
 * are present must sum to exactly `UG_PER_KG`.
 */
export type ElementalComposition = Readonly<Partial<Record<Element, number>>>;

export interface SubstanceRecord {
  readonly id: string;
  readonly name: string;
  readonly category: SubstanceCategory;
  readonly state: SubstanceState;
  readonly elements: ElementalComposition;
  /** Where the figures come from: molar mass, USDA FoodData Central, etc. */
  readonly source: string;
  /** Why the figures are what they are, especially how the composition closes. */
  readonly notes: string;
}

export class SubstanceValidationError extends Error {
  constructor(
    readonly label: string,
    message: string,
  ) {
    super(`substance "${label}": ${message}`);
    this.name = 'SubstanceValidationError';
  }
}

function fail(label: string, message: string): never {
  throw new SubstanceValidationError(label, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  data: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = data[field];
  if (typeof value !== 'string' || value.length === 0) {
    fail(label, `field "${field}" must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Validate an unknown value as a `SubstanceRecord`.
 *
 * `label` identifies the source (typically the file name) for error messages;
 * it is not itself validated against `id` here — the registry, which knows the
 * file name, is responsible for checking the two agree.
 */
export function validateSubstance(data: unknown, label: string): SubstanceRecord {
  if (!isPlainObject(data)) {
    fail(label, `expected a JSON object, got ${data === null ? 'null' : typeof data}`);
  }

  const id = requireString(data, 'id', label);
  if (!ID_PATTERN.test(id)) {
    fail(label, `id "${id}" must be lower-case kebab-case (e.g. "wheat-flour-white")`);
  }

  const name = requireString(data, 'name', label);
  const source = requireString(data, 'source', label);
  const notes = requireString(data, 'notes', label);

  const rawCategory = requireString(data, 'category', label);
  if (!SUBSTANCE_CATEGORY_SET.has(rawCategory)) {
    fail(
      label,
      `category "${rawCategory}" is not one of ${SUBSTANCE_CATEGORIES.join(', ')}`,
    );
  }
  const category = rawCategory as SubstanceCategory;

  const rawState = requireString(data, 'state', label);
  if (!SUBSTANCE_STATE_SET.has(rawState)) {
    fail(label, `state "${rawState}" is not one of ${SUBSTANCE_STATES.join(', ')}`);
  }
  const state = rawState as SubstanceState;

  const rawElements = data['elements'];
  if (!isPlainObject(rawElements)) {
    fail(label, `field "elements" must be an object, got ${JSON.stringify(rawElements)}`);
  }

  const elements: Partial<Record<Element, number>> = {};
  let sum = 0n;
  for (const [key, rawValue] of Object.entries(rawElements)) {
    if (!isElement(key)) {
      fail(
        label,
        `element key "${key}" is not one of the tracked elements (${ELEMENTS.join(', ')})`,
      );
    }
    if (
      typeof rawValue !== 'number' ||
      !Number.isInteger(rawValue) ||
      !Number.isSafeInteger(rawValue)
    ) {
      fail(
        label,
        `element "${key}" must be a non-negative safe integer number of micrograms, got ${JSON.stringify(rawValue)}`,
      );
    }
    if (rawValue < 0) {
      fail(label, `element "${key}" is negative (${rawValue}); a real parcel cannot have negative mass`);
    }
    elements[key] = rawValue;
    sum += BigInt(rawValue);
  }

  if (sum !== UG_PER_KG) {
    fail(
      label,
      `elemental composition sums to ${sum} ug/kg, but must equal exactly ${UG_PER_KG} ` +
        `(1 kg = 1000000000 ug). The offending sum is ${sum}, a residual of ` +
        `${sum - UG_PER_KG} ug against the required total.`,
    );
  }

  return { id, name, category, state, elements, source, notes };
}
