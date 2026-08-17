/**
 * Heat transfer into a baking product: conduction from the sole, radiation from
 * the crown, convection from moving cavity air — a deck oven's three real heat
 * paths, combined into a lumped surface-node energy budget. Other oven families
 * (convection, tunnel, rotary) can plug in later by supplying a different
 * `HeatTransferGeometry` and coefficient set; the physics here does not assume a
 * deck oven's specific geometry beyond the three named areas.
 *
 * Every joule this module delivers to a product is drawn from a real account —
 * `market.utilities` (the grid, metered and billed, per `world/accounts.ts`) for
 * electric heat, or real methane combustion for gas heat, reusing
 * `world/exchange.ts`'s own `combustMethane` so the flue's CO2 and H2O return to
 * the same atmosphere every other combustion in this simulation draws from. See
 * CONTRACT.md rule 1: nothing here invents a joule the product receives.
 */

import type { Micrograms, Microjoules } from '../core/commodity.js';
import { ENERGY, UJ_PER_J, roundHalfEven } from '../core/commodity.js';
import type { AccountId, Posting } from '../core/ledger.js';
import { MOLAR_MASS, WORLD_ACCOUNTS } from '../world/accounts.js';
import { combustMethane } from '../world/exchange.js';
import { celsiusToKelvin, STEFAN_BOLTZMANN_W_PER_M2_K4 } from './constants.js';

export interface OvenEnvironment {
  readonly soleTempC: number;
  readonly crownTempC: number;
  readonly airTempC: number;
}

export interface HeatTransferGeometry {
  /** Area of the product actually touching the sole (pan bottom or hearth). */
  readonly contactAreaM2: number;
  /** Area facing the crown/roof, receiving radiant heat. */
  readonly crownFacingAreaM2: number;
  /** Area exposed to moving cavity air (sides and top, typically). */
  readonly convectiveAreaM2: number;
}

/**
 * Sole/pan-to-product contact heat transfer coefficient, W/(m^2 K). Baking heat
 * transfer studies (e.g. Baik, Marcotte & Sablani-style cake and bread baking
 * heat transfer models) report pan-contact coefficients on the order of
 * 100-300 W/m^2 K for direct metal-pan contact; 200 is used as a representative
 * mid-range figure.
 */
export const CONDUCTION_COEFFICIENT_W_PER_M2_K = 200;

/**
 * Natural-convection deck-oven cavity air coefficient, W/(m^2 K). Food-engineering
 * oven convection studies put natural-draft deck ovens in the 10-20 W/m^2 K
 * range (forced convection ovens with fans run substantially higher, 20-40+);
 * 15 is used as the representative deck-oven figure.
 */
export const CONVECTION_COEFFICIENT_W_PER_M2_K = 15;

/** Representative emissivity of a baking product's surface and an oven cavity's
 * radiant exchange, a standard food-engineering assumption (typically cited in
 * the 0.8-0.9 range for baked-goods surfaces). */
export const SURFACE_EMISSIVITY = 0.85;

export interface HeatFluxResult {
  readonly conductionW: number;
  readonly radiationW: number;
  readonly convectionW: number;
  /** Net watts flowing into the product surface. Negative means the surface is
   * hotter than its surroundings and is losing heat net. */
  readonly totalW: number;
}

/**
 * The instantaneous heat flux into a product's surface from all three deck-oven
 * paths, given the environment and the surface's own current temperature.
 *
 * Radiation uses real Stefan-Boltzmann physics (`(T_crown^4 - T_surface^4)`, both
 * in Kelvin) rather than a linearised approximation, so it stays accurate across
 * the wide temperature swing a cold product sees against a hot crown.
 */
