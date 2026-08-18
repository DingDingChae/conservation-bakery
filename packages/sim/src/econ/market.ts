/**
 * Prices that move — ingredient prices with the harvest and the season,
 * energy tariffs with the time of day. Every movement is deterministic from
 * an injected seeded `Rng` (see `clock/rng.ts`); nothing here ever reads
 * `Date.now()` or the wall clock. A price is advisory market data, not a
 * conserved quantity — it never touches `Ledger.post()` directly — but the
 * one place a price becomes an actual cash amount (`priceForMass`,
 * `energyBillMinorUnits`) rounds exactly once, the same discipline
 * `core/commodity.ts`'s `scale()`/`roundHalfEven()` boundary uses for every
 * other float-to-exact-integer conversion in this simulation, so the amount
 * that eventually reaches `ledgerAccounts.ts`'s postings is exact.
 */

import type { Micrograms } from '../core/commodity.js';
import { roundHalfEven } from '../core/commodity.js';
import type { Rng } from '../clock/rng.js';

const UG_PER_KG = 1_000_000_000;

/**
 * A real physical grounding for "money per exact mass": convert a rate priced
 * per kilogram into an exact cash amount for a ledger-exact mass. This is the
 * single rounding boundary between a market's floating-point price and the
 * bigint amount a caller eventually posts via `ledgerAccounts.ts`.
 */
export function priceForMass(pricePerKgMinorUnits: bigint, massUg: Micrograms): bigint {
  const kg = Number(massUg) / UG_PER_KG;
  return roundHalfEven(kg * Number(pricePerKgMinorUnits));
}

// ---------------------------------------------------------------------------
// Ingredient prices: seasonal and harvest-linked.
// ---------------------------------------------------------------------------

/** Jan .. Dec multiplier against `basePriceMinorUnitsPerKg`. */
export type MonthlyMultiplier = readonly [
  number, number, number, number, number, number,
  number, number, number, number, number, number,
];

export interface SeasonalPriceModel {
  readonly substanceId: string;
  readonly basePriceMinorUnitsPerKg: bigint;
  readonly monthlyMultiplier: MonthlyMultiplier;
  /** Day-to-day random-walk volatility, as a fraction of the current price. */
  readonly dailyVolatility: number;
}

/**
 * Illustrative seasonal shapes, not a fit to any real spot-price series. The
 * pattern each follows is the real, well-documented one for its commodity:
 * grain and sugar-beet-derived prices ease in the months right after their
 * autumn harvest and firm through the following "hungry gap" before the next
 * one; dairy and egg prices see a smaller, flatter seasonal swing because
 * livestock production is far less seasonal than an annual arable harvest.
 */
export const WHEAT_FLOUR_PRICE_MODEL: SeasonalPriceModel = {
  substanceId: 'wheat-flour-white',
  basePriceMinorUnitsPerKg: 60n,
  monthlyMultiplier: [1.08, 1.1, 1.12, 1.1, 1.05, 1.0, 0.95, 0.85, 0.8, 0.85, 0.92, 1.0],
  dailyVolatility: 0.01,
};

export const SUCROSE_PRICE_MODEL: SeasonalPriceModel = {
  substanceId: 'sucrose',
  basePriceMinorUnitsPerKg: 90n,
  monthlyMultiplier: [1.05, 1.05, 1.02, 1.0, 1.0, 1.0, 1.0, 1.05, 1.1, 0.95, 0.85, 0.9],
  dailyVolatility: 0.008,
};

export const BUTTER_PRICE_MODEL: SeasonalPriceModel = {
  substanceId: 'butter',
  basePriceMinorUnitsPerKg: 550n,
  monthlyMultiplier: [1.05, 1.02, 1.0, 0.98, 0.95, 0.95, 0.97, 1.0, 1.02, 1.05, 1.1, 1.15],
  dailyVolatility: 0.006,
};

export const HEN_EGG_PRICE_MODEL: SeasonalPriceModel = {
  substanceId: 'hen-egg-whole',
  basePriceMinorUnitsPerKg: 300n,
  monthlyMultiplier: [1.05, 1.02, 0.98, 0.95, 0.95, 0.98, 1.0, 1.0, 1.02, 1.05, 1.1, 1.15],
  dailyVolatility: 0.006,
};

/**
 * A poor harvest raises price, a bumper one lowers it — a standard, modest
 * inverse-supply simplification of agricultural commodity elasticity (real
 * markets also move on demand, storage and substitution effects this game
 * does not model). `actualYieldRatio` is this season's yield relative to a
 * normal one: 1.0 is normal, below 1 is a shortfall, above 1 is a surplus.
 * Clamped so a total crop condemnation cannot send the multiplier to
 * infinity, and a record surplus cannot send it to zero.
 */
export function harvestShockMultiplier(actualYieldRatio: number): number {
  const clamped = Math.max(0.2, Math.min(2, actualYieldRatio));
  return 1 / clamped;
}

/**
 * One ingredient's live price, evolving one simulated day at a time. Holds
 * its own `Rng` stream (fork one per market — see `Rng.fork()` — so adding or
 * removing a market never shifts another market's sequence) and only ever
 * advances when `advanceDay` is called, so the exact same call sequence
 * always reproduces the exact same price history.
 */
