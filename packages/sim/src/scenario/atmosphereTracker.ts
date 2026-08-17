/**
 * Atmosphere reconciliation bookkeeping for the first-chain scenario.
 *
 * `world/exchange.ts`'s reactions only ever move elemental mass between named
 * accounts -- there is no separate "O2" or "CO2" commodity, only `el:O` and
 * `el:C` on whichever account holds them (see CONTRACT.md and commodity.ts).
 * This module classifies every posting the scenario applies by *why* it moved
 * atmosphere mass, so the headline integration test can assert the exact,
 * signed contribution of each real-world cause (crop photosynthesis, animal
 * respiration, oven fuel combustion, chemical leavening, and the water cycle)
 * rather than only the net total.
 *
 * The classification is derived entirely from each posting's own `process`
 * string, which every reaction builder in this codebase already sets to a
 * stable, documented name (`agri:crop-growth:*`, `*:respiration`,
 * `oven:*:combustion`, `leavening:vent-gas`, ...). Nothing here recomputes or
 * second-guesses a posting's entries -- it only sums the deltas a posting
 * already declared for the one account being tracked.
 */

import type { CommodityId } from '../core/commodity.js';
import { elementCommodity } from '../core/commodity.js';
import type { AccountId, Posting } from '../core/ledger.js';

export type AtmosphereCategory =
  /** Photosynthesis: crop growth drawing CO2/H2O out of the atmosphere. */
  | 'growth'
  /** Aerobic respiration: livestock (and, in principle, any biomass) burning
   * stored organic matter, releasing CO2/H2O back to the atmosphere. */
  | 'respiration'
  /** Combustion of the oven's methane fuel charge. */
  | 'fuel'
  /** Chemical leavening gas (CO2) vented from the batter to the atmosphere. */
  | 'leavening'
  /** Every other atmosphere-touching transfer: rainfall, transpiration,
   * grain drying, milling and refining moisture loss, in-oven and post-bake
   * evaporation. All of these move only H and O (water), never C. */
  | 'water-cycle';

const CATEGORY_MATCHERS: readonly { readonly category: AtmosphereCategory; readonly test: (process: string) => boolean }[] = [
  { category: 'growth', test: (p) => p.startsWith('agri:crop-growth:') },
  { category: 'respiration', test: (p) => p.includes(':respiration') },
  { category: 'fuel', test: (p) => p.includes('combustion') },
  { category: 'leavening', test: (p) => p === 'leavening:vent-gas' || p.startsWith('leavening:vent-gas:') },
  {
    category: 'water-cycle',
    test: (p) =>
      p.startsWith('agri:crop-transpiration:') ||
      p.startsWith('agri:rainfall:') ||
      p.includes('grain-drying') ||
      p.includes(':respired-water') ||
      p === 'mill:grind' ||
      p.startsWith('mill:grind:') ||
      p === 'refinery:extract' ||
      p.startsWith('refinery:extract:') ||
      p.startsWith('transform:moisture-loss') ||
      p.startsWith('bake:') ||
      p.startsWith('staling:moisture-loss'),
  },
];

function classify(process: string): AtmosphereCategory | undefined {
  for (const matcher of CATEGORY_MATCHERS) {
    if (matcher.test(process)) return matcher.category;
  }
  return undefined;
}

export interface AtmosphereCategoryTotals {
  readonly C: bigint;
  readonly H: bigint;
  readonly O: bigint;
}

/**
 * Accumulates, per `AtmosphereCategory`, the exact net C/H/O delta a set of
 * postings contributed to one specific atmosphere account. Every posting fed
 * to `record` either matches exactly one category (by its `process` name) or
 * does not touch the tracked account at all -- an unmatched *but
 * atmosphere-touching* posting is a real gap in this reconciliation and is
 * reported by `unclassified` rather than silently dropped, so a future
 * reaction added to the world without updating this tracker is caught rather
 * than quietly mis-attributed.
 */
export class AtmosphereTracker {
  readonly #account: AccountId;
  readonly #totals = new Map<AtmosphereCategory, { C: bigint; H: bigint; O: bigint }>();
  #unclassified: { C: bigint; H: bigint; O: bigint } = { C: 0n, H: 0n, O: 0n };

  constructor(atmosphereAccount: AccountId) {
    this.#account = atmosphereAccount;
  }

  record(posting: Posting): void {
    const category = classify(posting.process);
    let bucket = category ? this.#totals.get(category) : undefined;
    if (category && !bucket) {
      bucket = { C: 0n, H: 0n, O: 0n };
      this.#totals.set(category, bucket);
    }
    for (const entry of posting.entries) {
      if (entry.account !== this.#account) continue;
      if (entry.delta === 0n) continue;
      const target = bucket ?? this.#unclassified;
      if (entry.commodity === elementCommodity('C')) target.C += entry.delta;
      else if (entry.commodity === elementCommodity('H')) target.H += entry.delta;
      else if (entry.commodity === elementCommodity('O')) target.O += entry.delta;
    }
  }

  recordAll(postings: readonly Posting[]): void {
    for (const posting of postings) this.record(posting);
  }

  totals(category: AtmosphereCategory): AtmosphereCategoryTotals {
    const bucket = this.#totals.get(category);
    return bucket ? { ...bucket } : { C: 0n, H: 0n, O: 0n };
  }

  /** Every atmosphere-touching delta this tracker could not attribute to a
   * known category. Always `{0n,0n,0n}` for a scenario built entirely from
   * this codebase's own reaction builders -- see the module doc comment. */
  unclassified(): AtmosphereCategoryTotals {
    return { ...this.#unclassified };
  }

  /** Sum of every tracked category's contribution, for cross-checking against
   * the atmosphere account's real before/after balance. */
  grandTotal(): AtmosphereCategoryTotals {
    let C = this.#unclassified.C;
    let H = this.#unclassified.H;
    let O = this.#unclassified.O;
    for (const bucket of this.#totals.values()) {
      C += bucket.C;
      H += bucket.H;
      O += bucket.O;
    }
    return { C, H, O };
  }
}

export const ATMOSPHERE_CARBON: CommodityId = elementCommodity('C');
export const ATMOSPHERE_OXYGEN: CommodityId = elementCommodity('O');
