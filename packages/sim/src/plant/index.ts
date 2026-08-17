/**
 * The plant layer: unit operations that turn farm output into bakery
 * ingredients. Model only — no UI, no DOM, no Electron. Every operation moves
 * material through exactly one balanced `Posting`, built by `unit.ts`'s shared
 * helper; see that file for the conservation guarantee every unit operation
 * here relies on.
 */

export type {
  EnergyFlow,
  LotDeclaration,
  ProcessFlow,
  ProcessStep,
  ProcessUnitConfig,
  StreamProfile,
} from './unit.js';
export { ProcessUnit, UnbalancedProcessError, buildProcessPosting, splitByProfile } from './unit.js';

export type { MillBatchParams, MillBatchResult, MillCompositions, MillYields } from './mill.js';
export { MILL_MACHINE_DEFINITION, createMill, millGrain } from './mill.js';

export type {
  ChurnCreamCompositions,
  ChurnCreamParams,
  ChurnCreamYields,
  PasteurizeParams,
  SeparateMilkCompositions,
  SeparateMilkParams,
  SeparateMilkYields,
} from './creamery.js';
export {
  CREAMERY_MACHINE_DEFINITION,
  PASTEURIZATION_HOLD_TEMP_C,
  churnCream,
  createCreamery,
  pasteurize,
  separateMilk,
} from './creamery.js';

export type { RefineBatchParams, RefineBatchResult, RefineCompositions, RefineYields } from './refinery.js';
export { REFINERY_MACHINE_DEFINITION, createRefinery, refineSugarBeet } from './refinery.js';