export function heatFluxes(
  environment: OvenEnvironment,
  geometry: HeatTransferGeometry,
  surfaceTempC: number,
): HeatFluxResult {
  const conductionW =
    CONDUCTION_COEFFICIENT_W_PER_M2_K * geometry.contactAreaM2 * (environment.soleTempC - surfaceTempC);

  const crownK = celsiusToKelvin(environment.crownTempC);
  const surfaceK = celsiusToKelvin(surfaceTempC);
  const radiationW =
    SURFACE_EMISSIVITY *
    STEFAN_BOLTZMANN_W_PER_M2_K4 *
    geometry.crownFacingAreaM2 *
    (crownK ** 4 - surfaceK ** 4);

  const convectionW =
    CONVECTION_COEFFICIENT_W_PER_M2_K * geometry.convectiveAreaM2 * (environment.airTempC - surfaceTempC);

  return {
    conductionW,
    radiationW,
    convectionW,
    totalW: conductionW + radiationW + convectionW,
  };
}

export interface ElectricHeatSource {
  readonly kind: 'electric';
  /** Defaults to `market.utilities` — the grid, a real metered external account
   * per `world/accounts.ts`. */
  readonly energyAccount?: AccountId;
}

export interface GasHeatSource {
  readonly kind: 'gas';
  readonly fuelAccount: AccountId;
  readonly atmosphereAccount?: AccountId;
  /** Where flue (combustion) loss is credited — the heat that left the fuel but
   * did not reach the product. Defaults to `space`, the radiative sink named in
   * CONTRACT.md: "every joule that leaves the world arrives here." */
  readonly wasteHeatAccount?: AccountId;
  /** Fraction of released combustion energy that reaches the product; the rest
   * is flue loss. Real deck ovens run roughly 70-85% thermal efficiency to the
   * load; 0.75 is the representative default. */
  readonly efficiency?: number;
}

export type OvenHeatSource = ElectricHeatSource | GasHeatSource;

const DEFAULT_GAS_EFFICIENCY = 0.75;
const METHANE_COMBUSTION_J_PER_MOL = 802_300; // matches world/exchange.ts's cited value
const CH4_MOLAR_MASS = MOLAR_MASS.C + 4 * MOLAR_MASS.H;

/** Invert the same real combustion enthalpy `world/exchange.ts` uses, to size
 * the methane charge that releases (approximately) a target amount of energy.
 * The actual released amount is read back off the posting itself afterwards —
 * this is only used to decide how much fuel to burn, never to state a result. */
function methaneMassForEnergy(targetJ: number): Micrograms {
  if (targetJ <= 0) return 0n;
  const joulesPerMicrogram = METHANE_COMBUSTION_J_PER_MOL / CH4_MOLAR_MASS / 1_000_000;
  return roundHalfEven(targetJ / joulesPerMicrogram);
}

export interface HeatDelivery {
  readonly postings: readonly Posting[];
  readonly deliveredEnergy: Microjoules;
  readonly wasteEnergy: Microjoules;
}

/**
 * Source and deliver an exact amount of energy into a product's thermal
 * account, from either electric or gas heat.
 */
