/**
 * Deck oven: conduction from a heated sole slab, radiation from a heated
 * crown, and weak natural convection from the (largely still) cavity air —
 * the three real heat paths a deck oven actually has, all three at once.
 *
 * The physics itself already lives in `bake/oven.ts` — the original
 * implementation, still independently exported and tested there. This module
 * only wraps it behind the common `FamilyStepBase`/`FamilyStepResult` shape
 * every other family in `bake/ovens/` shares, so a caller can request "deck"
 * from the registry and swap families without re-deriving deck-specific
 * geometry math, and without this directory re-implementing (or
 * second-guessing) `oven.ts`'s own balance guarantee.
 */

import { heatFluxes, type HeatTransferGeometry, type OvenEnvironment, type OvenHeatSource } from '../oven.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const DECK_PROFILE: OvenProfile = {
  id: 'deck',
  label: 'Deck oven',
  mechanism:
    'Conduction from a heated sole slab, radiation from a heated crown, and weak natural convection from cavity air — all three real paths, lumped at a single product surface node.',
  goodAt: [
    'hearth breads and pizzas that want a strong, direct bottom crust',
    'small batches loaded and unloaded one deck position at a time',
  ],
  badAt: [
    'large multi-tray batches (no forced air, so cavity temperature recovers slowly after loading)',
    'perfectly even top/bottom colour on a tall product',
  ],
};

export interface DeckStepParams extends FamilyStepBase {
  readonly environment: OvenEnvironment;
  readonly geometry: HeatTransferGeometry;
  readonly source: OvenHeatSource;
}

export function deckStep(params: DeckStepParams): FamilyStepResult {
  const fluxes = heatFluxes(params.environment, params.geometry, params.surfaceTempC);
  return stepFamilyWithOvenSource(
    'deck',
    { conduction: fluxes.conductionW, radiation: fluxes.radiationW, convection: fluxes.convectionW },
    fluxes.totalW,
    params.source,
    params,
  );
}
