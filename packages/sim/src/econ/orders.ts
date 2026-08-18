/**
 * Customers, orders, contracts and the seasonal demand that shapes them.
 *
 * An `Order` is business data, not a conserved quantity — it never touches
 * `Ledger.post()` itself. Fulfilling one is the caller's job (a real,
 * ledgered shipment posting elsewhere, then `ledgerAccounts.ts`'s
 * `recordSale` for the cash side); this module only tracks what was
 * promised, to whom, by when, and whether it was kept. Every random draw
 * (which customer, how much, how many orders land on a given day) comes from
 * an injected seeded `Rng` — never `Math.random()`, never the wall clock —
 * so the exact same seed and call order always produce the exact same book
 * of orders.
 */

import type { Micrograms } from '../core/commodity.js';
import { roundHalfEven } from '../core/commodity.js';
import type { Rng } from '../clock/rng.js';
import { priceForMass } from './market.js';

export interface Customer {
  readonly id: string;
  readonly name: string;
}

export type OrderStatus = 'pending' | 'fulfilled' | 'cancelled' | 'lapsed';

export interface OrderSpecification {
  readonly substanceId: string;
  readonly quantityUg: Micrograms;
}

export interface Order {
  readonly id: string;
  readonly customerId: string;
  readonly spec: OrderSpecification;
  readonly unitPriceMinorUnitsPerKg: bigint;
  readonly placedTick: number;
  readonly dueTick: number;
  readonly status: OrderStatus;
  /** Set only once `status` is `'cancelled'`. */
  readonly cancellationReason?: string;
}

/** The cash amount this order is worth at its agreed price — the exact
 * amount `ledgerAccounts.ts`'s `recordSale` should post once it ships. */
export function orderValueMinorUnits(order: Order): bigint {
  return priceForMass(order.unitPriceMinorUnitsPerKg, order.spec.quantityUg);
}

export class DuplicateOrderError extends Error {
  constructor(readonly orderId: string) {
    super(`order "${orderId}" already exists in this order book`);
    this.name = 'DuplicateOrderError';
  }
}

export class UnknownOrderError extends Error {
  constructor(readonly orderId: string) {
    super(`no order "${orderId}" in this order book`);
    this.name = 'UnknownOrderError';
  }
}

export class InvalidOrderTransitionError extends Error {
  constructor(
    readonly orderId: string,
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`order "${orderId}" cannot move from "${from}" to "${to}" — it is not pending`);
    this.name = 'InvalidOrderTransitionError';
  }
}

/** Reasons an order can end without being fulfilled. Plain scheduling and
 * specification language only — see CONTRACT.md rule 2. */
export const CANCELLATION_REASONS = {
  customerRequest: 'the customer requested cancellation',
  specificationChange: 'the specification changed before fulfilment',
  supplyShortfall: 'an input shortfall meant the order could not be filled by its due date',
} as const;

/**
 * The live book of orders. A thin, ledger-independent state machine:
 * `pending -> fulfilled | cancelled | lapsed`, each transition legal only
 * from `pending`. Deterministic and side-effect-free — it never itself calls
 * `Ledger.post()`.
 */
export class OrderBook {
  readonly #orders = new Map<string, Order>();

  place(order: Order): void {
    if (this.#orders.has(order.id)) throw new DuplicateOrderError(order.id);
    this.#orders.set(order.id, order);
  }

  get(id: string): Order | undefined {
    return this.#orders.get(id);
  }

  all(): readonly Order[] {
    return [...this.#orders.values()];
  }

  pending(): readonly Order[] {
    return this.all().filter((order) => order.status === 'pending');
  }

  fulfill(id: string): Order {
    return this.#transition(id, 'fulfilled');
  }

  cancel(id: string, reason: string): Order {
    const order = this.#orders.get(id);
    if (!order) throw new UnknownOrderError(id);
    if (order.status !== 'pending') throw new InvalidOrderTransitionError(id, order.status, 'cancelled');
    const next: Order = { ...order, status: 'cancelled', cancellationReason: reason };
    this.#orders.set(id, next);
    return next;
  }

  /** Orders past their due date and still pending become lapsed — never
   * fulfilled in time. A scheduling outcome only; returns everything that
   * lapsed this call so a caller can react (refund, re-offer, etc). */
  lapseOverdue(tick: number): readonly Order[] {
    const lapsed: Order[] = [];
    for (const order of this.#orders.values()) {
      if (order.status === 'pending' && order.dueTick < tick) {
        const next: Order = { ...order, status: 'lapsed' };
        this.#orders.set(order.id, next);
        lapsed.push(next);
      }
    }
    return lapsed;
  }

  #transition(id: string, to: OrderStatus): Order {
    const order = this.#orders.get(id);
    if (!order) throw new UnknownOrderError(id);
    if (order.status !== 'pending') throw new InvalidOrderTransitionError(id, order.status, to);
    const next: Order = { ...order, status: to };
    this.#orders.set(id, next);
    return next;
  }
}

// ---------------------------------------------------------------------------
// Standing contracts: a recurring order at a fixed interval.
// ---------------------------------------------------------------------------

export interface Contract {
  readonly id: string;
  readonly customerId: string;
  readonly spec: OrderSpecification;
  readonly unitPriceMinorUnitsPerKg: bigint;
  readonly intervalTicks: number;
  readonly firstDueTick: number;
  /** How far ahead of its due date each cycle's order is placed. */
  readonly leadTicks: number;
}

/** Every due tick a contract has generated an order for, up to and including
 * `throughTick`. */
export function contractDueTicks(contract: Contract, throughTick: number): readonly number[] {
  if (contract.intervalTicks <= 0) throw new RangeError('a contract interval must be positive');
  const due: number[] = [];
  for (let tick = contract.firstDueTick; tick <= throughTick; tick += contract.intervalTicks) {
    due.push(tick);
  }
  return due;
}

export function generateContractOrder(contract: Contract, dueTick: number, orderId: string): Order {
  return {
    id: orderId,
    customerId: contract.customerId,
    spec: contract.spec,
    unitPriceMinorUnitsPerKg: contract.unitPriceMinorUnitsPerKg,
    placedTick: dueTick - contract.leadTicks,
    dueTick,
    status: 'pending',
  };
}

// ---------------------------------------------------------------------------
// Seasonal demand around holidays.
// ---------------------------------------------------------------------------

export interface HolidayDemand {
  readonly name: string;
  /** 0-indexed day of a 365-day reference year. */
  readonly dayOfYear: number;
  readonly peakMultiplier: number;
  /** How many days out the uplift is still felt, ramping linearly to the peak. */
  readonly rampDays: number;
}

/**
 * Real, named bakery-relevant occasions and the shape of demand uplift
 * bakeries typically see building toward them — illustrative multipliers, not
 * a fit to any specific retailer's sales data, but the pattern (a build-up
 * peaking on the day, tapering afterward) is the real, well-known one.
 */
export const SEASONAL_HOLIDAYS: readonly HolidayDemand[] = [
  { name: 'new-year', dayOfYear: 0, peakMultiplier: 1.3, rampDays: 5 },
  { name: 'valentines-day', dayOfYear: 44, peakMultiplier: 1.6, rampDays: 6 },
  { name: 'easter', dayOfYear: 100, peakMultiplier: 1.5, rampDays: 10 },
  { name: 'thanksgiving', dayOfYear: 327, peakMultiplier: 1.4, rampDays: 7 },
  { name: 'winter-holiday', dayOfYear: 358, peakMultiplier: 1.9, rampDays: 14 },
];

function circularDayDistance(a: number, b: number, yearLength: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, yearLength - diff);
}

