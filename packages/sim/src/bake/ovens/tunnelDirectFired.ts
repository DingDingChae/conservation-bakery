/**
 * Direct-fired tunnel oven: burners fire straight into the same chamber the
 * product travels through on a moving belt, so the products of combustion —
 * CO2 and H2O — are physically present in the same air the product zone
 * bathes in, not vented away separately. That is the real, testable
 * difference from `tunnelIndirect.ts`: this family's combustion posting uses
 * the *same* atmosphere account the caller passes as this product's chamber
 * environment (`atmosphereAccount`), so combustion products provably reach
 * the product zone; the indirect family never lets that happen.
 *
 * Heat reaches the product by forced convection from the hot combustion-zone
 * air plus radiation from the hot chamber (flame- and wall-radiant), exactly
 * the two paths a real direct-fired tunnel has (no sole contact — product
 * rides a mesh belt, not a hearth). Position along the tunnel's length is
 * real and matters (a multi-zone tunnel runs hotter near its burners and
 * cools toward the exit); it is modelled the same way `oven.ts`'s deck does
 * — as an explicit environment temperature the caller supplies for wherever
 * along the belt this step represents, rather than an assumption of one
 * cavity temperature for the whole oven.
 */

import { WORLD_ACCOUNTS } from '../../world/accounts.js';
import { STEFAN_BOLTZMANN_W_PER_M2_K4, celsiusToKelvin } from '../constants.js';
import type { AccountId } from '../../core/ledger.js';
import { stepFamilyWithOvenSource } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const TUNNEL_DIRECT_FIRED_PROFILE: OvenProfile = {
  id: 'tunnel-direct-fired',
  label: 'Direct-fired tunnel oven',
  mechanism:
    'Forced convection and radiation from a combustion chamber the product travels through directly on a belt, so flue gas composition is physically part of the product zone air.',
  goodAt: [
    'high continuous throughput of one standardised product',
    'fast heat-up (no heat-exchanger thermal lag between the flame and the product)',
  ],
  badAt: [
    'products sensitive to combustion by-products in the surrounding air',
    'anything not on a continuous belt line (no per-batch loading)',
  ],
};

/** Forced-draft convection coefficient from a tunnel's own burner-driven
 * airflow — the same order of magnitude as a rack oven's fan-driven cavity
 * (20-40 W/m^2 K in food-engineering oven convection studies); 28 is used as
 * a representative mid-range tunnel figure. */
export const TUNNEL_CONVECTION_COEFFICIENT_W_PER_M2_K = 28;
/** Representative emissivity for a flame/hot-refractory radiant exchange,
 * consistent with `bake/oven.ts`'s own SURFACE_EMISSIVITY citation. */
export const TUNNEL_RADIANT_EMISSIVITY = 0.85;

export interface TunnelDirectFiredStepParams extends FamilyStepBase {
  /** This zone's local combustion-chamber air temperature — position along
   * the tunnel's length, explicit rather than assumed uniform. */
  readonly zoneAirTempC: number;
  readonly convectiveAreaM2: number;
  readonly radiantAreaM2: number;
  readonly fuelAccount: AccountId;
  /** Fraction of gross combustion heat this zone actually delivers to the
   * belt versus carries on down-tunnel/up the stack. Real direct-fired
   * tunnels run a similar order of thermal efficiency to a deck oven's own
   * 70-85% (see `bake/oven.ts`'s DEFAULT_GAS_EFFICIENCY citation); 0.75 is
   * the default here too. */
  readonly efficiency?: number;
}

export function tunnelDirectFiredStep(params: TunnelDirectFiredStepParams): FamilyStepResult {
  const convectionW =
    TUNNEL_CONVECTION_COEFFICIENT_W_PER_M2_K * params.convectiveAreaM2 * (params.zoneAirTempC - params.surfaceTempC);
  const zoneK = celsiusToKelvin(params.zoneAirTempC);
  const surfaceK = celsiusToKelvin(params.surfaceTempC);
  const radiationW =
    TUNNEL_RADIANT_EMISSIVITY * STEFAN_BOLTZMANN_W_PER_M2_K4 * params.radiantAreaM2 * (zoneK ** 4 - surfaceK ** 4);
  const totalW = convectionW + radiationW;

  return stepFamilyWithOvenSource(
    'tunnel-direct-fired',
    { convection: convectionW, radiation: radiationW },
    totalW,
    {
      kind: 'gas',
      fuelAccount: params.fuelAccount,
      // The defining trait of this family: combustion products land in the
      // same account the caller is using as this product zone's chamber
      // atmosphere, not a separate flue stack. See `tunnelIndirect.ts` for
      // the contrast.
      atmosphereAccount: params.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere,
      ...(params.efficiency !== undefined ? { efficiency: params.efficiency } : {}),
    },
    params,
  );
}
