import { describe, expect, it } from 'vitest';
import { Rng } from '../clock/rng.js';
import {
  IngredientMarket,
  TYPICAL_ENERGY_TARIFF,
  WHEAT_FLOUR_PRICE_MODEL,
  energyBillMinorUnits,
  energyTariffMinorUnitsPerKwh,
  harvestShockMultiplier,
  hourOfDayFromTick,
  isPeakHour,
  priceForMass,
} from './market.js';

describe('market: ingredient prices', () => {
  it('is deterministic: the same seed and call sequence reproduce the same price path', () => {
    const a = new IngredientMarket(WHEAT_FLOUR_PRICE_MODEL, Rng.fromSeed(42));
    const b = new IngredientMarket(WHEAT_FLOUR_PRICE_MODEL, Rng.fromSeed(42));
    const pricesA: bigint[] = [];
    const pricesB: bigint[] = [];
    for (let day = 0; day < 60; day += 1) {
      a.advanceDay(day % 12);
      b.advanceDay(day % 12);
      pricesA.push(a.priceMinorUnitsPerKg);
      pricesB.push(b.priceMinorUnitsPerKg);
    }
    expect(pricesA).toEqual(pricesB);
  });

  it('a different seed produces a different price path', () => {
    // A single day's heavily mean-reverting, low-volatility, integer-rounded
    // price can coincidentally land on the same value from two different
    // seeds; comparing the whole path over many days makes that collision
    // astronomically unlikely without weakening what is actually being
    // checked (two independent streams really do diverge).
    const a = new IngredientMarket(WHEAT_FLOUR_PRICE_MODEL, Rng.fromSeed(1));
    const b = new IngredientMarket(WHEAT_FLOUR_PRICE_MODEL, Rng.fromSeed(2));
    const pricesA: bigint[] = [];
    const pricesB: bigint[] = [];
    for (let day = 0; day < 60; day += 1) {
      a.advanceDay(day % 12);
      b.advanceDay(day % 12);
      pricesA.push(a.priceMinorUnitsPerKg);
      pricesB.push(b.priceMinorUnitsPerKg);
    }
    expect(pricesA).not.toEqual(pricesB);
  });

  it('stays strictly positive and within a sane band of the base price over a long run', () => {
    const market = new IngredientMarket(WHEAT_FLOUR_PRICE_MODEL, Rng.fromSeed(7));
    for (let day = 0; day < 2000; day += 1) {
      market.advanceDay(Math.floor(day / 30) % 12);
      expect(market.priceMinorUnitsPerKg).toBeGreaterThan(0n);
      // The mean-reverting walk should never wander outside a generous band
      // of the model's seasonal anchor, even over a long run.
      expect(market.priceMinorUnitsPerKg).toBeLessThan(WHEAT_FLOUR_PRICE_MODEL.basePriceMinorUnitsPerKg * 3n);
    }
  });

  it('a poor harvest raises the multiplier, a bumper one lowers it, both clamped', () => {
    expect(harvestShockMultiplier(1)).toBeCloseTo(1, 10);
    expect(harvestShockMultiplier(0.5)).toBeGreaterThan(1);
    expect(harvestShockMultiplier(2)).toBeLessThan(1);
    expect(harvestShockMultiplier(0.01)).toBeCloseTo(harvestShockMultiplier(0.2), 10); // clamps at 0.2
    expect(harvestShockMultiplier(100)).toBeCloseTo(harvestShockMultiplier(2), 10); // clamps at 2
  });

  it('priceForMass rounds to an exact bigint and scales linearly with mass', () => {
    const oneKgUg = 1_000_000_000n;
    expect(priceForMass(60n, oneKgUg)).toBe(60n);
    expect(priceForMass(60n, oneKgUg * 2n)).toBe(120n);
    expect(priceForMass(60n, 0n)).toBe(0n);
  });
});

describe('market: energy tariffs', () => {
  it('is peak only within the configured window, and off-peak otherwise', () => {
    expect(isPeakHour(TYPICAL_ENERGY_TARIFF, 15)).toBe(false);
    expect(isPeakHour(TYPICAL_ENERGY_TARIFF, 16)).toBe(true);
    expect(isPeakHour(TYPICAL_ENERGY_TARIFF, 19)).toBe(true);
    expect(isPeakHour(TYPICAL_ENERGY_TARIFF, 20)).toBe(false);
  });

  it('charges the peak rate only during peak hours', () => {
    expect(energyTariffMinorUnitsPerKwh(TYPICAL_ENERGY_TARIFF, 8)).toBe(TYPICAL_ENERGY_TARIFF.offPeakMinorUnitsPerKwh);
    expect(energyTariffMinorUnitsPerKwh(TYPICAL_ENERGY_TARIFF, 18)).toBe(TYPICAL_ENERGY_TARIFF.peakMinorUnitsPerKwh);
  });

  it('derives hour-of-day from tick count, never from the wall clock', () => {
    expect(hourOfDayFromTick(0, 60)).toBe(0);
    expect(hourOfDayFromTick(59, 60)).toBe(0);
    expect(hourOfDayFromTick(60, 60)).toBe(1);
    expect(hourOfDayFromTick(60 * 25, 60)).toBe(1); // wraps past 24 hours
  });

  it('bills an exact energy draw at an exact tariff', () => {
    // 1 kWh = 3.6e12 uJ exactly.
    const oneKwhUj = 3_600_000_000_000n;
    expect(energyBillMinorUnits(oneKwhUj, 18n)).toBe(18n);
    expect(energyBillMinorUnits(oneKwhUj * 2n, 18n)).toBe(36n);
    expect(energyBillMinorUnits(0n, 18n)).toBe(0n);
  });
});
