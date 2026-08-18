import { describe, expect, it } from 'vitest';
import { grams } from '../core/commodity.js';
import { Rng } from '../clock/rng.js';
import {
  CANCELLATION_REASONS,
  DuplicateOrderError,
  InvalidOrderTransitionError,
  OrderBook,
  SEASONAL_HOLIDAYS,
  UnknownOrderError,
  contractDueTicks,
  generateContractOrder,
  generateDailyOrders,
  orderValueMinorUnits,
  seasonalDemandMultiplier,
  type Contract,
  type Customer,
  type Order,
} from './orders.js';

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    spec: { substanceId: 'baked-cake', quantityUg: grams(1000) },
    unitPriceMinorUnitsPerKg: 500n,
    placedTick: 0,
    dueTick: 10,
    status: 'pending',
    ...overrides,
  };
}

describe('orders: OrderBook lifecycle', () => {
  it('places, fulfils, and rejects an out-of-order transition', () => {
    const book = new OrderBook();
    book.place(baseOrder());
    expect(book.pending()).toHaveLength(1);

    const fulfilled = book.fulfill('order-1');
    expect(fulfilled.status).toBe('fulfilled');
    expect(book.pending()).toHaveLength(0);

    expect(() => book.fulfill('order-1')).toThrow(InvalidOrderTransitionError);
  });

  it('refuses a duplicate order id and an unknown order id', () => {
    const book = new OrderBook();
    book.place(baseOrder());
    expect(() => book.place(baseOrder())).toThrow(DuplicateOrderError);
    expect(() => book.fulfill('no-such-order')).toThrow(UnknownOrderError);
  });

  it('cancels a pending order with a recorded, specification-only reason', () => {
    const book = new OrderBook();
    book.place(baseOrder());
    const cancelled = book.cancel('order-1', CANCELLATION_REASONS.customerRequest);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancellationReason).toBe(CANCELLATION_REASONS.customerRequest);
  });

  it('lapses only pending orders whose due date has passed', () => {
    const book = new OrderBook();
    book.place(baseOrder({ id: 'a', dueTick: 5 }));
    book.place(baseOrder({ id: 'b', dueTick: 50 }));
    book.place(baseOrder({ id: 'c', dueTick: 5 }));
    book.fulfill('c'); // already fulfilled -- must not lapse

    const lapsed = book.lapseOverdue(10);
    expect(lapsed.map((o) => o.id)).toEqual(['a']);
    expect(book.get('b')?.status).toBe('pending');
    expect(book.get('c')?.status).toBe('fulfilled');
  });
});

describe('orders: value and seasonal demand', () => {
  it('computes the exact cash value of an order from its price and quantity', () => {
    const order = baseOrder({ unitPriceMinorUnitsPerKg: 500n, spec: { substanceId: 'baked-cake', quantityUg: grams(2000) } });
    expect(orderValueMinorUnits(order)).toBe(1000n);
  });

  it('peaks demand on a holiday and tapers off with distance from it', () => {
    const holiday = SEASONAL_HOLIDAYS.find((h) => h.name === 'winter-holiday')!;
    const onDay = seasonalDemandMultiplier(holiday.dayOfYear);
    const nearDay = seasonalDemandMultiplier(holiday.dayOfYear - 3);
    const farDay = seasonalDemandMultiplier(holiday.dayOfYear - holiday.rampDays - 30);

    expect(onDay).toBeCloseTo(holiday.peakMultiplier, 5);
    expect(onDay).toBeGreaterThan(nearDay);
    expect(nearDay).toBeGreaterThan(farDay);
    expect(farDay).toBeCloseTo(1, 5);
  });

  it('wraps the year circularly around day zero', () => {
    // new-year is day 0; late December should still show meaningful uplift.
    const lateDecember = seasonalDemandMultiplier(363);
    expect(lateDecember).toBeGreaterThan(1);
  });
});

describe('orders: contracts', () => {
  it('generates one due tick per interval, inclusive of the bound', () => {
    const contract: Contract = {
      id: 'weekly-cafe',
      customerId: 'cafe-1',
      spec: { substanceId: 'baked-cake', quantityUg: grams(5000) },
      unitPriceMinorUnitsPerKg: 400n,
      intervalTicks: 7,
      firstDueTick: 7,
      leadTicks: 2,
    };
    expect(contractDueTicks(contract, 21)).toEqual([7, 14, 21]);

    const order = generateContractOrder(contract, 14, 'weekly-cafe:14');
    expect(order.dueTick).toBe(14);
    expect(order.placedTick).toBe(12);
    expect(order.status).toBe('pending');
  });
});

describe('orders: deterministic generation', () => {
  const customers: readonly Customer[] = [
    { id: 'c1', name: 'Corner cafe' },
    { id: 'c2', name: 'Downtown grocer' },
    { id: 'c3', name: 'Wedding planner' },
  ];

  it('produces the exact same daily order book from the same seed', () => {
    const params = {
      customers,
      spec: { substanceId: 'baked-cake', quantityUg: grams(1000) },
      unitPriceMinorUnitsPerKg: 500n,
      dayOfYear: 358, // winter holiday peak
      tick: 100,
      leadTicks: 3,
      baseOrdersPerDay: 4,
      quantityJitter: 0.2,
    };
    const a = generateDailyOrders(Rng.fromSeed(99), params, 'day');
    const b = generateDailyOrders(Rng.fromSeed(99), params, 'day');
    expect(a).toEqual(b);
  });

  it('generates more orders, on average, around a holiday than on an ordinary day', () => {
    const holidayParams = {
      customers,
      spec: { substanceId: 'baked-cake', quantityUg: grams(1000) },
      unitPriceMinorUnitsPerKg: 500n,
      dayOfYear: 358,
      tick: 0,
      leadTicks: 3,
      baseOrdersPerDay: 3,
      quantityJitter: 0.1,
    };
    const ordinaryParams = { ...holidayParams, dayOfYear: 200 };

    const rng = Rng.fromSeed(11);
    let holidayTotal = 0;
    let ordinaryTotal = 0;
    for (let i = 0; i < 200; i += 1) {
      holidayTotal += generateDailyOrders(rng, { ...holidayParams, tick: i }, `h${i}`).length;
      ordinaryTotal += generateDailyOrders(rng, { ...ordinaryParams, tick: i }, `o${i}`).length;
    }
    expect(holidayTotal).toBeGreaterThan(ordinaryTotal);
  });
});
