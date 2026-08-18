/**
 * The cake catalogue: real, named cakes as open content, each one validated
 * against the physical formulation engine in `formulation.ts` at load time.
 *
 * This module is the loader and query surface. It does not decide whether a
 * recipe is physically coherent — `validateFormulation` already does that, from
 * real baking-science balance rules (see that module's doc comment). This
 * module's own job is narrower: read every `*.json` file in
 * `packages/data/cakes`, check each one has the shape a cake record must have,
 * build a `Formulation` from its ingredient list, and refuse to let the
 * catalogue finish loading if any shipped cake's formulation is not `ok`. A
 * cake that fails validation is a bug in the data (or a real gap in the
 * engine), never something this loader papers over.
 *
 * ## Scope: one mixed batter or dough per cake
 *
 * `ingredients` models exactly one thing: everything that is mixed together
 * into the single batter or dough that goes into the oven as one mass. A
 * separately-prepared component that is layered, filled, coated, glazed,
 * wrapped, dusted, or soaked onto a cake after it is mixed (or after it is
 * baked) — pastry cream, buttercream, ganache, a marzipan wrap, a streusel
 * crumb pressed on top, a caramel poured into the pan before the batter,
 * icing, a milk soak — is real and is described in `process` and `notes`, but
 * is deliberately kept out of `ingredients`. Baker's percentage is a ratio
 * language for *one batter*; folding a second, differently-prepared component
 * into the same percentage table would make every ratio in it meaningless,
 * which is exactly the failure mode `formulation.ts`'s own balance rules exist
 * to catch. Ingredients that are genuinely stirred into the batter itself
 * (grated carrot in a carrot cake, mashed banana in a banana cake, cocoa
 * powder swirled through a marble cake) do belong in `ingredients` — they are
 * part of the one mixed mass, not a second component.
 *
 * ## Substance ids beyond the current registry
 *
 * `substanceId` names the real ingredient a line represents, whether or not
 * `packages/data/substances` currently carries a record for it. Formulation
 * coherence (this module's load-time gate) only reasons over `role` and
 * `bakersPercent` — it has no dependency on the substance registry at all, so
 * an id with no backing record does not block a cake from loading. It does
 * mean that ingredient cannot yet move real mass through a `Ledger`; see
 * `unresolvedSubstanceIds` below, and the catalogue's own module notes for the
 * substances this data set needed that the registry does not yet carry
 * (cocoa powder, dark chocolate, vegetable oil, ground almond and hazelnut,
 * honey, dried fruit, and several more — see individual cake `notes` fields
 * for the citations behind each approximation).
 *
 * A compound real ingredient whose function spans more than one role (cocoa
 * powder is both fat and dry solids; a fresh vegetable or fruit stirred into a
 * batter is both water and dry matter) is expressed as two or more ingredient
 * lines sharing the same `substanceId`, split by that ingredient's own real
 * proximate composition — the same technique already used by
 * `formulation.ts`'s own "effective hydration credits egg's own water" rule,
 * applied to whichever real ingredient needs it, cited per cake.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultSubstanceRegistry } from '../substance/registry.js';
import {
  INGREDIENT_ROLES,
  isIngredientRole,
  validateFormulation,
  evaluateFormulation,
  type Formulation,
  type FormulationIngredient,
  type FormulationMetrics,
  type FormulationValidation,
  type IngredientRole,
} from './formulation.js';

/**
 * Broad heat-delivery families a cake's process wants. `deck` and `convection`
 * are the two `oven.ts` already builds real heat-transfer physics for (see
 * that module's doc comment); `tunnel` (continuous-belt ovens used for
 * standardised, high-volume sheet items) and `rotary` (a rotating spit or
 * turntable under a fixed radiant element, the traditional method for a
 * layered product like Baumkuchen) are named in `oven.ts` as planned families
 * that can plug in later with their own `HeatTransferGeometry`. `none` is for
 * a cake whose only cooked component is not oven-baked at all (a stovetop
 * crepe, for instance) — not used by anything currently shipped, but kept for
 * a genuinely oven-free process.
 */
export const OVEN_FAMILIES = ['deck', 'convection', 'tunnel', 'rotary', 'none'] as const;
export type OvenFamily = (typeof OVEN_FAMILIES)[number];
const OVEN_FAMILY_SET: ReadonlySet<string> = new Set(OVEN_FAMILIES);

