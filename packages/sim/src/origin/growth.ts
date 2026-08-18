/**
 * Growing something in an origin region.
 *
 * Every tree, vine or plant this directory harvests from (cocoa, vanilla,
 * coffee, citrus, almond, strawberry, cherry, forage, sugar maple, grapevine)
 * is grown exactly the way `agri/`'s own wheat and sugar beet are: a real,
 * Liebig-limited `CropDefinition` tied to a real soil account via `agri/
 * field.ts`'s `Field`, ticked through a seeded, region-specific weather series
 * (`agri/field.ts`'s `generateSeasonalWeather`) until mature, then harvested
 * (`agri/harvest.ts`'s `splitStandingBiomass` + `addFieldMoisture`, both of
 * which `Field.harvest` already calls). This module owns none of that physics
 * — it only wires an `OriginRegion`'s soil and climate to it, so every origin
 * chain in this directory shares one real growth model instead of each
 * inventing its own.
 */

import type { Micrograms } from '../core/commodity.js';
import type { AccountId, Ledger } from '../core/ledger.js';
import type { Rng } from '../clock/rng.js';
import type { CropDefinition } from '../agri/crop.js';
import { Field, generateSeasonalWeather } from '../agri/field.js';
import { originReservoirAccount, type OriginRegion } from './region.js';

const SECONDS_PER_DAY = 86_400n;

export interface GrowAndHarvestOptions {
  readonly ledger: Ledger;
  readonly rng: Rng;
  readonly region: OriginRegion;
  readonly definition: CropDefinition;
  readonly fieldId: string;
  readonly biomassAccount: AccountId;
  readonly primaryAccount: AccountId;
  readonly residueAccount: AccountId;
  /** Ceiling on how many simulated days to grow before giving up — a generous
   * margin over what the crop's own `gddToMaturity` needs at the region's
   * climate, not a schedule. Defaults to 400, matching `scenario/firstChain.ts`'s
   * own margin for winter wheat. */
  readonly maxDays?: number;
  readonly dtSeconds?: bigint;
}

export interface GrowAndHarvestResult {
  readonly primaryDryMassUg: Micrograms;
  readonly residueMassUg: Micrograms;
  readonly waterAddedUg: Micrograms;
  readonly daysGrown: number;
}

/**
 * Plant, grow to maturity and harvest one crop in one origin region. Applies
 * every posting real growth and harvest requires directly to `ledger` (the same
 * "tick, apply, repeat" contract `Field.tick`/`Field.harvest` already have) and
 * returns the harvested organ's real dry mass and added field moisture.
 *
 * Throws if the crop does not reach maturity within `maxDays` — a sign the
 * region's climate or the crop's own parameters need adjustment, never a reason
 * to extend the timeout indefinitely (matching `scenario/firstChain.ts`'s own
 * failure mode for exactly this situation).
 */
export function growAndHarvest(options: GrowAndHarvestOptions): GrowAndHarvestResult {
  const { ledger, rng, region, definition } = options;
  if (region.kind !== 'crop' || !region.climate) {
    throw new RangeError(`region "${region.id}" is not a crop region with a climate`);
  }
  const maxDays = options.maxDays ?? 400;
  const dtSeconds = options.dtSeconds ?? SECONDS_PER_DAY;

  const field = new Field({
    id: options.fieldId,
    definition,
    soilAccount: originReservoirAccount(region),
    biomassAccount: options.biomassAccount,
    areaM2: region.areaM2,
  });
  field.plant();

  const weather = generateSeasonalWeather(rng, {
    days: maxDays,
    meanTemperatureC: region.climate.meanTemperatureC,
    temperatureAmplitudeC: region.climate.temperatureAmplitudeC,
    peakInsolationWPerM2: region.climate.peakInsolationWPerM2,
    meanRainfallMmPerDay: region.climate.meanRainfallMmPerDay,
    dayOfYearStart: region.climate.dayOfYearStart,
  });

  let day = 0;
  for (; day < weather.length && !field.readyForHarvest; day += 1) {
    const sample = weather[day];
    if (!sample) break;
    field.tick(ledger, sample, dtSeconds);
  }
  if (!field.readyForHarvest) {
    throw new Error(
      `"${definition.name}" did not reach maturity within ${maxDays} simulated days at ` +
        `"${region.label}" — the region's climate or the crop's parameters need adjustment, ` +
        'not a longer timeout',
    );
  }

  const harvest = field.harvest(ledger, options.primaryAccount, options.residueAccount);
  return {
    primaryDryMassUg: harvest.primaryDryMassUg,
    residueMassUg: harvest.residueMassUg,
    waterAddedUg: harvest.waterAddedUg,
    daysGrown: day,
  };
}
