/**
 * Agriculture: the upstream half of the closed chain. Everything here draws from and
 * returns to the finite accounts opened by `packages/sim/src/world`.
 */

export type {
  CropDefinition,
  CropGrowthParams,
  CropGrowthResult,
  CropStage,
  MineralElement,
} from './crop.js';
export {
  CROPS,
  MINERAL_ELEMENTS,
  SUGAR_BEET,
  WINTER_WHEAT,
  growCropTick,
  interceptionFraction,
  stageForGddFraction,
} from './crop.js';

export type {
  DryingParams,
  DryingResult,
  FieldMoistureParams,
  FieldMoistureResult,
  HarvestSplitResult,
} from './harvest.js';
export { addFieldMoisture, dryGrain, splitStandingBiomass } from './harvest.js';

export type {
  AnimalAccounts,
  AnimalDefinition,
  AnimalTickParams,
  AnimalTickResult,
  StockRationParams,
} from './livestock.js';
export { Animal, DAIRY_COW, LAYING_HEN, runAnimalTick, stockRation } from './livestock.js';

export type {
  FieldHarvestResult,
  FieldOptions,
  FieldPhase,
  FieldTickResult,
  SeasonalWeatherOptions,
  WeatherSample,
  WeatherSeries,
} from './field.js';
export { Field, generateSeasonalWeather } from './field.js';