/** `kebab-case`, starting with a letter — the same convention
 * `substance/schema.ts` uses, so a cake id and a substance id read the same
 * way wherever they appear together. */
const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export interface CakeIngredient {
  readonly substanceId: string;
  readonly role: IngredientRole;
  readonly bakersPercent: number;
  /** Why this line's mass, split, or substance choice is what it is, when it
   * is not simply the ingredient at face value (an approximation, a
   * proximate-composition split, a substance the registry does not carry
   * yet). Omitted when there is nothing to explain. */
  readonly note?: string;
}

export interface CakeProcessStep {
  readonly name: string;
  readonly description: string;
  /** Real process temperature, Celsius, when this step has one (a bake, a
   * proof, a chill). Omitted for steps with no characteristic temperature
   * (weighing, folding, assembling). */
  readonly temperatureC?: number;
  readonly durationMinutes?: number;
}

export interface CakeRecord {
  readonly id: string;
  readonly name: string;
  /** Short label for the culinary tradition this cake belongs to (French,
   * British, Japanese, and so on) — coarse, for grouping and query. */
  readonly tradition: string;
  /** Longer free-text account of where and when this cake comes from. */
  readonly origin: string;
  readonly ingredients: readonly CakeIngredient[];
  readonly process: readonly CakeProcessStep[];
  readonly ovenFamily: OvenFamily;
  /** Citations and, honestly, approximations: where the baker's percentages
   * come from, and exactly what was approximated and why, per CLAUDE.md's
   * realism rule. */
  readonly notes: string;
}

export class CakeValidationError extends Error {
  constructor(
    readonly label: string,
    message: string,
  ) {
    super(`cake "${label}": ${message}`);
    this.name = 'CakeValidationError';
  }
}

