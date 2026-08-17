import { describe, expect, it } from 'vitest';

import { elementCommodity, grams } from '../core/commodity.js';
import { Ledger } from '../core/ledger.js';
import { WORLD_ACCOUNTS, seedWorld } from '../world/accounts.js';
import {
  coolingRateConstantPerS,
  gabMoisture,
  retrogradationExtent,
  retrogradationRateConstantPerHour,
  shelfLifeHours,
  stepCooling,
  stepStalingMoistureLoss,
  waterActivityFromMoisture,
} from './staling.js';

describe('stepCooling', () => {
  it('exponentially decays toward ambient temperature', () => {
    const k = coolingRateConstantPerS(15, 0.1, 0.5, 3000);
    const after = stepCooling(200, 20, k, 60);
    expect(after).toBeLessThan(200);
    expect(after).toBeGreaterThan(20);
  });

  it('reaches ambient in the limit of a very long time', () => {
    const k = coolingRateConstantPerS(15, 0.1, 0.5, 3000);
    const after = stepCooling(200, 20, k, 1_000_000);
    expect(after).toBeCloseTo(20, 3);
  });

  it('rejects a negative timestep', () => {
    expect(() => stepCooling(100, 20, 0.01, -1)).toThrow(RangeError);
  });
});

describe('retrogradation', () => {
  it('is fastest just above freezing, slower at room temperature, and effectively halted when frozen', () => {
    const fridge = retrogradationRateConstantPerHour(4);
    const room = retrogradationRateConstantPerHour(21);
    const frozen = retrogradationRateConstantPerHour(-10);
    expect(fridge).toBeGreaterThan(room);
    expect(room).toBeGreaterThan(frozen);
  });

  it('starts at zero and rises toward 1 over time', () => {
    expect(retrogradationExtent(0, 21)).toBe(0);
    expect(retrogradationExtent(200, 21)).toBeGreaterThan(0.9);
  });

  it('shelfLifeHours is the exact inverse of retrogradationExtent at a fixed temperature', () => {
    const tempC = 21;
    const threshold = 0.4;
    const hours = shelfLifeHours(tempC, threshold);
    expect(retrogradationExtent(hours, tempC)).toBeCloseTo(threshold, 6);
  });

  it('refrigerated bread stales faster (shorter shelf life) than room-temperature bread', () => {
    expect(shelfLifeHours(4)).toBeLessThan(shelfLifeHours(21));
  });

  it('rejects a threshold outside (0, 1)', () => {
    expect(() => shelfLifeHours(21, 0)).toThrow(RangeError);
    expect(() => shelfLifeHours(21, 1)).toThrow(RangeError);
  });
});

describe('GAB water activity isotherm', () => {
  it('round-trips: waterActivityFromMoisture(gabMoisture(aw)) recovers aw', () => {
    for (const aw of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const moisture = gabMoisture(aw);
      const recovered = waterActivityFromMoisture(moisture);
      expect(recovered).toBeCloseTo(aw, 4);
    }
  });

  it('moisture content increases monotonically with water activity', () => {
    expect(gabMoisture(0.8)).toBeGreaterThan(gabMoisture(0.4));
  });

  it('is zero water activity for zero moisture', () => {
    expect(waterActivityFromMoisture(0)).toBe(0);
  });
});

describe('stepStalingMoistureLoss', () => {
  it('is undefined for a packaged product regardless of moisture remaining', () => {
    const result = stepStalingMoistureLoss({
      productAccount: 'loaf',
      moistureRemainingUg: grams(100),
      surfaceAreaM2: 0.05,
      dtSeconds: 3600,
      packaged: true,
    });
    expect(result).toBeUndefined();
  });

  it('posts a real, balanced evaporation for an unpackaged product with moisture', () => {
    const ledger = new Ledger();
    ledger.openAccount({ id: 'loaf', kind: 'stock', label: 'test loaf' });
    seedWorld(ledger, { fields: ['test-field'] });

    const result = stepStalingMoistureLoss({
      productAccount: 'loaf',
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      moistureRemainingUg: grams(100),
      surfaceAreaM2: 0.05,
      dtSeconds: 3600,
      packaged: false,
    });
    expect(result).toBeDefined();
    expect(result?.evaporatedMassUg).toBeGreaterThan(0n);
    expect(result?.evaporatedMassUg).toBeLessThanOrEqual(grams(100));

    // The posting only touches H and O, in real water molar-mass ratio, and
    // is exactly balanced (nothing invented, nothing lost).
    const posting = result!.posting;
    const sums = new Map<string, bigint>();
    for (const entry of posting.entries) {
      sums.set(entry.commodity, (sums.get(entry.commodity) ?? 0n) + entry.delta);
    }
    for (const [, residual] of sums) expect(residual).toBe(0n);
    expect(sums.has(elementCommodity('H'))).toBe(true);
    expect(sums.has(elementCommodity('O'))).toBe(true);
  });

  it('caps evaporated mass at what remains for a small moisture budget', () => {
    const result = stepStalingMoistureLoss({
      productAccount: 'loaf',
      moistureRemainingUg: 1n,
      surfaceAreaM2: 5, // deliberately large area to force the cap
      dtSeconds: 3600,
      packaged: false,
    });
    expect(result?.evaporatedMassUg).toBe(1n);
  });
});
