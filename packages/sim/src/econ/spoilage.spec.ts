import { describe, expect, it } from 'vitest';
import {
  MOULD_CONDEMNATION_INDEX,
  PEST_CONDEMNATION_INDEX,
  RANCIDITY_CONDEMNATION_INDEX,
  mouldGrowthRateFactor,
  pestPressureRateFactor,
  rancidityRateFactor,
  stepMouldGrowth,
  stepPestPressure,
  stepRancidity,
  temperatureFactor,
  waterActivityFactor,
} from './spoilage.js';

const ONE_DAY_SECONDS = 86_400;

describe('spoilage: water activity and temperature response', () => {
  it('waterActivityFactor is zero at or below the minimum and saturates at the optimum', () => {
    expect(waterActivityFactor(0.5, 0.8, 0.98)).toBe(0);
    expect(waterActivityFactor(0.8, 0.8, 0.98)).toBe(0);
    expect(waterActivityFactor(0.98, 0.8, 0.98)).toBe(1);
    expect(waterActivityFactor(1, 0.8, 0.98)).toBe(1);
  });

  it('waterActivityFactor is monotonically increasing between its bounds', () => {
    const samples = [0.82, 0.85, 0.9, 0.95, 0.97];
    const values = samples.map((aw) => waterActivityFactor(aw));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });

  it('temperatureFactor is zero outside the cardinal range and peaks at the optimum', () => {
    expect(temperatureFactor(0, 5, 30, 45)).toBe(0);
    expect(temperatureFactor(50, 5, 30, 45)).toBe(0);
    expect(temperatureFactor(30, 5, 30, 45)).toBe(1);
    expect(temperatureFactor(17.5, 5, 30, 45)).toBeCloseTo(0.5, 5);
  });

  it('mould growth is zero when water activity is below the growth threshold, regardless of temperature', () => {
    const dry = { waterActivity: 0.5, temperatureC: 30 };
    expect(mouldGrowthRateFactor(dry)).toBe(0);
    const step = stepMouldGrowth(0, dry, ONE_DAY_SECONDS * 30);
    expect(step.index).toBe(0);
    expect(step.condemned).toBe(false);
  });

  it('mould growth is zero when temperature is outside the cardinal range, regardless of water activity', () => {
    const cold = { waterActivity: 0.98, temperatureC: -5 };
    expect(mouldGrowthRateFactor(cold)).toBe(0);
  });

  it('higher water activity at the same temperature grows the mould index faster', () => {
    const lowAw = stepMouldGrowth(0, { waterActivity: 0.85, temperatureC: 25 }, ONE_DAY_SECONDS);
    const highAw = stepMouldGrowth(0, { waterActivity: 0.97, temperatureC: 25 }, ONE_DAY_SECONDS);
    expect(highAw.index).toBeGreaterThan(lowAw.index);
  });

  it('reaches condemnation under fully favourable conditions within the modelled timescale', () => {
    let index = 0;
    for (let day = 0; day < 5 && index < MOULD_CONDEMNATION_INDEX; day += 1) {
      index = stepMouldGrowth(index, { waterActivity: 0.99, temperatureC: 30 }, ONE_DAY_SECONDS).index;
    }
    expect(index).toBeGreaterThanOrEqual(MOULD_CONDEMNATION_INDEX);
  });

  it('the index never decreases and never runs negative', () => {
    let index = 0;
    for (let i = 0; i < 10; i += 1) {
      const next = stepMouldGrowth(index, { waterActivity: 0.3, temperatureC: -10 }, ONE_DAY_SECONDS);
      expect(next.index).toBeGreaterThanOrEqual(index);
      index = next.index;
    }
    expect(index).toBe(0);
  });
});

describe('spoilage: rancidity', () => {
  it('roughly doubles its rate for every 10C rise, per the Q10 approximation', () => {
    const rate20 = rancidityRateFactor(20);
    const rate30 = rancidityRateFactor(30);
    const rate10 = rancidityRateFactor(10);
    expect(rate30 / rate20).toBeCloseTo(2, 5);
    expect(rate20 / rate10).toBeCloseTo(2, 5);
  });

  it('a hotter store reaches rancidity condemnation sooner than a cooler one', () => {
    let hot = 0;
    let cool = 0;
    let hotDays = 0;
    let coolDays = 0;
    for (let day = 0; hot < RANCIDITY_CONDEMNATION_INDEX || cool < RANCIDITY_CONDEMNATION_INDEX; day += 1) {
      if (hot < RANCIDITY_CONDEMNATION_INDEX) {
        hot = stepRancidity(hot, 35, ONE_DAY_SECONDS).index;
        hotDays += 1;
      }
      if (cool < RANCIDITY_CONDEMNATION_INDEX) {
        cool = stepRancidity(cool, 5, ONE_DAY_SECONDS).index;
        coolDays += 1;
      }
      if (day > 2000) throw new Error('rancidity test did not converge');
    }
    expect(hotDays).toBeLessThan(coolDays);
  });
});

describe('spoilage: stored-grain pest pressure', () => {
  it('is zero below the minimum moisture content, regardless of temperature', () => {
    const dryGrain = { temperatureC: 29, moistureContent: 0.08 };
    expect(pestPressureRateFactor(dryGrain)).toBe(0);
  });

  it('is zero below the minimum temperature, regardless of moisture content', () => {
    const coldGrain = { temperatureC: 5, moistureContent: 0.16 };
    expect(pestPressureRateFactor(coldGrain)).toBe(0);
  });

  it('grows fastest near the optimum temperature and moisture content', () => {
    const optimal = pestPressureRateFactor({ temperatureC: 29, moistureContent: 0.17 });
    const marginal = pestPressureRateFactor({ temperatureC: 18, moistureContent: 0.12 });
    expect(optimal).toBeGreaterThan(marginal);
    expect(optimal).toBeGreaterThan(0);
  });

  it('reaches condemnation under fully favourable conditions within the modelled timescale', () => {
    let index = 0;
    for (let day = 0; day < 60 && index < PEST_CONDEMNATION_INDEX; day += 1) {
      index = stepPestPressure(index, { temperatureC: 29, moistureContent: 0.17 }, ONE_DAY_SECONDS).index;
    }
    expect(index).toBeGreaterThanOrEqual(PEST_CONDEMNATION_INDEX);
  });
});

describe('spoilage: determinism', () => {
  it('is a pure function of its inputs -- repeated calls with the same inputs give identical results', () => {
    const conditions = { waterActivity: 0.9, temperatureC: 22 };
    const first = stepMouldGrowth(0.2, conditions, 3_600);
    const second = stepMouldGrowth(0.2, conditions, 3_600);
    expect(first).toEqual(second);

    const rancidFirst = stepRancidity(0.1, 25, 3_600);
    const rancidSecond = stepRancidity(0.1, 25, 3_600);
    expect(rancidFirst).toEqual(rancidSecond);

    const pestConditions = { temperatureC: 28, moistureContent: 0.15 };
    const pestFirst = stepPestPressure(0.3, pestConditions, 3_600);
    const pestSecond = stepPestPressure(0.3, pestConditions, 3_600);
    expect(pestFirst).toEqual(pestSecond);
  });
});
