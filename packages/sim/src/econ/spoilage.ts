/**
 * Spoilage: mould growth, fat rancidity and stored-grain pest pressure, as
 * real (if simplified) functions of water activity and temperature over
 * time. Every outcome here is a product outcome — spoiled, rancid, infested,
 * condemned — never a person's health; see CONTRACT.md rule 2.
 *
 * Every function in this file is pure and deterministic: given the same
 * conditions and the same elapsed time, it returns the same index, every
 * time. There is no randomness here at all, which trivially satisfies this
 * module's determinism requirement — spoilage is a physical process, not a
 * roll of the dice.
 */

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** A [0, 1] rate factor: 0 outside an organism's cardinal range, rising to 1
 * at its optimum on either side of a peak. This is a deliberately simplified
 * piecewise-linear stand-in for the bell-shaped cardinal-temperature growth
 * models used in real predictive microbiology (e.g. Rosso et al., 1995,
 * "Convenient Model To Describe the Combined Effects of Temperature and pH on
 * Microbial Growth") — the real shape (zero below a minimum, a peak at an
 * optimum, zero again above a maximum) without that model's full nonlinear
 * form.
 */
export function temperatureFactor(tempC: number, tMinC: number, tOptC: number, tMaxC: number): number {
  if (tempC <= tMinC || tempC >= tMaxC) return 0;
  if (tempC <= tOptC) return clamp01((tempC - tMinC) / (tOptC - tMinC));
  return clamp01((tMaxC - tempC) / (tMaxC - tOptC));
}

export interface SpoilageStep {
  readonly index: number;
  readonly condemned: boolean;
}

function stepIndex(previousIndex: number, ratePerSecond: number, dtSeconds: number, threshold: number): SpoilageStep {
  const index = Math.max(0, previousIndex + ratePerSecond * dtSeconds);
  return { index, condemned: index >= threshold };
}

// ---------------------------------------------------------------------------
// Mould growth: water activity and temperature.
// ---------------------------------------------------------------------------

export interface SpoilageConditions {
  /** Water activity, 0-1 (not percent moisture content — the thermodynamic
   * availability of water for microbial growth). */
  readonly waterActivity: number;
  readonly temperatureC: number;
}

/**
 * Composite cardinal parameters for common bakery-relevant mould genera
 * (Aspergillus, Penicillium, Eurotium): most bakery moulds need a water
 * activity above roughly 0.80-0.88 to grow at all, with growth becoming
 * fastest as aw approaches 1 (see e.g. ICMSF, "Microorganisms in Foods 5",
 * and Gibson, Bratchell & Roberts, 1994, on aw as a growth-limiting factor);
 * mesophilic mould growth is fastest around 25-30C. These are illustrative,
 * order-of-magnitude figures for a representative bakery mould, not a fit to
 * one named organism.
 */
const MOULD_AW_MIN = 0.8;
const MOULD_AW_OPT = 0.98;
const MOULD_T_MIN_C = 5;
const MOULD_T_OPT_C = 30;
const MOULD_T_MAX_C = 45;

/** 0 at or below the minimum water activity a mould can grow at, rising
 * linearly to 1 at (and above) its optimum. Real growth curves flatten
 * rather than keep rising past the optimum; holding at 1 above it is this
 * model's simplification. */
export function waterActivityFactor(aw: number, awMin = MOULD_AW_MIN, awOpt = MOULD_AW_OPT): number {
  if (aw <= awMin) return 0;
  if (aw >= awOpt) return 1;
  return clamp01((aw - awMin) / (awOpt - awMin));
}

export function mouldGrowthRateFactor(conditions: SpoilageConditions): number {
  return (
    waterActivityFactor(conditions.waterActivity) *
    temperatureFactor(conditions.temperatureC, MOULD_T_MIN_C, MOULD_T_OPT_C, MOULD_T_MAX_C)
  );
}

/** An index of 1 represents visible, condemnable mould growth — a round
 * reference point chosen for this game's pacing, not a microbiological
 * spore-count threshold. */
export const MOULD_CONDEMNATION_INDEX = 1;

/** At fully optimum water activity and temperature, a real soft bakery
 * product can show visible mould within roughly one to a few days at room
 * temperature — this constant reaches the condemnation index in exactly two
 * simulated days under those conditions, a real, fast-spoiling order of
 * magnitude for an unpreserved bakery product. */
const MOULD_GROWTH_PER_SECOND_AT_OPTIMUM = 1 / (2 * 86_400);

