/**
 * A cross-cutting check that every random-driven path in `econ/` is
 * deterministic from an injected seeded `Rng`: market prices, order
 * generation, and regulator inspection sampling. Each module's own spec file
 * also checks this for its own functions; this file exists so the property
 * is asserted once, together, for the whole module, rather than only
 * incidentally alongside each function's other tests.
 */
import { describe, expect, it } from 'vitest';
import { grams } from '../core/commodity.js';
import { Rng } from '../clock/rng.js';
import { IngredientMarket, WHEAT_FLOUR_PRICE_MODEL } from './market.js';
import { generateDailyOrders, type Customer, type OrderGenerationParams } from './orders.js';
import { inspect } from './regulator.js';
import type { HaccpPlan, TemperatureLogEntry } from './quality.js';

function runMarket(seed: number): readonly bigint[] {
  const market = new IngredientMarket(WHEAT_FLOUR_PRICE_MODEL, Rng.fromSeed(seed));
  const prices: bigint[] = [];
  for (let day = 0; day < 400; day += 1) {
    market.advanceDay(Math.floor(day / 30) % 12, 1 - 0.3 * Math.sin(day / 17));
    prices.push(market.priceMinorUnitsPerKg);
  }
  return prices;
}

function runOrders(seed: number): unknown {
  const customers: readonly Customer[] = [
    { id: 'c1', name: 'Corner cafe' },
    { id: 'c2', name: 'Downtown grocer' },
  ];
  const rng = Rng.fromSeed(seed);
  const days: unknown[] = [];
  for (let day = 0; day < 60; day += 1) {
    const params: OrderGenerationParams = {
      customers,
      spec: { substanceId: 'baked-cake', quantityUg: grams(1000) },
      unitPriceMinorUnitsPerKg: 500n,
      dayOfYear: day * 6,
      tick: day,
      leadTicks: 3,
      baseOrdersPerDay: 3,
      quantityJitter: 0.15,
    };
    days.push(generateDailyOrders(rng, params, `day${day}`));
  }
  return days;
}

function runInspections(seed: number): unknown {
  const plan: HaccpPlan = {
    id: 'plan-1',
    ccps: [{ id: 'core-temp', description: 'core bake temperature', parameter: 'core-temperature-c', minValue: 90, maxValue: 220 }],
  };
  const log: TemperatureLogEntry[] = Array.from({ length: 60 }, (_, i) => ({
    tick: i,
    ccpId: 'core-temp',
    valueC: i % 11 === 0 ? 60 : 160,
  }));
  const rng = Rng.fromSeed(seed);
  const results: unknown[] = [];
  for (let tick = 0; tick < 20; tick += 1) {
    results.push(inspect(plan, log, 'realistic', rng, tick));
  }
  return results;
}

describe('econ determinism', () => {
  it('market prices replay identically from the same seed', () => {
    expect(runMarket(2024)).toEqual(runMarket(2024));
  });

  it('market prices diverge from a different seed', () => {
    expect(runMarket(2024)).not.toEqual(runMarket(2025));
  });

  it('generated order books replay identically from the same seed', () => {
    expect(runOrders(555)).toEqual(runOrders(555));
  });

  it('generated order books diverge from a different seed', () => {
    expect(runOrders(555)).not.toEqual(runOrders(556));
  });

  it('regulator inspections replay identically from the same seed', () => {
    expect(runInspections(77)).toEqual(runInspections(77));
  });

  it('regulator inspections diverge from a different seed', () => {
    expect(runInspections(77)).not.toEqual(runInspections(78));
  });
});