export function deliverHeat(
  source: OvenHeatSource,
  productThermalAccount: AccountId,
  targetEnergyJ: number,
  process = 'oven:heat',
): HeatDelivery {
  if (targetEnergyJ <= 0) {
    return { postings: [], deliveredEnergy: 0n, wasteEnergy: 0n };
  }

  if (source.kind === 'electric') {
    const energyAccount = source.energyAccount ?? WORLD_ACCOUNTS.marketUtilities;
    const delivered = roundHalfEven(targetEnergyJ * Number(UJ_PER_J));
    const posting: Posting = {
      process: `${process}:electric`,
      entries: [
        { account: energyAccount, commodity: ENERGY, delta: -delivered },
        { account: productThermalAccount, commodity: ENERGY, delta: delivered },
      ],
    };
    return { postings: [posting], deliveredEnergy: delivered, wasteEnergy: 0n };
  }

  const efficiency = source.efficiency ?? DEFAULT_GAS_EFFICIENCY;
  const wasteHeatAccount = source.wasteHeatAccount ?? WORLD_ACCOUNTS.space;
  const methaneMass = methaneMassForEnergy(targetEnergyJ / efficiency);

  // Route the full, real combustion posting's energy to the waste account first
  // (this is the gross heat the burner actually released, by real methane
  // stoichiometry), then transfer the useful fraction on to the product. Two
  // balanced postings in sequence, each exact — never a recomputation of the
  // combustion energy, only a read-back of what `combustMethane` itself posted.
  const combustion = combustMethane({
    fuelAccount: source.fuelAccount,
    ...(source.atmosphereAccount !== undefined ? { atmosphereAccount: source.atmosphereAccount } : {}),
    energyAccount: wasteHeatAccount,
    methaneMass,
    process: `${process}:combustion`,
  });

  const released =
    combustion.entries.find((e) => e.account === wasteHeatAccount && e.commodity === ENERGY && e.delta > 0n)
      ?.delta ?? 0n;
  const delivered = roundHalfEven(Number(released) * efficiency);
  const waste = released - delivered; // exact by subtraction — see CONTRACT.md rule 1.

  const transfer: Posting = {
    process: `${process}:to-product`,
    entries: [
      { account: wasteHeatAccount, commodity: ENERGY, delta: -delivered },
      { account: productThermalAccount, commodity: ENERGY, delta: delivered },
    ],
  };

  return { postings: [combustion, transfer], deliveredEnergy: delivered, wasteEnergy: waste };
}

export interface OvenStepParams {
  readonly environment: OvenEnvironment;
  readonly geometry: HeatTransferGeometry;
  readonly surfaceTempC: number;
  readonly dtSeconds: number;
  readonly source: OvenHeatSource;
  readonly productThermalAccount: AccountId;
  /** Where heat is credited when the surface runs hotter than its surroundings
   * and loses heat net (e.g. late in a bake, or during cooling). Defaults to
   * `space`, per CONTRACT.md's "every joule that leaves the world arrives here." */
  readonly lossSinkAccount?: AccountId;
  readonly process?: string;
}

export interface OvenStepResult {
  readonly fluxes: HeatFluxResult;
  readonly postings: readonly Posting[];
  /** Net energy actually posted into the product this step (negative if the
   * product lost heat net). */
  readonly netEnergyJ: number;
}

/**
 * One fixed timestep of deck-oven heat transfer: compute the real flux from the
 * current environment and surface temperature, then post the exact energy that
 * flux implies, sourced from a real fuel or electric account (or, if the surface
 * is running hotter than its surroundings, posted out to the loss sink).
 */
export function ovenStep(params: OvenStepParams): OvenStepResult {
  if (params.dtSeconds <= 0) {
    throw new RangeError(`ovenStep requires a positive dt, got ${params.dtSeconds}`);
  }
  const fluxes = heatFluxes(params.environment, params.geometry, params.surfaceTempC);
  const energyJ = fluxes.totalW * params.dtSeconds;
  const process = params.process ?? 'oven:step';

  if (energyJ >= 0) {
    const delivery = deliverHeat(params.source, params.productThermalAccount, energyJ, process);
    return { fluxes, postings: delivery.postings, netEnergyJ: Number(delivery.deliveredEnergy) / Number(UJ_PER_J) };
  }

  const lossSinkAccount = params.lossSinkAccount ?? WORLD_ACCOUNTS.space;
  const lost = roundHalfEven(-energyJ * Number(UJ_PER_J));
  if (lost === 0n) {
    return { fluxes, postings: [], netEnergyJ: 0 };
  }
  const posting: Posting = {
    process: `${process}:loss`,
    entries: [
      { account: params.productThermalAccount, commodity: ENERGY, delta: -lost },
      { account: lossSinkAccount, commodity: ENERGY, delta: lost },
    ],
  };
  return { fluxes, postings: [posting], netEnergyJ: -(Number(lost) / Number(UJ_PER_J)) };
}
