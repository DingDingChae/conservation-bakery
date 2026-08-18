/**
 * Bain-marie / water bath: conduction only, through a vessel wall, from an
 * open water bath — the one family in this directory whose top temperature
 * is a hard physical ceiling rather than an equipment setpoint. An open
 * water bath at atmospheric pressure cannot run hotter than water's own
 * boiling point (`BOILING_POINT_C`, 100 C — see `bake/constants.ts`): any
 * heat delivered beyond what keeps the bath boiling only boils water away
 * faster, it does not raise the bath's temperature further. `clampBathTempC`
 * enforces this structurally, so no caller of this module can accidentally
 * ask for (or receive) a bain-marie hotter than physics allows.
 */

import { BOILING_POINT_C } from '../constants.js';
import { CONDUCTION_COEFFICIENT_W_PER_M2_K, type OvenHeatSource } from '../oven.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const BAIN_MARIE_PROFILE: OvenProfile = {
  id: 'bain-marie',
  label: 'Bain-marie / water bath',
  mechanism: 'Conduction through a vessel wall from an open water bath, whose own temperature is physically capped at water’s boiling point.',
  goodAt: [
    'gentle, scorch-proof cooking of delicate custards and curds',
    'a hard, predictable temperature ceiling with no risk of overheating the bath itself',
  ],
  badAt: [
    'anything that needs to run hotter than 100 C (physically impossible for an open bath at atmospheric pressure — see `pressureSteamer.ts` for a sealed alternative)',
    'fast heat transfer to a large product (bounded by both the wall’s conduction coefficient and the bath’s own temperature ceiling)',
  ],
};

/** Conduction through an insulating vessel wall between the bath and the
 * product is materially lower than direct pan-to-product contact (`bake/
 * oven.ts`'s own 100-300 W/m^2 K deck figure is for direct metal contact);
 * a bain-marie's product vessel sits inside the bath rather than touching a
 * heated surface directly, so a lower, representative figure is used here. */
export const BAIN_MARIE_CONDUCTION_COEFFICIENT_W_PER_M2_K = CONDUCTION_COEFFICIENT_W_PER_M2_K / 2;

/**
 * Clamp a requested bath temperature to what an open bath at atmospheric
 * pressure can physically sustain. This is the structural enforcement this
 * family exists to provide — every step below routes the caller's bath
 * temperature through this function rather than trusting it directly.
 */
export function clampBathTempC(requestedC: number): number {
  return Math.min(requestedC, BOILING_POINT_C);
}

export interface BainMarieStepParams extends FamilyStepBase {
  readonly requestedBathTempC: number;
  readonly contactAreaM2: number;
  readonly source: OvenHeatSource;
}

export function bainMarieStep(params: BainMarieStepParams): FamilyStepResult {
  const bathTempC = clampBathTempC(params.requestedBathTempC);
  const conductionW =
    BAIN_MARIE_CONDUCTION_COEFFICIENT_W_PER_M2_K * params.contactAreaM2 * (bathTempC - params.surfaceTempC);

  return stepFamilyWithOvenSource('bain-marie', { conduction: conductionW }, conductionW, params.source, params);
}
