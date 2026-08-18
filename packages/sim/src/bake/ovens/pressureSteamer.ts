/**
 * Pressure steamer: a sealed chamber holding steam above atmospheric
 * pressure, so — unlike `bainMarie.ts`'s open bath — its steam temperature
 * can genuinely exceed 100 C (real saturation-curve physics, via
 * `steamPhysics.ts`'s Clausius-Clapeyron approximation). Steam condensing
 * directly on the product's surface is modelled with a real condensing-film
 * heat-transfer coefficient (an order of magnitude above ordinary forced
 * convection — condensing steam is one of the most effective heat-transfer
 * mechanisms in food processing, precisely because every kilogram that
 * condenses gives up its full latent heat directly at the surface).
 *
 * That condensed steam is real water mass, sourced from a boiler feed
 * account and returned as condensate to a drain/feed-return account — this
 * family, unlike `steamTube.ts`'s sealed loop, actually contacts the
 * product, so the water element mass genuinely has to move, not just the
 * heat: a boiler evaporates water using its own energy source, the vapour
 * condenses on the product (releasing that same latent heat to the product's
 * thermal account), and the resulting liquid condensate is credited to the
 * drain, in exact H2O molar-mass proportion (the same `splitMolecule`
 * technique `world/exchange.ts`'s own `evaporate`/`condense` use).
 */

import { UG_PER_KG, UJ_PER_J, elementCommodity, roundHalfEven, type Micrograms } from '../../core/commodity.js';
import type { AccountId, Posting } from '../../core/ledger.js';
import { splitMolecule } from '../../world/accounts.js';
import { LATENT_HEAT_VAPORISATION_J_PER_KG } from '../constants.js';
import { deliverHeat, type OvenHeatSource } from '../oven.js';
import { saturationTempC } from './steamPhysics.js';
import { stepFamilyWithDelivery } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const PRESSURE_STEAMER_PROFILE: OvenProfile = {
  id: 'pressure-steamer',
  label: 'Pressure steamer',
  mechanism:
    'Condensing-film heat transfer from steam held above 100 C by chamber pressure, condensing directly on the product surface and returning as real condensate mass to a drain.',
  goodAt: [
    'fast, even cooking above 100 C without a dry-heat crust forming',
    'high moisture retention (the product is bathed in condensing water vapour, not drying air)',
  ],
  badAt: [
    'any crust, browning, or dry surface texture (a saturated-steam surface cannot exceed the local dew point long enough to brown)',
    'delicate structures that cannot tolerate direct condensate wetting',
  ],
};

/** Condensing steam film coefficient, W/(m^2 K) — process-engineering
 * steam-condensation literature reports condensing film coefficients on
 * clean surfaces typically in the 5,000-15,000 W/m^2 K range, an order of
 * magnitude above ordinary forced convection; 8,000 is used as a
 * representative mid-range figure. */
export const CONDENSING_FILM_COEFFICIENT_W_PER_M2_K = 8_000;

export interface PressureSteamSource {
  readonly boilerWaterAccount: AccountId;
  readonly boilerEnergySource: OvenHeatSource;
  readonly condensateAccount: AccountId;
}

export interface PressureSteamerStepParams extends FamilyStepBase {
  readonly chamberPressurePa: number;
  readonly contactAreaM2: number;
  readonly steam: PressureSteamSource;
}

export function pressureSteamerStep(params: PressureSteamerStepParams): FamilyStepResult {
  const steamTempC = saturationTempC(params.chamberPressurePa);
  const condensingW =
    CONDENSING_FILM_COEFFICIENT_W_PER_M2_K * params.contactAreaM2 * (steamTempC - params.surfaceTempC);

  if (condensingW <= 0) {
    // No condensation occurs on a surface at or above the steam's own
    // saturation temperature — the boiler simply does not need to run.
    return stepFamilyWithDelivery('pressure-steamer', { condensation: 0 }, 0, params, [], 0n, 0n);
  }

  const energyJ = condensingW * params.dtSeconds;
  const process = params.process ?? 'oven:pressure-steamer';
  const delivery = deliverHeat(params.steam.boilerEnergySource, params.productThermalAccount, energyJ, `${process}:boiler`);

  const condensedMassUg = massFromLatentHeat(delivery.deliveredEnergy > 0n ? Number(delivery.deliveredEnergy) / Number(UJ_PER_J) : 0);
  const postings: Posting[] = [...delivery.postings];
  if (condensedMassUg > 0n) {
    const byElement = splitMolecule(condensedMassUg, [
      { element: 'H', atoms: 2 },
      { element: 'O', atoms: 1 },
    ]);
    const massH = byElement.get('H') ?? 0n;
    const massO = byElement.get('O') ?? 0n;
    postings.push({
      process: `${process}:condensate`,
      entries: [
        { account: params.steam.boilerWaterAccount, commodity: elementCommodity('H'), delta: -massH },
        { account: params.steam.boilerWaterAccount, commodity: elementCommodity('O'), delta: -massO },
        { account: params.steam.condensateAccount, commodity: elementCommodity('H'), delta: massH },
        { account: params.steam.condensateAccount, commodity: elementCommodity('O'), delta: massO },
      ],
    });
  }

  return stepFamilyWithDelivery(
    'pressure-steamer',
    { condensation: condensingW },
    condensingW,
    params,
    postings,
    delivery.deliveredEnergy,
    delivery.wasteEnergy,
  );
}

function massFromLatentHeat(energyJ: number): Micrograms {
  if (energyJ <= 0) return 0n;
  const massKg = energyJ / LATENT_HEAT_VAPORISATION_J_PER_KG;
  return roundHalfEven(massKg * Number(UG_PER_KG));
}
