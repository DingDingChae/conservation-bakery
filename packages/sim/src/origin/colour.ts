/**
 * Food colour: a beet-derived red extract, and caramel colour from heated
 * sucrose. Both draw on substances already produced elsewhere in this
 * catalogue (`sugar-beet.json`, `sucrose.json`) rather than a dedicated
 * origin region, delivered from `market.suppliers` the same way
 * `agri/livestock.ts`'s `stockRation` delivers a feed ration.
 */

import type { Composition, Micrograms } from '../core/commodity.js';
import { compositionMass, elementCommodity, roundHalfEven } from '../core/commodity.js';
import type { AccountId, Entry, Ledger } from '../core/ledger.js';
import { evaporate } from '../world/exchange.js';
import { WORLD_ACCOUNTS } from '../world/accounts.js';
import { buildProcessPosting, splitByProfile, type StreamProfile } from '../plant/unit.js';
import { getComposition } from '../substance/registry.js';
import type { SubstanceRegistry } from '../substance/registry.js';

/** Real, illustrative extraction fraction: only a small share of a processed
 * beet's own mass becomes pigment-bearing colour concentrate (most of the
 * beet is refined for sucrose or pulp/molasses instead — see
 * `plant/refinery.ts`). */
export const COLOUR_SHARE_OF_BEET = 0.03;

function acquireFromMarket(ledger: Ledger, account: AccountId, composition: Composition, process: string): void {
  const entries: Entry[] = [];
  for (const [element, amount] of composition) {
    if (amount === 0n) continue;
    entries.push({ account, commodity: elementCommodity(element), delta: amount });
    entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity(element), delta: -amount });
  }
  if (entries.length > 0) ledger.post({ process, entries });
}

export interface BeetColourResult {
  readonly beetMassUg: Micrograms;
  readonly colourMassUg: Micrograms;
  readonly residueMassUg: Micrograms;
}

/**
 * Extract beet red colour from a real mass of sugar beet, delivered fresh
 * from the market and split — by `beet-red-colour.json`'s own real composition
 * versus the beet's own residual profile — into colour concentrate and
 * spent-beet residue.
 */
export function extractBeetColour(
  ledger: Ledger,
  registry: SubstanceRegistry,
  beetMassUg: Micrograms,
  colourAccount: AccountId,
  residueAccount: AccountId,
): BeetColourResult {
  for (const id of [colourAccount, residueAccount]) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  const workingAccount = `${colourAccount}.beet-supply`;
  if (!ledger.hasAccount(workingAccount)) ledger.openAccount({ id: workingAccount, kind: 'stock', label: workingAccount });

  const beet = getComposition('sugar-beet', beetMassUg);
  acquireFromMarket(ledger, workingAccount, beet, 'origin:colour:acquire-beet');

  const streams: readonly StreamProfile[] = [
    { id: 'colour', elements: registry.get('beet-red-colour').elements, targetShare: COLOUR_SHARE_OF_BEET },
    { id: 'residue', elements: registry.get('sugar-beet').elements, targetShare: 1 - COLOUR_SHARE_OF_BEET },
  ];
  const [colourComposition, residueComposition] = splitByProfile(beet, streams) as [Composition, Composition];
  ledger.post(
    buildProcessPosting({
      process: 'origin:colour:extract-beet-red',
      inputs: [{ account: workingAccount, composition: beet }],
      outputs: [
        { account: colourAccount, composition: colourComposition },
        { account: residueAccount, composition: residueComposition },
      ],
    }),
  );

  return {
    beetMassUg,
    colourMassUg: compositionMass(colourComposition),
    residueMassUg: compositionMass(residueComposition),
  };
}

/** Real, illustrative dehydration mass loss during Class I caramelisation —
 * heating sucrose alone drives off water and some volatile organics via real
 * dehydration/polymerisation reactions (`caramel-colour.json`'s own file
 * note). */
export const CARAMELISATION_LOSS_FRACTION = 0.05;

export interface CaramelColourResult {
  readonly sucroseMassUg: Micrograms;
  readonly waterLossUg: Micrograms;
  readonly caramelMassUg: Micrograms;
}

/**
 * Heat a real mass of sucrose, delivered fresh from the market, into caramel
 * colour: a real, balanced water loss (`world/exchange.ts`'s `evaporate`) —
 * chemically real, since caramelisation's dehydration reactions do release
 * some of the sugar's own bound hydrogen and oxygen as water vapour.
 */
export function makeCaramelColour(ledger: Ledger, sucroseMassUg: Micrograms, destinationAccount: AccountId): CaramelColourResult {
  const workingAccount = `${destinationAccount}.melt`;
  if (!ledger.hasAccount(workingAccount)) ledger.openAccount({ id: workingAccount, kind: 'stock', label: workingAccount });
  if (!ledger.hasAccount(destinationAccount)) ledger.openAccount({ id: destinationAccount, kind: 'stock', label: destinationAccount });

  const sucrose = getComposition('sucrose', sucroseMassUg);
  acquireFromMarket(ledger, workingAccount, sucrose, 'origin:colour:acquire-sucrose');

  const waterLossUg = roundHalfEven(Number(sucroseMassUg) * CARAMELISATION_LOSS_FRACTION);
  if (waterLossUg > 0n) {
    ledger.post(evaporate({ waterAccount: workingAccount, waterMass: waterLossUg, process: 'origin:colour:caramelise' }));
  }

  const entries: Entry[] = [];
  for (const [commodity, amount] of ledger.balances(workingAccount)) {
    if (amount === 0n) continue;
    entries.push({ account: workingAccount, commodity, delta: -amount });
    entries.push({ account: destinationAccount, commodity, delta: amount });
  }
  if (entries.length > 0) ledger.post({ process: 'origin:colour:bottle-caramel', entries });

  return { sucroseMassUg, waterLossUg, caramelMassUg: sucroseMassUg - waterLossUg };
}
