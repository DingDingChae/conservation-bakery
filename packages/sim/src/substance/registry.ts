/**
 * The substance registry.
 *
 * Loads every `*.json` file in `packages/data/substances`, validates each one
 * against the schema, and freezes the result. This is the only place substance
 * data enters the simulation, and the only place a mass of a substance is turned
 * into a `Composition` — via `getComposition`, which uses `partition()` so the
 * elemental split of any mass sums back to that exact mass. See
 * core/commodity.ts for `partition` and `Composition`.
 *
 * This is the one sanctioned place `packages/sim` touches Node: it is a
 * load-time loader reading data files from disk, not tick-time simulation.
 * Do not spread Node imports into any other sim module.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ELEMENTS,
  type Composition,
  type Element,
  type Micrograms,
  partition,
} from '../core/commodity.js';
import { validateSubstance, type SubstanceRecord } from './schema.js';

/**
 * `packages/data/substances`, resolved relative to this file rather than the
 * process's working directory, so the registry loads correctly regardless of
 * where the simulation is run from.
 *
 * packages/sim/src/substance -> packages/sim/src -> packages/sim -> packages
 * -> packages/data/substances.
 */
function defaultSubstancesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', 'data', 'substances');
}

export class UnknownSubstanceError extends Error {
  constructor(readonly substanceId: string) {
    super(`unknown substance "${substanceId}"`);
    this.name = 'UnknownSubstanceError';
  }
}

export class SubstanceRegistry {
  readonly #byId: ReadonlyMap<string, SubstanceRecord>;

  private constructor(byId: ReadonlyMap<string, SubstanceRecord>) {
    this.#byId = byId;
  }

  /**
   * Load and validate every substance file in `dir` (default:
   * `packages/data/substances`). Throws on the first invalid file — see
   * `validateSubstance` — so an unbalanced or malformed substance can never
   * reach the simulation.
   */
  static load(dir: string = defaultSubstancesDir()): SubstanceRegistry {
    const entries = readdirSync(dir).filter((name: string) => name.endsWith('.json'));
    if (entries.length === 0) {
      throw new Error(`no substance files found in ${dir}`);
    }

    const byId = new Map<string, SubstanceRecord>();
    for (const fileName of entries.sort()) {
      const path = join(dir, fileName);
      const label = fileName;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`substance file "${label}" is not valid JSON: ${message}`);
      }

      const record = validateSubstance(parsed, label);

      const expectedId = fileName.slice(0, -'.json'.length);
      if (record.id !== expectedId) {
        throw new Error(
          `substance file "${label}" declares id "${record.id}", which does not match ` +
            `its file name "${expectedId}.json"`,
        );
      }

      if (byId.has(record.id)) {
        throw new Error(`duplicate substance id "${record.id}"`);
      }

      byId.set(record.id, Object.freeze({ ...record, elements: Object.freeze({ ...record.elements }) }));
    }

    return new SubstanceRegistry(Object.freeze(byId));
  }

  get(substanceId: string): SubstanceRecord {
    const record = this.#byId.get(substanceId);
    if (!record) throw new UnknownSubstanceError(substanceId);
    return record;
  }

  has(substanceId: string): boolean {
    return this.#byId.has(substanceId);
  }

  /** Deterministic: sorted by id, which is how `load` inserted them. */
  ids(): readonly string[] {
    return [...this.#byId.keys()];
  }

  all(): readonly SubstanceRecord[] {
    return [...this.#byId.values()];
  }

  /**
   * Convert a mass of a substance into its elemental `Composition`.
   *
   * The critical property: `compositionMass(getComposition(id, massUg)) ===
   * massUg` for every `massUg`, including `0n`, `1n`, and awkward primes. This
   * holds because the per-kilogram weights already sum to exactly `UG_PER_KG`
   * (enforced at load time by `validateSubstance`), and `partition` splits any
   * exact amount across a set of weights into parts that sum back to that exact
   * amount by construction — it is the same technique the ledger itself relies
   * on to divide a conserved quantity without leaking a remainder.
   */
  getComposition(substanceId: string, massUg: Micrograms): Composition {
    const record = this.get(substanceId);
    const weights = ELEMENTS.map((element) => BigInt(record.elements[element] ?? 0));
    const parts = partition(massUg, weights);

    const composition = new Map<Element, Micrograms>();
    for (let index = 0; index < ELEMENTS.length; index += 1) {
      const element = ELEMENTS[index] as Element;
      const amount = parts[index] as Micrograms;
      if (amount !== 0n) composition.set(element, amount);
    }
    return composition;
  }
}

let shared: SubstanceRegistry | undefined;

/** The default registry, loaded once from `packages/data/substances`. */
export function defaultSubstanceRegistry(): SubstanceRegistry {
  shared ??= SubstanceRegistry.load();
  return shared;
}

export function getSubstance(substanceId: string): SubstanceRecord {
  return defaultSubstanceRegistry().get(substanceId);
}

export function getComposition(substanceId: string, massUg: Micrograms): Composition {
  return defaultSubstanceRegistry().getComposition(substanceId, massUg);
}

export type { SubstanceRecord } from './schema.js';
