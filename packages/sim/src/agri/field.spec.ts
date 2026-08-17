import { describe, expect, it } from 'vitest';

import { elementCommodity } from '../core/commodity.js';
import { Ledger } from '../core/ledger.js';
import { Rng } from '../clock/rng.js';
import { seedWorld, soilAccount } from '../world/accounts.js';
import { SUGAR_BEET, WINTER_WHEAT } from './crop.js';
import { Field, generateSeasonalWeather } from './field.js';

const BIOMASS = 'crop.biomass';
const GRAIN = 'grain.store';
const STRAW = 'straw.store';

function freshField(fieldName: string): { ledger: Ledger; field: Field } {
  const ledger = new Ledger();
  seedWorld(ledger, { fields: [fieldName] });
  ledger.openAccount({ id: BIOMASS, kind: 'stock', label: 'standing crop' });
  ledger.openAccount({ id: GRAIN, kind: 'stock', label: 'grain store' });
  ledger.openAccount({ id: STRAW, kind: 'stock', label: 'straw store' });

  const field = new Field({
    id: fieldName,
    definition: WINTER_WHEAT,
    soilAccount: soilAccount(fieldName),
    biomassAccount: BIOMASS,
    areaM2: 200_000n,
  });
  return { ledger, field };
}

describe('Field', () => {
  it('starts fallow and refuses to tick or harvest before planting', () => {
    const { ledger, field } = freshField('unplanted');
    expect(field.phase).toBe('fallow');

    const weather = { insolationWPerM2: 250, meanTemperatureC: 16, rainfallMmPerDay: 0 };
    const result = field.tick(ledger, weather, 86_400n);
    expect(result.postings).toEqual([]);

    expect(() => field.harvest(ledger, GRAIN, STRAW)).toThrow(/not ready/);
  });

  it('refuses to be planted twice without an intervening harvest', () => {
    const { field } = freshField('double-plant');
    field.plant();
    expect(() => field.plant()).toThrow(/not fallow/);
  });

  it('runs a full winter wheat season to maturity and harvest, staying balanced the whole way, with rainfall replenishing soil moisture', () => {
    const { ledger, field } = freshField('wheat-season');
    field.plant();

    const rng = Rng.fromSeed(2024);
    const weather = generateSeasonalWeather(rng, {
      days: 300,
      meanTemperatureC: 12,
      temperatureAmplitudeC: 8,
      peakInsolationWPerM2: 300,
      meanRainfallMmPerDay: 4,
      dayOfYearStart: 60, // start in early spring so warmth arrives soon
    });

    let day = 0;
    for (; day < weather.length && !field.readyForHarvest; day += 1) {
      const sample = weather[day];
      if (!sample) break;
      field.tick(ledger, sample, 86_400n);
      expect(ledger.audit().ok).toBe(true);
    }

    expect(field.readyForHarvest).toBe(true);
    expect(ledger.balance(BIOMASS, elementCommodity('C'))).toBeGreaterThan(0n);

    const outcome = field.harvest(ledger, GRAIN, STRAW);
    expect(ledger.audit().ok).toBe(true);
    expect(outcome.primaryDryMassUg).toBeGreaterThan(0n);
    expect(outcome.residueMassUg).toBeGreaterThan(0n);
    expect(outcome.waterAddedUg).toBeGreaterThan(0n);
    expect(field.phase).toBe('fallow');

    // The field can be planted again immediately.
    field.plant();
    expect(field.phase).toBe('growing');
  });

  it('runs a full sugar beet season to maturity and harvest, staying balanced the whole way', () => {
    const ledger = new Ledger();
    seedWorld(ledger, { fields: ['beet-season'] });
    ledger.openAccount({ id: BIOMASS, kind: 'stock', label: 'standing crop' });
    ledger.openAccount({ id: 'root.store', kind: 'stock', label: 'root store' });
    ledger.openAccount({ id: 'crown.store', kind: 'stock', label: 'crown store' });

    const field = new Field({
      id: 'beet-season',
      definition: SUGAR_BEET,
      soilAccount: soilAccount('beet-season'),
      biomassAccount: BIOMASS,
      areaM2: 200_000n,
    });
    field.plant();

    const rng = Rng.fromSeed(77);
    const weather = generateSeasonalWeather(rng, {
      days: 300,
      meanTemperatureC: 14,
      temperatureAmplitudeC: 7,
      peakInsolationWPerM2: 280,
      meanRainfallMmPerDay: 3,
      dayOfYearStart: 90,
    });

    for (let day = 0; day < weather.length && !field.readyForHarvest; day += 1) {
      const sample = weather[day];
      if (!sample) break;
      field.tick(ledger, sample, 86_400n);
      expect(ledger.audit().ok).toBe(true);
    }

    expect(field.readyForHarvest).toBe(true);
    const outcome = field.harvest(ledger, 'root.store', 'crown.store');
    expect(ledger.audit().ok).toBe(true);
    expect(outcome.primaryDryMassUg).toBeGreaterThan(0n);
    expect(outcome.residueMassUg).toBeGreaterThan(0n);
  });

  it('is deterministic: the same seed reproduces the same season, tick for tick', () => {
    const runSeason = (): { day: number; stage: string; gdd: number } => {
      const { ledger, field } = freshField('det-season');
      field.plant();
      const rng = Rng.fromSeed(123);
      const weather = generateSeasonalWeather(rng, {
        days: 250,
        meanTemperatureC: 14,
        temperatureAmplitudeC: 6,
        peakInsolationWPerM2: 260,
        meanRainfallMmPerDay: 3,
      });
      let day = 0;
      for (; day < weather.length && !field.readyForHarvest; day += 1) {
        const sample = weather[day];
        if (!sample) break;
        field.tick(ledger, sample, 86_400n);
      }
      return { day, stage: field.stage, gdd: field.gddAccumulated };
    };

    const a = runSeason();
    const b = runSeason();
    expect(a).toEqual(b);
  });
});

describe('generateSeasonalWeather', () => {
  it('is deterministic for a given seed and options', () => {
    const optionsA = {
      days: 30,
      meanTemperatureC: 10,
      temperatureAmplitudeC: 5,
      peakInsolationWPerM2: 250,
      meanRainfallMmPerDay: 2,
    };
    const seriesA = generateSeasonalWeather(Rng.fromSeed(5), optionsA);
    const seriesB = generateSeasonalWeather(Rng.fromSeed(5), optionsA);
    expect(seriesA).toEqual(seriesB);
  });

  it('produces the requested number of samples, all with non-negative insolation and rainfall', () => {
    const series = generateSeasonalWeather(Rng.fromSeed(9), {
      days: 40,
      meanTemperatureC: 8,
      temperatureAmplitudeC: 10,
      peakInsolationWPerM2: 300,
      meanRainfallMmPerDay: 5,
    });
    expect(series).toHaveLength(40);
    for (const sample of series) {
      expect(sample.insolationWPerM2).toBeGreaterThanOrEqual(0);
      expect(sample.rainfallMmPerDay).toBeGreaterThanOrEqual(0);
    }
  });
});
