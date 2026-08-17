/**
 * A field: a crop tied to a soil account, an area, and a weather series, ticked
 * through planting, growth and harvest.
 *
 * `Field` itself never touches the ledger except through `growCropTick`'s and
 * `splitStandingBiomass`'s returned postings, applied here via `ledger.post` -- the
 * same "build, then apply" separation `world/exchange.ts` uses. Rainfall is the one
 * exception: it is this module's own, simple genesis-free water-cycle exchange
 * (atmosphere condensing onto soil), built the same way every other balanced
 * transfer in this codebase is.
 */

import type { AccountId, Ledger, Posting } from '../core/ledger.js';
import { elementCommodity, kilograms } from '../core/commodity.js';
import type { Micrograms } from '../core/commodity.js';
import { MOLAR_MASS, WORLD_ACCOUNTS } from '../world/accounts.js';
import { condense } from '../world/exchange.js';
import type { Rng } from '../clock/rng.js';
import type { CropDefinition, CropStage } from './crop.js';
import { growCropTick } from './crop.js';
import { addFieldMoisture, splitStandingBiomass } from './harvest.js';

/** Mass fraction of water's own hydrogen: 2 * M(H) / M(H2O). Used only to bound how
 * much of a rainfall target the atmosphere's own hydrogen balance could really
 * supply -- see the identical reasoning in `crop.ts`. */
const WATER_HYDROGEN_MASS_FRACTION = (2 * MOLAR_MASS.H) / (2 * MOLAR_MASS.H + MOLAR_MASS.O);

function floorMicrograms(value: number): Micrograms {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value));
}

function minBig(a: Micrograms, b: Micrograms): Micrograms {
  return a < b ? a : b;
}

const SECONDS_PER_DAY = 86_400;
/** 1 mm of rain over 1 m^2 is 1 litre, i.e. 1 kilogram of water. */
const WATER_KG_PER_MM_PER_M2 = 1;

export interface WeatherSample {
  readonly insolationWPerM2: number;
  readonly meanTemperatureC: number;
  readonly rainfallMmPerDay: number;
}

export type WeatherSeries = readonly WeatherSample[];

export interface SeasonalWeatherOptions {
  readonly days: number;
  readonly meanTemperatureC: number;
  readonly temperatureAmplitudeC: number;
  readonly peakInsolationWPerM2: number;
  readonly meanRainfallMmPerDay: number;
  /** Day of year (0..364) the series' first sample falls on. */
  readonly dayOfYearStart?: number;
}

/**
 * A simple deterministic seasonal weather generator: sinusoidal temperature and
 * insolation over the year, perturbed by a seeded day-to-day jitter, plus
 * intermittent rainfall. All randomness comes from `rng`, so the same seed and the
 * same options always produce the same series.
 */
export function generateSeasonalWeather(rng: Rng, options: SeasonalWeatherOptions): WeatherSample[] {
  const dayOfYearStart = options.dayOfYearStart ?? 0;
  const samples: WeatherSample[] = [];
  for (let i = 0; i < options.days; i += 1) {
    const dayOfYear = (dayOfYearStart + i) % 365;
    const angle = (2 * Math.PI * dayOfYear) / 365;
    // Trough at day 0 (deep winter), peak at day ~182 (midsummer).
    const seasonalFactor = -Math.cos(angle);

    const temperatureJitter = (rng.nextFloat() - 0.5) * 4; // +/- 2 deg C daily noise
    const meanTemperatureC =
      options.meanTemperatureC + options.temperatureAmplitudeC * seasonalFactor + temperatureJitter;

    const daylightFactor = Math.max(0, seasonalFactor * 0.5 + 0.5); // 0..1, mirrors the season
    const cloudFactor = 0.6 + rng.nextFloat() * 0.4; // 0.6..1.0
    const insolationWPerM2 = options.peakInsolationWPerM2 * daylightFactor * cloudFactor;

    const rains = rng.nextFloat() < 0.3;
    const rainfallMmPerDay = rains ? options.meanRainfallMmPerDay * (0.5 + rng.nextFloat()) : 0;

    samples.push({ insolationWPerM2, meanTemperatureC, rainfallMmPerDay });
  }
  return samples;
}

export type FieldPhase = 'fallow' | 'growing' | 'ready' | 'harvested';

export interface FieldOptions {
  readonly id: string;
  readonly definition: CropDefinition;
  readonly soilAccount: AccountId;
  readonly biomassAccount: AccountId;
  readonly areaM2: bigint;
  readonly atmosphereAccount?: AccountId;
  readonly sunAccount?: AccountId;
}

export interface FieldTickResult {
  readonly postings: readonly Posting[];
  readonly stage: CropStage;
  readonly dryMatterGrownUg: Micrograms;
}

export interface FieldHarvestResult {
  readonly primaryDryMassUg: Micrograms;
  readonly residueMassUg: Micrograms;
  readonly waterAddedUg: Micrograms;
}

/**
 * A field ties a crop to a soil account, an area, and a weather series, and exposes
 * the planting/growing/harvest cycle as tick-driven state. All state here (phase,
 * accumulated growing-degree-days, stage) is presentation of what the ledger already
 * recorded via applied postings -- nothing here is a second, competing source of
 * truth for conserved mass.
 */
