/**
 * The cake designer: is a proposed cake physically real? See `types.ts` for the data
 * model, and `structure.ts`/`thermal.ts`/`feasibility.ts`/`cost.ts` for the four real
 * verdicts `evaluate.ts` combines into one acceptance decision.
 */

export type {
  CakeDesign,
  DesignFilling,
  DesignFinish,
  DesignLayer,
  DesignTier,
  DesignTopper,
  FinishKind,
  ThermalContext,
} from './types.js';
export { FINISH_KINDS, tierOwnMassUg } from './types.js';

export type { MaterialDemandLine } from './materials.js';
export { designMaterialDemand } from './materials.js';

export type { StructuralProblem, StructuralProblemCode, StructuralReport, TierStructuralVerdict } from './structure.js';
export {
  CAKE_BOARD_DENSITY_KG_PER_M3,
  CAKE_BOARD_THICKNESS_M,
  CRUMB_STRENGTH_MAX_KPA,
  CRUMB_STRENGTH_MIN_KPA,
  DOWEL_SPACING_M,
  GRAVITY_M_PER_S2,
  MINIMUM_DOWEL_COUNT,
  evaluateStructure,
  minimumDowelCount,
  tierCrumbStrengthPa,
} from './structure.js';

export type { FinishThermalVerdict, ThermalProblem, ThermalProblemCode, ThermalReport } from './thermal.js';
export {
  BUTTERCREAM_MAX_SUBSTRATE_TEMP_C,
  FONDANT_MAX_SUBSTRATE_TEMP_C,
  GANACHE_MAX_SUBSTRATE_TEMP_C,
  THERMALLY_UNGATED_KINDS,
  evaluateThermal,
  productTemperatureAtElapsedSeconds,
} from './thermal.js';

export type {
  FeasibilityProblem,
  FeasibilityProblemCode,
  FeasibilityReport,
  Inventory,
  LineCapability,
} from './feasibility.js';
export { FINISH_EQUIPMENT_TYPE, TRANSFER_FIXED_MINUTES, evaluateFeasibility } from './feasibility.js';

export type { CostReport, MaterialCostLine, PriceTable } from './cost.js';
export { evaluateCost } from './cost.js';

export type { DesignEvaluation, DesignEvaluationInputs } from './evaluate.js';
export { evaluateDesign } from './evaluate.js';
