/**
 * Indirect-fired tunnel oven: the burner fires into a sealed firebox/heat
 * exchanger, never into the chamber the product actually travels through.
 * Radiant tubes (or a plate exchanger) carry heat from that firebox into
 * clean, recirculated chamber air; the flue gas itself vents straight to the
 * outside atmosphere and never touches the product zone. That is the real,
 * testable contrast with `tunnelDirectFired.ts`: this family's combustion
 * posting always targets a flue stack account, never whatever account the
 * caller is using as the product's own chamber air.
 *
 * Heat transfer to the product is forced convection from that clean
 * recirculated air, plus radiation from the heat-exchanger tube bank itself
 * (a real, distinct radiant source from the direct-fired family's
 * flame/refractory radiation — tube-bank surface temperature is bounded by
 * the exchanger's own metallurgy, well below an open flame's temperature,
 * which is exactly why an indirect tunnel trades some thermal headroom for a
 * clean product-zone atmosphere).
 */

import { WORLD_ACCOUNTS } from '../../world/accounts.js';
import { STEFAN_BOLTZMANN_W_PER_M2_K4, celsiusToKelvin } from '../constants.js';
import type { AccountId } from '../../core/ledger.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const TUNNEL_INDIRECT_PROFILE: OvenProfile = {
  id: 'tunnel-indirect',
  label: 'Indirect-fired tunnel oven',
  mechanism:
    'Forced convection from clean recirculated air plus radiation from a heat-exchanger tube bank, with combustion confined to a sealed firebox that vents straight to the outside flue — never into the product zone.',
  goodAt: [
    'products sensitive to flue-gas composition or open-flame radiant spectrum',
    'continuous high-throughput lines that still need a clean chamber atmosphere',
  ],
  badAt: [
    'peak radiant intensity (tube-bank surface temperature is bounded well below an open flame)',
    'fast heat-up (the exchanger itself has real thermal mass and lag)',
  ],
};

/** Same order-of-magnitude forced-draft coefficient as the direct-fired
 * family (clean recirculated air, still fan-driven at a similar velocity). */
export const TUNNEL_INDIRECT_CONVECTION_COEFFICIENT_W_PER_M2_K = 28;
/** Representative emissivity for a metal tube-bank radiant exchange —
 * oxidised steel/stainless exchanger surfaces run 0.7-0.9 in food-engineering
 * radiant-tube literature; 0.8 is used as the representative figure. */
export const TUNNEL_INDIRECT_TUBE_EMISSIVITY = 0.8;
/** Heat-exchanger effectiveness: the fraction of gross combustion heat that
 * actually reaches the recirculated chamber air, the rest being exchanger
 * and flue-stack loss. Necessarily lower than a direct-fired tunnel's own
 * 0.75 default (see `tunnelDirectFired.ts`) because every joule here crosses
 * a real heat-exchanger wall instead of heating the chamber directly. */
export const DEFAULT_TUNNEL_INDIRECT_EFFICIENCY = 0.6;

export interface TunnelIndirectStepParams extends FamilyStepBase {
  readonly chamberAirTempC: number;
  readonly tubeBankTempC: number;
  readonly convectiveAreaM2: number;
  readonly radiantAreaM2: number;
  readonly fuelAccount: AccountId;
  /** The real flue stack — always separate from the product's own chamber
   * atmosphere. Defaults to the world atmosphere; never defaults to (or
   * accepts) `atmosphereAccount`, which is only used, if given, for this
   * family's own moisture-loss posting. */
  readonly flueStackAccount?: AccountId;
  readonly efficiency?: number;
}

export function tunnelIndirectStep(params: TunnelIndirectStepParams): FamilyStepResult {
  const convectionW =
    TUNNEL_INDIRECT_CONVECTION_COEFFICIENT_W_PER_M2_K *
    params.convectiveAreaM2 *
    (params.chamberAirTempC - params.surfaceTempC);
  const tubeK = celsiusToKelvin(params.tubeBankTempC);
  const surfaceK = celsiusToKelvin(params.surfaceTempC);
  const radiationW =
    TUNNEL_INDIRECT_TUBE_EMISSIVITY * STEFAN_BOLTZMANN_W_PER_M2_K4 * params.radiantAreaM2 * (tubeK ** 4 - surfaceK ** 4);
  const totalW = convectionW + radiationW;

  return stepFamilyWithOvenSource(
    'tunnel-indirect',
    { convection: convectionW, radiation: radiationW },
    totalW,
    {
      kind: 'gas',
      fuelAccount: params.fuelAccount,
      atmosphereAccount: params.flueStackAccount ?? WORLD_ACCOUNTS.atmosphere,
      efficiency: params.efficiency ?? DEFAULT_TUNNEL_INDIRECT_EFFICIENCY,
    },
    params,
  );
}