/** How much above baseline (1.0) demand runs on a given day of year, from the
 * nearest holiday whose ramp reaches it. Multiple overlapping ramps take the
 * larger uplift rather than stacking, so demand never compounds unrealistically
 * across two nearby occasions. */
export function seasonalDemandMultiplier(
  dayOfYear: number,
  holidays: readonly HolidayDemand[] = SEASONAL_HOLIDAYS,
  yearLength = 365,
): number {
  const day = ((Math.trunc(dayOfYear) % yearLength) + yearLength) % yearLength;
  let multiplier = 1;
  for (const holiday of holidays) {
    const distance = circularDayDistance(day, holiday.dayOfYear, yearLength);
    if (distance > holiday.rampDays) continue;
    const closeness = 1 - distance / holiday.rampDays;
    const boost = 1 + (holiday.peakMultiplier - 1) * closeness;
    multiplier = Math.max(multiplier, boost);
  }
  return multiplier;
}

// ---------------------------------------------------------------------------
// Deterministic order generation.
// ---------------------------------------------------------------------------

/**
 * Draw a Poisson-distributed count with mean `lambda`, using Knuth's 1969
 * algorithm — exact, and consumes a deterministic, bounded number of draws
 * from `rng` for any given `lambda` and seed state.
 */
function poissonDraw(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng.nextFloat();
  } while (p > limit);
  return k - 1;
}

function scaleMicrograms(base: Micrograms, factor: number): Micrograms {
  return roundHalfEven(Number(base) * factor);
}

export interface OrderGenerationParams {
  readonly customers: readonly Customer[];
  readonly spec: OrderSpecification;
  readonly unitPriceMinorUnitsPerKg: bigint;
  readonly dayOfYear: number;
  readonly tick: number;
  readonly leadTicks: number;
  readonly baseOrdersPerDay: number;
  /** Day-to-day quantity variation, as a +/- fraction, drawn per order. */
  readonly quantityJitter: number;
}

/**
 * Generate one simulated day's worth of new orders: how many arrive scales
 * with `seasonalDemandMultiplier`, which customer places each one and its
 * exact quantity are both drawn from `rng`. Every draw this function makes is
 * from the same injected stream, in the same fixed order, so replaying the
 * same seed through the same sequence of calls reproduces the identical book.
 */
export function generateDailyOrders(rng: Rng, params: OrderGenerationParams, idPrefix: string): Order[] {
  const demandMultiplier = seasonalDemandMultiplier(params.dayOfYear);
  const expectedOrders = params.baseOrdersPerDay * demandMultiplier;
  const orderCount = poissonDraw(rng, expectedOrders);

  const orders: Order[] = [];
  for (let i = 0; i < orderCount; i += 1) {
    if (params.customers.length === 0) break;
    const customer = params.customers[rng.nextInt(params.customers.length)];
    if (!customer) continue;
    const jitter = 1 + (rng.nextFloat() * 2 - 1) * params.quantityJitter;
    const quantityUg = scaleMicrograms(params.spec.quantityUg, Math.max(0.1, jitter));
    orders.push({
      id: `${idPrefix}:${params.tick}:${i}`,
      customerId: customer.id,
      spec: { substanceId: params.spec.substanceId, quantityUg },
      unitPriceMinorUnitsPerKg: params.unitPriceMinorUnitsPerKg,
      placedTick: params.tick,
      dueTick: params.tick + params.leadTicks,
      status: 'pending',
    });
  }
  return orders;
}
