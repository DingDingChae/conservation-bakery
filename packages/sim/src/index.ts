/**
 * `@conservation-bakery/sim` — the deterministic, exactly-conserved
 * simulation core. No DOM, no Electron, no I/O beyond the one sanctioned
 * substance-data load (see `substance/registry.ts`). See
 * `docs/ARCHITECTURE.md` for "the seam" this package's public surface exists
 * to protect: a renderer observes simulation state through the exports
 * below, it never reaches past them into a module's own internals.
 *
 * This file is deliberately curated, not a blanket `export *` of every
 * module — each section below re-exports only what a renderer, a save/load
 * system, or a replay tool actually needs to drive and observe the
 * simulation.
 */

// ---------------------------------------------------------------------------
// core — the reviewed seam every other module is built against.
// ---------------------------------------------------------------------------
export type {
  CashCommodity,
  CommodityId,
  Composition,
  Element,
  ElementCommodity,
  EnergyCommodity,
  Microjoules,
  Micrograms,
} from './core/commodity.js';
export {
  ELEMENTS,
  ELEMENT_COMMODITIES,
  ENERGY,
  cashCommodity,
  elementCommodity,
  emptyComposition,
  addComposition,
  compositionMass,
  compositionsEqual,
  grams,
  isElement,
  joules,
  kilograms,
  megajoules,
  partition,
  roundHalfEven,
  scale,
  tonnes,
  UG_PER_G,
  UG_PER_KG,
  UG_PER_MG,
  UG_PER_TONNE,
  UJ_PER_J,
  UJ_PER_KJ,
  UJ_PER_MJ,
} from './core/commodity.js';

export type {
  AccountId,
  AccountKind,
  AccountSpec,
  AppliedPosting,
  AuditDiscrepancy,
  AuditReport,
  Entry,
  LedgerOptions,
  Posting,
} from './core/ledger.js';
export {
  GENESIS,
  Ledger,
  NegativeStockError,
  SealedLedgerError,
  UnbalancedPostingError,
  UnknownAccountError,
} from './core/ledger.js';

// ---------------------------------------------------------------------------
// clock — determinism: seeded RNG, fixed-step clock, journal, digest.
// ---------------------------------------------------------------------------
export type { RngState } from './clock/rng.js';
export { Rng } from './clock/rng.js';
export type { Speed, TickContext, TickSystem } from './clock/clock.js';
export { Clock, SPEEDS, isSpeed } from './clock/clock.js';
export type { Digestible } from './clock/digest.js';
export { canonicalize, digest, fnv1a64 } from './clock/digest.js';
export type { Command, RunHeader, RunRecord } from './clock/journal.js';
export { Journal } from './clock/journal.js';

// ---------------------------------------------------------------------------
// world — the planetary layer: finite, sourced reservoirs and the balanced
// exchanges (combustion, respiration, photosynthesis, evaporation,
// condensation) that move material between them.
// ---------------------------------------------------------------------------
export type { SeedWorldOptions } from './world/accounts.js';
export { MOLAR_MASS, WORLD_ACCOUNTS, seedWorld, soilAccount, splitMolecule } from './world/accounts.js';
export type {
  CombustionParams,
  PhotosynthesisParams,
  RespirationParams,
  WaterTransferParams,
} from './world/exchange.js';
export { combustMethane, condense, evaporate, photosynthesize, respire } from './world/exchange.js';

// ---------------------------------------------------------------------------
// substance — validated content: elemental compositions for every named
// ingredient, packaging material and gas this simulation tracks.
// ---------------------------------------------------------------------------
export type { SubstanceRecord } from './substance/registry.js';
export { SubstanceRegistry, UnknownSubstanceError, defaultSubstanceRegistry, getComposition, getSubstance } from './substance/registry.js';

// ---------------------------------------------------------------------------
// process — the control-layer framework every machine faceplate is driven by.
// ---------------------------------------------------------------------------
export type { CommandResult } from './process/result.js';
export { accepted, refused } from './process/result.js';
export type { MachineDefinition, MachineMode, TagDefinition, TagKind } from './process/machine.js';
export { Machine } from './process/machine.js';
export type { Interlock, InterlockCondition } from './process/interlock.js';
export { evaluateInterlock, evaluateInterlocks } from './process/interlock.js';
export type { AlarmDefinition, AlarmState } from './process/alarm.js';
export { Alarm, AlarmGroup } from './process/alarm.js';
export type { TrendSample } from './process/trend.js';
export { TrendBuffer } from './process/trend.js';
export type { ComponentDefinition, ComponentKind, EquipmentEvent } from './process/failure.js';
export { WearComponent, createSeededRng } from './process/failure.js';
export type { PidGains, PidLimits, PidMode } from './process/pid.js';
export { PidController } from './process/pid.js';