export class IngredientMarket {
  readonly model: SeasonalPriceModel;
  readonly #rng: Rng;
  #priceMinorUnitsPerKg: bigint;
  #month: number;

  constructor(model: SeasonalPriceModel, rng: Rng, startMonth = 0) {
    this.model = model;
    this.#rng = rng;
    this.#month = normalizeMonth(startMonth);
    this.#priceMinorUnitsPerKg = this.#seasonalBase(this.#month, 1);
  }

  get priceMinorUnitsPerKg(): bigint {
    return this.#priceMinorUnitsPerKg;
  }

  get month(): number {
    return this.#month;
  }

  #seasonalBase(month: number, harvestYieldRatio: number): bigint {
    const monthly = this.model.monthlyMultiplier[month] ?? 1;
    const shock = harvestShockMultiplier(harvestYieldRatio);
    return roundHalfEven(Number(this.model.basePriceMinorUnitsPerKg) * monthly * shock);
  }

  /**
   * Advance by one simulated day: draw exactly one deterministic random-walk
   * jitter from this market's own `Rng`, then blend halfway back toward the
   * season's own anchor price (a simple mean-reverting walk) so volatility
   * never permanently runs away from the real seasonal shape it is layered
   * on. `harvestYieldRatio` (default 1, a normal harvest) feeds
   * `harvestShockMultiplier`.
   */
  advanceDay(month: number, harvestYieldRatio = 1): void {
    this.#month = normalizeMonth(month);
    const seasonalBase = this.#seasonalBase(this.#month, harvestYieldRatio);
    const jitter = 1 + (this.#rng.nextFloat() * 2 - 1) * this.model.dailyVolatility;
    const drifted = Number(this.#priceMinorUnitsPerKg) * Math.max(0.1, jitter);
    const blended = (drifted + Number(seasonalBase)) / 2;
    this.#priceMinorUnitsPerKg = roundHalfEven(blended);
  }
}

function normalizeMonth(month: number): number {
  return ((Math.trunc(month) % 12) + 12) % 12;
}

// ---------------------------------------------------------------------------
// Energy tariffs: time-of-day, not randomised — real time-of-use tariffs are
// a fixed published schedule, not a stochastic process.
// ---------------------------------------------------------------------------

export interface EnergyTariffSchedule {
  readonly offPeakMinorUnitsPerKwh: bigint;
  readonly peakMinorUnitsPerKwh: bigint;
  /** Hour-of-day (0-23) the peak window starts. */
  readonly peakStartHour: number;
  /** Hour-of-day (0-23) the peak window ends, exclusive. */
  readonly peakEndHour: number;
}

/**
 * A representative shape, not one utility's published rate card: a
 * late-afternoon/early-evening peak window priced above the rest of the day,
 * the same structure real time-of-use commercial and industrial tariffs
 * commonly use (e.g. UK and US utility "peak"/"off-peak" day tariffs).
 */
export const TYPICAL_ENERGY_TARIFF: EnergyTariffSchedule = {
  offPeakMinorUnitsPerKwh: 18n,
  peakMinorUnitsPerKwh: 34n,
  peakStartHour: 16,
  peakEndHour: 20,
};

export function isPeakHour(schedule: EnergyTariffSchedule, hourOfDay: number): boolean {
  const hour = normalizeHour(hourOfDay);
  if (schedule.peakStartHour <= schedule.peakEndHour) {
    return hour >= schedule.peakStartHour && hour < schedule.peakEndHour;
  }
  return hour >= schedule.peakStartHour || hour < schedule.peakEndHour; // wraps past midnight
}

export function energyTariffMinorUnitsPerKwh(schedule: EnergyTariffSchedule, hourOfDay: number): bigint {
  return isPeakHour(schedule, hourOfDay) ? schedule.peakMinorUnitsPerKwh : schedule.offPeakMinorUnitsPerKwh;
}

/** Deterministic hour-of-day from a simulated tick count and a fixed
 * ticks-per-hour scale — never from the wall clock. */
export function hourOfDayFromTick(tick: number, ticksPerHour: number): number {
  if (!(ticksPerHour > 0)) throw new RangeError('ticksPerHour must be positive');
  return normalizeHour(Math.floor(tick / ticksPerHour));
}

function normalizeHour(hour: number): number {
  return ((Math.trunc(hour) % 24) + 24) % 24;
}

/** 1 kWh = 3.6 MJ = 3,600,000 J; `core/commodity.ts` stores energy as exact
 * microjoules, so this is that same figure scaled by 1,000,000. */
const UJ_PER_KWH = 3_600_000_000_000n;

/**
 * Convert an exact energy draw (microjoules, read straight off the ledger)
 * into an exact cash amount at a given tariff — the single rounding boundary
 * between the tariff's real rate and the exact amount a caller posts via
 * `ledgerAccounts.ts`'s `payEnergyBill`.
 */
export function energyBillMinorUnits(energyUj: bigint, tariffMinorUnitsPerKwh: bigint): bigint {
  const kwh = Number(energyUj) / Number(UJ_PER_KWH);
  return roundHalfEven(kwh * Number(tariffMinorUnitsPerKwh));
}