export function stepMouldGrowth(
  previousIndex: number,
  conditions: SpoilageConditions,
  dtSeconds: number,
): SpoilageStep {
  const rate = mouldGrowthRateFactor(conditions) * MOULD_GROWTH_PER_SECOND_AT_OPTIMUM;
  return stepIndex(previousIndex, rate, dtSeconds, MOULD_CONDEMNATION_INDEX);
}

// ---------------------------------------------------------------------------
// Rancidity in stored fat: Arrhenius-style temperature sensitivity.
// ---------------------------------------------------------------------------

/**
 * Lipid oxidation (rancidity) is well described as an Arrhenius-kinetic
 * process; a common working approximation in food-storage engineering is
 * that its rate — and so the inverse of time-to-onset — roughly doubles for
 * every ~10C rise (a Q10 ~ 2 rule of thumb; see e.g. Labuza, "Shelf-Life
 * Dating of Foods", 1982, for the general Q10 treatment of lipid oxidation
 * kinetics). This module anchors that scaling at one reference temperature
 * and a real order-of-magnitude reference shelf life for stored butterfat at
 * cool room temperature, rather than a fitted Arrhenius activation energy
 * for one specific fat.
 */
const RANCIDITY_REFERENCE_TEMP_C = 20;
const RANCIDITY_Q10 = 2;
const RANCIDITY_REFERENCE_DAYS_TO_ONSET = 90;

export function rancidityRateFactor(temperatureC: number): number {
  const exponent = (temperatureC - RANCIDITY_REFERENCE_TEMP_C) / 10;
  return Math.pow(RANCIDITY_Q10, exponent);
}

export const RANCIDITY_CONDEMNATION_INDEX = 1;

export function stepRancidity(previousIndex: number, temperatureC: number, dtSeconds: number): SpoilageStep {
  const referenceRatePerSecond = 1 / (RANCIDITY_REFERENCE_DAYS_TO_ONSET * 86_400);
  const rate = referenceRatePerSecond * rancidityRateFactor(temperatureC);
  return stepIndex(previousIndex, rate, dtSeconds, RANCIDITY_CONDEMNATION_INDEX);
}

// ---------------------------------------------------------------------------
// Pest pressure on stored grain: temperature and grain moisture content.
// ---------------------------------------------------------------------------

/**
 * Stored-grain insect pests (e.g. the grain weevil, Sitophilus granarius, and
 * related stored-product beetles) essentially stop developing below roughly
 * 15C, develop fastest around 28-30C, and need grain moisture content above
 * roughly 11% (wet basis) to sustain a population — commonly cited cardinal
 * ranges in stored-product entomology (see e.g. Hagstrum & Subramanyam,
 * "Fundamentals of Stored-Product Entomology", 2006).
 */
const PEST_MIN_TEMP_C = 15;
const PEST_OPT_TEMP_C = 29;
const PEST_MAX_TEMP_C = 42;
const PEST_MIN_MOISTURE_CONTENT = 0.11;
const PEST_OPT_MOISTURE_CONTENT = 0.17;

export interface GrainStoreConditions {
  readonly temperatureC: number;
  /** Grain moisture content, wet basis, as a fraction (e.g. 0.14 = 14%). */
  readonly moistureContent: number;
}

export function pestPressureRateFactor(conditions: GrainStoreConditions): number {
  const tempFactor = temperatureFactor(conditions.temperatureC, PEST_MIN_TEMP_C, PEST_OPT_TEMP_C, PEST_MAX_TEMP_C);
  const moistureFactor =
    conditions.moistureContent <= PEST_MIN_MOISTURE_CONTENT
      ? 0
      : clamp01(
          (conditions.moistureContent - PEST_MIN_MOISTURE_CONTENT) /
            (PEST_OPT_MOISTURE_CONTENT - PEST_MIN_MOISTURE_CONTENT),
        );
  return tempFactor * moistureFactor;
}

export const PEST_CONDEMNATION_INDEX = 1;

/** A stored-grain infestation takes real weeks, not hours, to build to a
 * condemnable level even at optimal temperature and moisture — thirty
 * simulated days at fully optimum conditions is a real, conservative
 * order-of-magnitude figure for this. */
const PEST_GROWTH_PER_SECOND_AT_OPTIMUM = 1 / (30 * 86_400);

export function stepPestPressure(
  previousIndex: number,
  conditions: GrainStoreConditions,
  dtSeconds: number,
): SpoilageStep {
  const rate = pestPressureRateFactor(conditions) * PEST_GROWTH_PER_SECOND_AT_OPTIMUM;
  return stepIndex(previousIndex, rate, dtSeconds, PEST_CONDEMNATION_INDEX);
}