function fail(label: string, message: string): never {
  throw new CakeValidationError(label, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(data: Record<string, unknown>, field: string, label: string): string {
  const value = data[field];
  if (typeof value !== 'string' || value.length === 0) {
    fail(label, `field "${field}" must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(label, `${what} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function validateIngredient(raw: unknown, label: string, index: number): CakeIngredient {
  if (!isPlainObject(raw)) {
    fail(label, `ingredient[${index}] must be an object, got ${JSON.stringify(raw)}`);
  }
  const substanceId = requireString(raw, 'substanceId', label);
  if (!ID_PATTERN.test(substanceId)) {
    fail(label, `ingredient[${index}].substanceId "${substanceId}" must be lower-case kebab-case`);
  }
  const rawRole = requireString(raw, 'role', label);
  if (!isIngredientRole(rawRole)) {
    fail(
      label,
      `ingredient[${index}].role "${rawRole}" is not one of ${INGREDIENT_ROLES.join(', ')}`,
    );
  }
  const bakersPercent = requireFiniteNumber(
    raw['bakersPercent'],
    label,
    `ingredient[${index}].bakersPercent`,
  );
  if (bakersPercent < 0) {
    fail(label, `ingredient[${index}].bakersPercent is negative (${bakersPercent})`);
  }
  const rawNote = raw['note'];
  if (rawNote !== undefined && (typeof rawNote !== 'string' || rawNote.length === 0)) {
    fail(label, `ingredient[${index}].note must be a non-empty string when present`);
  }

  return {
    substanceId,
    role: rawRole,
    bakersPercent,
    ...(rawNote !== undefined ? { note: rawNote as string } : {}),
  };
}

function validateProcessStep(raw: unknown, label: string, index: number): CakeProcessStep {
  if (!isPlainObject(raw)) {
    fail(label, `process[${index}] must be an object, got ${JSON.stringify(raw)}`);
  }
  const name = requireString(raw, 'name', label);
  const description = requireString(raw, 'description', label);

  const rawTemp = raw['temperatureC'];
  let temperatureC: number | undefined;
  if (rawTemp !== undefined) {
    temperatureC = requireFiniteNumber(rawTemp, label, `process[${index}].temperatureC`);
    // -25 C covers a chill/freeze step; 300 C is well past any bakery oven's real
    // range (a domestic or deck oven tops out around 250-280 C) — a value outside
    // this band is a data typo, not a real process temperature.
    if (temperatureC < -25 || temperatureC > 300) {
      fail(
        label,
        `process[${index}].temperatureC (${temperatureC}) is outside a plausible bakery ` +
          `process range (-25 C to 300 C)`,
      );
    }
  }

  const rawDuration = raw['durationMinutes'];
  let durationMinutes: number | undefined;
  if (rawDuration !== undefined) {
    durationMinutes = requireFiniteNumber(rawDuration, label, `process[${index}].durationMinutes`);
    if (durationMinutes <= 0) {
      fail(label, `process[${index}].durationMinutes must be positive, got ${durationMinutes}`);
    }
  }

  return {
    name,
    description,
    ...(temperatureC !== undefined ? { temperatureC } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
  };
}

/**
 * Validate an unknown value's *shape* as a `CakeRecord` — every field present,
 * of the right type, in range. This does not check physical coherence; that is
 * `validateFormulation`'s job, run separately by `CakeCatalog.load` once a
 * `Formulation` can be built from the result.
 */
export function validateCakeRecord(data: unknown, label: string): CakeRecord {
  if (!isPlainObject(data)) {
    fail(label, `expected a JSON object, got ${data === null ? 'null' : typeof data}`);
  }

  const id = requireString(data, 'id', label);
  if (!ID_PATTERN.test(id)) {
    fail(label, `id "${id}" must be lower-case kebab-case (e.g. "victoria-sponge")`);
  }

  const name = requireString(data, 'name', label);
  const tradition = requireString(data, 'tradition', label);
  const origin = requireString(data, 'origin', label);
  const notes = requireString(data, 'notes', label);

  const rawOvenFamily = requireString(data, 'ovenFamily', label);
  if (!OVEN_FAMILY_SET.has(rawOvenFamily)) {
    fail(label, `ovenFamily "${rawOvenFamily}" is not one of ${OVEN_FAMILIES.join(', ')}`);
  }
  const ovenFamily = rawOvenFamily as OvenFamily;

  const rawIngredients = data['ingredients'];
  if (!Array.isArray(rawIngredients) || rawIngredients.length === 0) {
    fail(label, `field "ingredients" must be a non-empty array`);
  }
  const ingredients = rawIngredients.map((raw, index) => validateIngredient(raw, label, index));

  const rawProcess = data['process'];
  if (!Array.isArray(rawProcess) || rawProcess.length === 0) {
    fail(label, `field "process" must be a non-empty array`);
  }
  const process = rawProcess.map((raw, index) => validateProcessStep(raw, label, index));

  return { id, name, tradition, origin, ingredients, process, ovenFamily, notes };
}

/** Build the `Formulation` `formulation.ts` actually reasons over from a
 * cake's ingredient list — dropping only the per-line `note`, which is
 * documentation, not physics. */
export function toFormulation(cake: CakeRecord): Formulation {
  return {
    name: cake.name,
    ingredients: cake.ingredients.map(
      (ingredient): FormulationIngredient => ({
        substanceId: ingredient.substanceId,
        role: ingredient.role,
        bakersPercent: ingredient.bakersPercent,
      }),
    ),
  };
}

/** Every distinct `substanceId` this cake's ingredient list references, in
 * the order first seen. */
export function substanceIds(cake: CakeRecord): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ingredient of cake.ingredients) {
    if (!seen.has(ingredient.substanceId)) {
      seen.add(ingredient.substanceId);
      out.push(ingredient.substanceId);
    }
  }
  return out;
}

/**
 * Which of this cake's substance ids have no backing record in the substance
 * registry yet, and so cannot move real mass through a `Ledger` today. Does
 * not affect whether the cake loads — see the module doc comment — this is a
 * diagnostic for exactly how far the registry (`packages/data/substances`)
 * would need to grow to make this catalogue ledger-ready end to end.
 */
export function unresolvedSubstanceIds(cake: CakeRecord): readonly string[] {
  const registry = defaultSubstanceRegistry();
  return substanceIds(cake).filter((id) => !registry.has(id));
}

/**
 * `packages/data/cakes`, resolved relative to this file. `packages/sim/src/bake`
 * is the same depth below `packages/sim` as `packages/sim/src/substance` (see
 * `substance/registry.ts`), so the same three-`..` climb reaches `packages/data`.
 */
function defaultCakesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', 'data', 'cakes');
}

export class CakeCatalog {
  readonly #byId: ReadonlyMap<string, CakeRecord>;

  private constructor(byId: ReadonlyMap<string, CakeRecord>) {
    this.#byId = byId;
  }

  /**
   * Load and validate every cake file in `dir` (default: `packages/data/cakes`).
   *
   * Two independent gates, in order, for each file:
   *
   * 1. **Shape** (`validateCakeRecord`): every required field present, of the
   *    right type, in a plausible range.
   * 2. **Physical coherence** (`validateFormulation`, from `formulation.ts`):
   *    the ingredient list, read as baker's percentages, is a recipe that can
   *    actually set into a cake — not a generic "invalid" check, the same
   *    sourced balance rules a professional baking text uses.
   *
   * A file that fails either throws immediately, naming the file and the exact
   * reason, so an incoherent recipe can never reach the catalogue silently.
   */
  static load(dir: string = defaultCakesDir()): CakeCatalog {
    const entries = readdirSync(dir).filter((name: string) => name.endsWith('.json'));
    if (entries.length === 0) {
      throw new Error(`no cake files found in ${dir}`);
    }

    const byId = new Map<string, CakeRecord>();
    for (const fileName of entries.sort()) {
      const path = join(dir, fileName);
      const label = fileName;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`cake file "${label}" is not valid JSON: ${message}`);
      }

      const record = validateCakeRecord(parsed, label);

      const expectedId = fileName.slice(0, -'.json'.length);
      if (record.id !== expectedId) {
        throw new Error(
          `cake file "${label}" declares id "${record.id}", which does not match its file ` +
            `name "${expectedId}.json"`,
        );
      }
      if (byId.has(record.id)) {
        throw new Error(`duplicate cake id "${record.id}"`);
      }

      const validation = validateFormulation(toFormulation(record));
      if (!validation.ok) {
        const reasons = validation.problems.map((problem) => `- ${problem.code}: ${problem.message}`);
        throw new Error(
          `cake "${record.id}" (${label}) is not a physically coherent formulation:\n` +
            reasons.join('\n'),
        );
      }

      byId.set(record.id, Object.freeze({ ...record, ingredients: Object.freeze([...record.ingredients]), process: Object.freeze([...record.process]) }));
    }

    return new CakeCatalog(Object.freeze(byId));
  }

  get(id: string): CakeRecord {
    const record = this.#byId.get(id);
    if (!record) throw new Error(`unknown cake "${id}"`);
    return record;
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  /** Deterministic: sorted by id, which is how `load` inserted them. */
  ids(): readonly string[] {
    return [...this.#byId.keys()];
  }

  all(): readonly CakeRecord[] {
    return [...this.#byId.values()];
  }

  /** Every cake whose `tradition` matches, case-insensitively. */
  byTradition(tradition: string): readonly CakeRecord[] {
    const needle = tradition.toLowerCase();
    return this.all().filter((cake) => cake.tradition.toLowerCase() === needle);
  }

  find(predicate: (cake: CakeRecord) => boolean): readonly CakeRecord[] {
    return this.all().filter(predicate);
  }

  /** The same balance metrics `formulation.ts` derives for any formulation,
   * for a specific cataloged cake. */
  metrics(id: string): FormulationMetrics {
    return evaluateFormulation(toFormulation(this.get(id)));
  }

  /** Re-runs the same load-time coherence check `load()` already enforced,
   * for a specific cataloged cake — useful for a caller that wants the full
   * `FormulationValidation` result (metrics and problems together) rather
   * than just the metrics. Always `ok: true` for anything actually in the
   * catalogue, by construction. */
  validation(id: string): FormulationValidation {
    return validateFormulation(toFormulation(this.get(id)));
  }
}

let shared: CakeCatalog | undefined;

/** The default catalogue, loaded once from `packages/data/cakes`. */
export function defaultCakeCatalog(): CakeCatalog {
  shared ??= CakeCatalog.load();
  return shared;
}

export function getCake(id: string): CakeRecord {
  return defaultCakeCatalog().get(id);
}
