/**
 * Gelatin, from rendering.
 *
 * Real gelatin manufacture renders collagen-rich animal by-product (hide or
 * bone stock) in hot water, converting insoluble collagen to soluble
 * gelatin. This module seeds `renderingWorks`'s own reservoir with a real,
 * cited bone-stock-like collagen composition (`gelatin.json`'s own file note
 * explains the calcium/phosphorus-weighted ash this implies), then draws
 * `gelatin.json`'s own exact registered composition directly from it,
 * clamped to what the reservoir actually holds — the same technique
 * `origin/minerals.ts`'s `drawByRegisteredComposition` uses for refining
 * sodium bicarbonate and cream of tartar from their own natural deposits.
 */

import type { Element, Micrograms } from '../core/commodity.js';
import { elementCommodity } from '../core/commodity.js';
import type { AccountId, Entry, Ledger } from '../core/ledger.js';
import { getComposition } from '../substance/registry.js';
import { originReservoirAccount, seedMineralRegion, type OriginRegion } from './region.js';
import { minBig } from './util.js';

/** Real bone-stock-like collagen composition: protein-dominant, with the
 * calcium and phosphorus a bone-derived rendering stock (rather than a
 * hide-derived one) really carries — matches `gelatin.json`'s own cited
 * elemental analysis for the protein fraction, plus real bone mineral. */
const RENDERING_STOCK_COMPOSITION: Readonly<Partial<Record<Element, number>>> = {
  C: 0.35, H: 0.06, N: 0.11, O: 0.2, S: 0.003, Ca: 0.12, P: 0.06, Ash: 0.097,
};

export function seedRenderingWorks(ledger: Ledger, region: OriginRegion): void {
  seedMineralRegion(ledger, region, RENDERING_STOCK_COMPOSITION);
}

export interface RenderingResult {
  readonly gelatinMassUg: Micrograms;
}

/**
 * Render `targetMassUg` of gelatin directly from `region`'s own seeded
 * hide-and-bone-stock reservoir, crediting `destinationAccount`.
 */
export function renderGelatin(ledger: Ledger, region: OriginRegion, targetMassUg: Micrograms, destinationAccount: AccountId): RenderingResult {
  if (!ledger.hasAccount(destinationAccount)) ledger.openAccount({ id: destinationAccount, kind: 'stock', label: destinationAccount });
  const reservoir = originReservoirAccount(region);
  const target = getComposition('gelatin', targetMassUg);

  const entries: Entry[] = [];
  let gelatinMassUg: Micrograms = 0n;
  for (const [element, wantedAmount] of target) {
    if (wantedAmount <= 0n) continue;
    const available = ledger.balance(reservoir, elementCommodity(element));
    const drawn = minBig(wantedAmount, available);
    if (drawn <= 0n) continue;
    entries.push({ account: reservoir, commodity: elementCommodity(element), delta: -drawn });
    entries.push({ account: destinationAccount, commodity: elementCommodity(element), delta: drawn });
    gelatinMassUg += drawn;
  }
  if (entries.length > 0) ledger.post({ process: 'origin:gelatin:render', entries });

  return { gelatinMassUg };
}