export class Field {
  readonly id: string;
  readonly definition: CropDefinition;
  readonly soilAccount: AccountId;
  readonly biomassAccount: AccountId;
  readonly areaM2: bigint;
  readonly #atmosphereAccount: AccountId;
  readonly #sunAccount: AccountId;

  #phase: FieldPhase = 'fallow';
  #gddAccumulated = 0;
  #stage: CropStage = 'planted';

  constructor(options: FieldOptions) {
    this.id = options.id;
    this.definition = options.definition;
    this.soilAccount = options.soilAccount;
    this.biomassAccount = options.biomassAccount;
    this.areaM2 = options.areaM2;
    this.#atmosphereAccount = options.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere;
    this.#sunAccount = options.sunAccount ?? WORLD_ACCOUNTS.sun;
  }

  get phase(): FieldPhase {
    return this.#phase;
  }

  get stage(): CropStage {
    return this.#stage;
  }

  get gddAccumulated(): number {
    return this.#gddAccumulated;
  }

  get readyForHarvest(): boolean {
    return this.#phase === 'ready';
  }

  plant(): void {
    if (this.#phase !== 'fallow') {
      throw new Error(`field "${this.id}" is not fallow and cannot be planted`);
    }
    this.#phase = 'growing';
    this.#gddAccumulated = 0;
    this.#stage = 'planted';
  }

  /**
   * Advance the field by one tick: apply rainfall to the soil, then grow the crop.
   * Every posting either step produces is applied to `ledger` before this returns.
   */
  tick(ledger: Ledger, weather: WeatherSample, dtSeconds: bigint): FieldTickResult {
    const postings: Posting[] = [];

    const rainPosting = this.#rainfallPosting(ledger, weather, dtSeconds);
    if (rainPosting) {
      ledger.post(rainPosting);
      postings.push(rainPosting);
    }

    if (this.#phase !== 'growing') {
      return { postings, stage: this.#stage, dryMatterGrownUg: 0n };
    }

    const result = growCropTick({
      ledger,
      definition: this.definition,
      biomassAccount: this.biomassAccount,
      soilAccount: this.soilAccount,
      atmosphereAccount: this.#atmosphereAccount,
      sunAccount: this.#sunAccount,
      areaM2: this.areaM2,
      gddAccumulated: this.#gddAccumulated,
      insolationWPerM2: weather.insolationWPerM2,
      meanTemperatureC: weather.meanTemperatureC,
      dtSeconds,
    });

    for (const posting of result.postings) ledger.post(posting);
    postings.push(...result.postings);

    this.#gddAccumulated = result.gddAccumulated;
    this.#stage = result.stage;
    if (this.#stage === 'mature') this.#phase = 'ready';

    return { postings, stage: this.#stage, dryMatterGrownUg: result.dryMatterGrownUg };
  }

  /**
   * Harvest a mature field: split standing biomass into the harvested organ and
   * residue, then bring the harvested organ up to field moisture content. Returns
   * the field to `fallow`, ready to be planted again.
   */
  harvest(ledger: Ledger, primaryAccount: AccountId, residueAccount: AccountId): FieldHarvestResult {
    if (this.#phase !== 'ready') {
      throw new Error(`field "${this.id}" is not ready for harvest`);
    }

    const split = splitStandingBiomass(
      ledger,
      this.definition,
      this.biomassAccount,
      primaryAccount,
      residueAccount,
      `agri:harvest:${this.id}`,
    );
    ledger.post(split.posting);

    const moisture = addFieldMoisture({
      ledger,
      definition: this.definition,
      primaryAccount,
      soilAccount: this.soilAccount,
      dryMassUg: split.primaryMassUg,
      process: `agri:harvest:${this.id}:moisture`,
    });
    if (moisture.posting.entries.length > 0) ledger.post(moisture.posting);

    this.#phase = 'fallow';
    this.#gddAccumulated = 0;
    this.#stage = 'planted';

    return {
      primaryDryMassUg: split.primaryMassUg,
      residueMassUg: split.residueMassUg,
      waterAddedUg: moisture.waterAddedUg,
    };
  }

  #rainfallPosting(ledger: Ledger, weather: WeatherSample, dtSeconds: bigint): Posting | undefined {
    if (weather.rainfallMmPerDay <= 0) return undefined;
    const dtDays = Number(dtSeconds) / SECONDS_PER_DAY;
    const targetKg = weather.rainfallMmPerDay * Number(this.areaM2) * WATER_KG_PER_MM_PER_M2 * dtDays;
    const targetUg = kilograms(targetKg);
    if (targetUg <= 0n) return undefined;

    const availableAtmosphereH = ledger.balance(this.#atmosphereAccount, elementCommodity('H'));
    const ceilingUg = floorMicrograms(Number(availableAtmosphereH) / WATER_HYDROGEN_MASS_FRACTION);
    const waterMass = minBig(targetUg, ceilingUg);
    if (waterMass <= 0n) return undefined;

    return condense({
      waterAccount: this.soilAccount,
      atmosphereAccount: this.#atmosphereAccount,
      waterMass,
      process: `agri:rainfall:${this.id}`,
    });
  }
}
