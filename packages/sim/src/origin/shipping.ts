/**
 * Shipping: turning a region's finished production into a real, timed delivery.
 *
 * A cocoa or vanilla shipment does not teleport to the bakery's gate the instant
 * it is grown — it spends real, cited days in transit (`OriginRegion.shippingDays`,
 * see `region.ts`). This module models that as an actual account: material
 * leaves its source account the moment it departs, sits in a dedicated
 * in-transit account, and only reaches the bakery's own account once
 * `receiveShipment` is called at or after the shipment's `arrivalTick`. The
 * mass is real, conserved cargo the whole time it is "at sea" (or on the
 * road) — this never removes anything from the ledger, it only moves which
 * account holds it, exactly like every other transfer in this codebase
 * (CONTRACT.md rule 1).
 *
 * A shipment departs from an explicit `sourceAccount`, not a single fixed
 * "the region's warehouse" — a region growing more than one distinct
 * tradeable product (cocoa butter *and* cocoa powder from the same cocoa
 * belt) needs each to travel, and later be received, as its own identifiable
 * cargo. Mixing two different finished products' raw elemental mass into one
 * shared account before shipping would make it impossible to tell how much of
 * the arrival was butter versus how much was powder, since the ledger tracks
 * conserved element mass, not a product label. `cargo` is an arbitrary id
 * distinguishing simultaneous shipments from the same region.
 */

import type { Element, Micrograms } from '../core/commodity.js';
import type { AccountId, Entry, Ledger, Posting } from '../core/ledger.js';
import type { OriginRegion } from './region.js';

export const SECONDS_PER_DAY = 86_400;

/** How many simulation ticks `region.shippingDays` of real transit time is,
 * given the clock's own seconds-per-tick (see `clock/clock.ts`; defaults to 1,
 * matching `docs/ARCHITECTURE.md`'s fixed 1-second tick). */
export function shippingDelayTicks(region: OriginRegion, secondsPerTick = 1): number {
  return Math.round((region.shippingDays * SECONDS_PER_DAY) / secondsPerTick);
}

/** The account one specific cargo sits in while it is "in transit" from a
 * region to the bakery — neither still at origin nor yet usable. */
export function originInTransitAccount(region: OriginRegion, cargo: string): AccountId {
  return `origin.${region.id}.in-transit.${cargo}`;
}

export interface ImportShipment {
  readonly region: OriginRegion;
  readonly cargo: string;
  readonly departureTick: number;
  readonly arrivalTick: number;
  readonly destinationAccount: AccountId;
  /** Total elemental mass actually shipped — informational only; the real
   * accounting is the posting `departShipment` applies. */
  readonly massUg: Micrograms;
}

function isElementCommodity(commodity: string): commodity is `el:${Element}` {
  return commodity.startsWith('el:');
}

export interface DepartShipmentOptions {
  readonly ledger: Ledger;
  readonly region: OriginRegion;
  /** An id naming this cargo, unique among simultaneous shipments from the
   * same region (e.g. `'cocoa-butter'` and `'cocoa-powder'`). */
  readonly cargo: string;
  /** Where the cargo currently sits, ready to depart — e.g. the finished
   * cocoa-butter stock account, not a shared region warehouse. */
  readonly sourceAccount: AccountId;
  readonly destinationAccount: AccountId;
  readonly departureTick: number;
  readonly secondsPerTick?: number;
  readonly process?: string;
}

/**
 * Depart everything currently held in `sourceAccount`, crediting it to a
 * dedicated in-transit account for this region-and-cargo pair and applying the
 * balanced transfer immediately (a departure is a completed transaction, the
 * same convention `agri/livestock.ts`'s `stockRation` uses for a delivery).
 * Returns the shipment record `receiveShipment` needs, and `undefined` if the
 * source account held nothing to ship.
 */
export function departShipment(options: DepartShipmentOptions): { posting: Posting; shipment: ImportShipment } | undefined {
  const { ledger, region, cargo, sourceAccount } = options;
  const inTransit = originInTransitAccount(region, cargo);
  if (!ledger.hasAccount(inTransit)) {
    ledger.openAccount({ id: inTransit, kind: 'stock', label: `${cargo} in transit from ${region.label}` });
  }

  const entries: Entry[] = [];
  let massUg: Micrograms = 0n;
  for (const [commodity, amount] of ledger.balances(sourceAccount)) {
    if (amount === 0n || !isElementCommodity(commodity)) continue;
    entries.push({ account: sourceAccount, commodity, delta: -amount });
    entries.push({ account: inTransit, commodity, delta: amount });
    massUg += amount;
  }
  if (entries.length === 0) return undefined;

  const posting: Posting = { process: options.process ?? `origin:ship:${region.id}:${cargo}`, entries };
  const applied = ledger.post(posting);

  const secondsPerTick = options.secondsPerTick ?? 1;
  const shipment: ImportShipment = {
    region,
    cargo,
    departureTick: options.departureTick,
    arrivalTick: options.departureTick + shippingDelayTicks(region, secondsPerTick),
    destinationAccount: options.destinationAccount,
    massUg,
  };
  return { posting: applied, shipment };
}

export class ShipmentNotYetArrivedError extends Error {
  constructor(readonly shipment: ImportShipment, readonly currentTick: number) {
    super(
      `shipment "${shipment.cargo}" from "${shipment.region.label}" (departed tick ${shipment.departureTick}) ` +
        `has not arrived: current tick ${currentTick} < arrival tick ${shipment.arrivalTick}`,
    );
    this.name = 'ShipmentNotYetArrivedError';
  }
}

/**
 * Move a shipment's cargo from its in-transit account into `shipment.
 * destinationAccount`, or throw `ShipmentNotYetArrivedError` if `currentTick`
 * has not yet reached `shipment.arrivalTick`. Real transit time is not a label
 * on the delivery, it is the reason the ledger genuinely refuses to let the
 * bakery draw on cargo that has not arrived yet.
 */
export function receiveShipment(ledger: Ledger, shipment: ImportShipment, currentTick: number, process?: string): Posting {
  if (currentTick < shipment.arrivalTick) {
    throw new ShipmentNotYetArrivedError(shipment, currentTick);
  }
  const inTransit = originInTransitAccount(shipment.region, shipment.cargo);
  const entries: Entry[] = [];
  for (const [commodity, amount] of ledger.balances(inTransit)) {
    if (amount === 0n || !isElementCommodity(commodity)) continue;
    entries.push({ account: inTransit, commodity, delta: -amount });
    entries.push({ account: shipment.destinationAccount, commodity, delta: amount });
  }
  const posting: Posting = { process: process ?? `origin:receive:${shipment.region.id}:${shipment.cargo}`, entries };
  return ledger.post(posting);
}