// ---------------------------------------------------------------------------
// provenance — the lot graph: a human-facing, derived view of how material
// moved, and the closure audit that a lot's declared parentage is honest.
// ---------------------------------------------------------------------------
export type { Lot, LotCreationSpec, LotId, LotLoss, ParentContribution, SubstanceId } from './provenance/lot.js';
export { decodeLotCreations, deriveLotId, encodeLotCreations } from './provenance/lot.js';
export type { AncestorResult, DescendantResult, ProvenanceEdge, WalkOptions } from './provenance/graph.js';
export { LotGraph } from './provenance/graph.js';
export type { ClosureFailure, ClosureReport } from './provenance/closure.js';
export { checkGraphClosure, checkLotClosure } from './provenance/closure.js';

// ---------------------------------------------------------------------------
// agri — crops, livestock, growth, harvest: the upstream half of the chain.
// ---------------------------------------------------------------------------
export type { CropDefinition, CropStage, MineralElement } from './agri/crop.js';
export { CROPS, MINERAL_ELEMENTS, SUGAR_BEET, WINTER_WHEAT, growCropTick } from './agri/crop.js';
export type { DryingResult, HarvestSplitResult } from './agri/harvest.js';
export { addFieldMoisture, dryGrain, splitStandingBiomass } from './agri/harvest.js';
export type { AnimalAccounts, AnimalDefinition, AnimalTickResult } from './agri/livestock.js';
export { Animal, DAIRY_COW, LAYING_HEN, runAnimalTick, stockRation } from './agri/livestock.js';
export type { FieldHarvestResult, FieldOptions, FieldPhase, FieldTickResult, WeatherSample, WeatherSeries } from './agri/field.js';
export { Field, generateSeasonalWeather } from './agri/field.js';

// ---------------------------------------------------------------------------
// plant — unit operations that turn farm output into bakery ingredients.
// ---------------------------------------------------------------------------
export type { ProcessFlow, ProcessStep, ProcessUnitConfig, StreamProfile } from './plant/unit.js';
export { ProcessUnit, UnbalancedProcessError, buildProcessPosting, splitByProfile } from './plant/unit.js';
export type { MillBatchResult, MillCompositions, MillYields } from './plant/mill.js';
export { createMill, millGrain } from './plant/mill.js';
export type { ChurnCreamYields, SeparateMilkYields } from './plant/creamery.js';
export { PASTEURIZATION_HOLD_TEMP_C, churnCream, createCreamery, pasteurize, separateMilk } from './plant/creamery.js';
export type { RefineBatchResult, RefineCompositions, RefineYields } from './plant/refinery.js';
export { createRefinery, refineSugarBeet } from './plant/refinery.js';

// ---------------------------------------------------------------------------
// bake — the physical chemistry of baking: formulation, mixing, leavening,
// oven heat transfer, time-temperature reactions, and what follows a bake.
// ---------------------------------------------------------------------------
export type { Formulation, FormulationIngredient, FormulationMetrics, FormulationValidation, IngredientRole } from './bake/formulation.js';
export { evaluateFormulation, resolveFormulation, validateFormulation } from './bake/formulation.js';
export type { MixBatterResult } from './bake/batter.js';
export { batterSpecificHeat, glutenPrecursorFromNitrogen, mixBatter, totalMass } from './bake/batter.js';
export type { ChemicalLeaveningResult, FermentationResult } from './bake/leavening.js';
export { fermentGlucose, reactBakingSoda, ventGas } from './bake/leavening.js';
export type { HeatDelivery, HeatFluxResult, OvenHeatSource } from './bake/oven.js';
export { deliverHeat, heatFluxes } from './bake/oven.js';
export type { GasExpansionResult, StructuralExtents, ThermalStepResult } from './bake/transform.js';
export {
  advanceExtent,
  co2VolumeM3,
  crustColor,
  eggCoagulationFraction,
  evaluateGasExpansion,
  glutenCoagulationFraction,
  postMoistureLoss,
  starchGelatinisationFraction,
  stepBrowning,
  stepThermal,
  structuralSetFraction,
} from './bake/transform.js';
export type { GabParameters } from './bake/staling.js';
export {
  coolingRateConstantPerS,
  gabMoisture,
  retrogradationExtent,
  shelfLifeHours,
  stepCooling,
  stepStalingMoistureLoss,
  waterActivityFromMoisture,
} from './bake/staling.js';

// ---------------------------------------------------------------------------
// scenario — the first complete provenance loop, genesis to shipped cake.
// ---------------------------------------------------------------------------
export type { FirstChainAccounts, FirstChainOutcome, FirstChainRunResult, FirstChainSeed, FirstChainStep, RootLotRecord } from './scenario/index.js';
export { FirstChainScenario, ROOT_LOT_IDS, digestFirstChainState, runFirstChain } from './scenario/index.js';
