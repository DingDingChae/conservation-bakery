/**
 * The first complete provenance loop: sun, soil, rain and atmosphere through
 * a wheat field, a dairy cow, a laying hen and a sugar beet, into a mixed,
 * baked, cooled, wrapped, palletised and shipped cake. See `firstChain.ts`
 * for the full narrative and `run.ts` for the headless runner.
 */

export type {
  FirstChainAccounts,
  FirstChainOutcome,
  FirstChainSeed,
  FirstChainStep,
  RootLotRecord,
} from './firstChain.js';
export { FirstChainScenario, ROOT_LOT_IDS } from './firstChain.js';

export type { AtmosphereCategory, AtmosphereCategoryTotals } from './atmosphereTracker.js';
export { AtmosphereTracker } from './atmosphereTracker.js';

export type { FirstChainRunResult } from './run.js';
export { canonicalFirstChainState, digestFirstChainState, runFirstChain } from './run.js';
