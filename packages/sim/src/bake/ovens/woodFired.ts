/**
 * Wood-fired oven: a real solid fuel charge, split exactly into the three
 * fractions that actually make up a piece of firewood — combustible dry
 * matter, bound moisture, and inert ash — because none of the other families
 * in this directory need to (a gas or electric account is already "pure
 * energy" by construction). Every microgram of that charge is accounted for:
 * the combustible fraction's carbon and hydrogen oxidise and return to the
 * atmosphere as CO2 and H2O; the fuel's own bound moisture evaporates into
 * the same atmosphere, at a real energy cost that reduces the heat actually
 * available; and the ash — literally the `Ash` pseudo-element `commodity.ts`
 * reserves for exactly this — is credited to a real ash-bin account rather
 * than vanishing.
 *
 * Wood ultimate (elemental) analysis, dry basis: representative figures for
 * common firewood species (Jenkins et al., "Combustion properties of
 * biomass," Fuel Processing Technology 54 (1998): C ~50%, H ~6%, O ~44% of
 * dry combustible mass — commonly rounded figures across the biomass-fuels
 * literature). Moisture content of seasoned/air-dried firewood: ~20%,
 * wet basis (US Forest Products Laboratory, *Wood Handbook: Wood as an
 * Engineering Material*, ch. on fuel value of wood — air-dried firewood
 * typically runs 15-25%). Ash content: ~1% of dry mass (same source; common
 * firewood species run roughly 0.2-1%).
 *
 * Heating value from ultimate analysis uses Dulong's formula, the classic
 * solid-fuel correlation still reproduced in modern combustion-engineering
 * references (e.g. Perry's Chemical Engineers' Handbook) for estimating
 * higher heating value directly from a fuel's elemental mass fractions:
 * HHV (kJ/kg) = 33,800·C + 144,300·(H − O/8), mass fractions 0..1 (the
 * sulphur term is omitted — wood fuel is not modelled as containing any
 * tracked sulphur).
 *
 * Heat reaches the product by radiation from the glowing fire bed plus
 * natural-draft convection — no direct sole contact, since a wood-fired
 * product typically sits on a rack over or beside the fire rather than
 * touching a stone hearth (contrast `hearth.ts`, which has conduction and
 * radiation but no convective term at all).
 */

import { ENERGY, UG_PER_KG, elementCommodity, partition, roundHalfEven, type Micrograms, type Microjoules } from '../../core/commodity.js';
import type { AccountId, Entry, Posting } from '../../core/ledger.js';
import { MOLAR_MASS, WORLD_ACCOUNTS, splitMolecule } from '../../world/accounts.js';
import { LATENT_HEAT_VAPORISATION_J_PER_KG, STEFAN_BOLTZMANN_W_PER_M2_K4, celsiusToKelvin } from '../constants.js';
import { SURFACE_EMISSIVITY } from '../oven.js';
import { stepFamilyWithDelivery } from './support.js';
import type { FamilyStepBase, FamilyStepResult, OvenProfile } from './types.js';

export const WOOD_FIRED_PROFILE: OvenProfile = {
  id: 'wood-fired',
  label: 'Wood-fired oven',
  mechanism:
    'Radiation from a glowing wood fire bed plus natural-draft convection, sourced from a real solid-fuel charge split into combustible mass, bound moisture, and ash.',
  goodAt: [
    'products where real wood-smoke flavour and radiant fire character are part of the specification',
    'sites without a metered gas or electricity connection to the firebox',
  ],
  badAt: [
    'fine, repeatable temperature control (heat output is set by fuel charge size, not a throttle)',
    'high-moisture fuel (net available heat falls directly with fuel moisture content)',
  ],
};

/** Wood elemental (ultimate-analysis) mass fractions, dry combustible basis. */
export const WOOD_ULTIMATE_ANALYSIS = { C: 0.50, H: 0.06, O: 0.44 } as const;
export const DEFAULT_WOOD_MOISTURE_FRACTION = 0.20;
export const DEFAULT_WOOD_ASH_FRACTION = 0.01;
/** Natural-draft convection coefficient from an open fire bed — the same
 * order of magnitude as a deck oven's own natural-convection figure (see
 * `bake/oven.ts`'s CONVECTION_COEFFICIENT_W_PER_M2_K citation), since
 * neither is fan-forced. */
export const WOOD_FIRE_CONVECTION_COEFFICIENT_W_PER_M2_K = 18;

const WEIGHT_PRECISION = 1_000_000;

/** Split an exact mass into two parts by a real-valued fraction, via
 * `partition()` so the parts always sum back to the input exactly — the
 * same largest-remainder technique `world/accounts.ts`'s `splitByShare`
 * uses, specialised to a single two-way fraction. */
function splitByFraction(amount: Micrograms, fraction: number): [Micrograms, Micrograms] {
  if (fraction < 0 || fraction > 1) throw new RangeError(`fraction must be within [0, 1], got ${fraction}`);
  const weightA = BigInt(Math.round(fraction * WEIGHT_PRECISION));
  const weightB = BigInt(Math.round((1 - fraction) * WEIGHT_PRECISION));
  const [a, b] = partition(amount, [weightA, weightB]);
  return [a ?? 0n, b ?? 0n];
}

/** Split an exact combustible mass into C/H/O by the wood ultimate-analysis
 * mass fractions above, via `partition()`. */
function splitCombustible(amount: Micrograms): { C: Micrograms; H: Micrograms; O: Micrograms } {
  const weights = [
    BigInt(Math.round(WOOD_ULTIMATE_ANALYSIS.C * WEIGHT_PRECISION)),
    BigInt(Math.round(WOOD_ULTIMATE_ANALYSIS.H * WEIGHT_PRECISION)),
    BigInt(Math.round(WOOD_ULTIMATE_ANALYSIS.O * WEIGHT_PRECISION)),
  ];
  const [c, h, o] = partition(amount, weights);
  return { C: c ?? 0n, H: h ?? 0n, O: o ?? 0n };
}

/** Elemental oxygen mass required to fully oxidise `massC`/`massH` to CO2 and
 * H2O — the same real stoichiometry `world/exchange.ts`'s `combustMethane`
 * and `respire` use, reproduced here because that module's own helper is not
 * exported (it is a private implementation detail of methane/glucose
 * combustion, not a general-purpose export). */
function productOxygenMass(massC: Micrograms, massH: Micrograms): Micrograms {
  const forCarbonDioxide = Number(massC) * ((2 * MOLAR_MASS.O) / MOLAR_MASS.C);
  const forWater = Number(massH) * (MOLAR_MASS.O / (2 * MOLAR_MASS.H));
  return roundHalfEven(forCarbonDioxide + forWater);
}

/** Dulong's formula, kJ/kg, from elemental mass fractions (0..1). */
function dulongHhvKJPerKg(massFractionC: number, massFractionH: number, massFractionO: number): number {
  return 33_800 * massFractionC + 144_300 * (massFractionH - massFractionO / 8);
}

export interface WoodFuelCharge {
  readonly fuelAccount: AccountId;
  readonly fuelMassUg: Micrograms;
  /** Wet-basis moisture fraction of the charge (0..1). Defaults to 0.20,
   * seasoned/air-dried firewood. */
  readonly moistureFraction?: number;
  /** Dry-basis ash fraction of the charge (0..1). Defaults to 0.01. */
  readonly ashFraction?: number;
  readonly ashBinAccount: AccountId;
  readonly wasteHeatAccount?: AccountId;
}

export interface WoodFiredStepParams extends FamilyStepBase {
  readonly fireTempC: number;
  readonly draftTempC: number;
  readonly radiantAreaM2: number;
  readonly convectiveAreaM2: number;
  readonly charge: WoodFuelCharge;
}

export interface WoodCombustionResult {
  readonly posting: Posting;
  readonly grossEnergy: Microjoules;
  readonly combustibleMassUg: Micrograms;
  readonly moistureMassUg: Micrograms;
  readonly ashMassUg: Micrograms;
}

/**
 * Burn one wood fuel charge: split it exactly into combustible mass,
 * moisture and ash, oxidise the combustible carbon and hydrogen against the
 * atmosphere by real stoichiometry, evaporate the fuel's own moisture into
 * the same atmosphere, and credit the ash to a real ash-bin account. Returns
 * the one balanced posting plus the gross heat released (before the fuel's
 * own moisture-evaporation cost is deducted — see `woodFiredStep`).
 */
export function combustWoodCharge(charge: WoodFuelCharge, atmosphereAccount: AccountId, process: string): WoodCombustionResult {
  const moistureFraction = charge.moistureFraction ?? DEFAULT_WOOD_MOISTURE_FRACTION;
  const ashFraction = charge.ashFraction ?? DEFAULT_WOOD_ASH_FRACTION;
  const wasteHeatAccount = charge.wasteHeatAccount ?? WORLD_ACCOUNTS.space;

  const [moistureMassUg, dryMassUg] = splitByFraction(charge.fuelMassUg, moistureFraction);
  const [ashMassUg, combustibleMassUg] = splitByFraction(dryMassUg, ashFraction);
  const combustible = splitCombustible(combustibleMassUg);
  const moisture = splitMolecule(moistureMassUg, [
    { element: 'H', atoms: 2 },
    { element: 'O', atoms: 1 },
  ]);
  const moistureH = moisture.get('H') ?? 0n;
  const moistureO = moisture.get('O') ?? 0n;
  const o2Drawn = productOxygenMass(combustible.C, combustible.H);

  const hhvKJPerKg = dulongHhvKJPerKg(WOOD_ULTIMATE_ANALYSIS.C, WOOD_ULTIMATE_ANALYSIS.H, WOOD_ULTIMATE_ANALYSIS.O);
  const combustibleMassKg = Number(combustibleMassUg) / Number(UG_PER_KG);
  const grossJ = hhvKJPerKg * 1_000 * combustibleMassKg;
  const grossEnergy = roundHalfEven(grossJ * 1_000_000);

  const entries: Entry[] = [
    { account: charge.fuelAccount, commodity: elementCommodity('C'), delta: -combustible.C },
    { account: charge.fuelAccount, commodity: elementCommodity('H'), delta: -(combustible.H + moistureH) },
    { account: charge.fuelAccount, commodity: elementCommodity('O'), delta: -(combustible.O + moistureO) },
    { account: charge.fuelAccount, commodity: elementCommodity('Ash'), delta: -ashMassUg },
    { account: charge.fuelAccount, commodity: ENERGY, delta: -grossEnergy },
    { account: atmosphereAccount, commodity: elementCommodity('O'), delta: -o2Drawn },
    { account: atmosphereAccount, commodity: elementCommodity('C'), delta: combustible.C },
    { account: atmosphereAccount, commodity: elementCommodity('H'), delta: combustible.H + moistureH },
    { account: atmosphereAccount, commodity: elementCommodity('O'), delta: combustible.O + o2Drawn + moistureO },
    { account: charge.ashBinAccount, commodity: elementCommodity('Ash'), delta: ashMassUg },
    { account: wasteHeatAccount, commodity: ENERGY, delta: grossEnergy },
  ];

  return {
    posting: { process, entries },
    grossEnergy,
    combustibleMassUg,
    moistureMassUg,
    ashMassUg,
  };
}

export function woodFiredStep(params: WoodFiredStepParams): FamilyStepResult {
  const radiantK = celsiusToKelvin(params.fireTempC);
  const surfaceK = celsiusToKelvin(params.surfaceTempC);
  const radiationW = SURFACE_EMISSIVITY * STEFAN_BOLTZMANN_W_PER_M2_K4 * params.radiantAreaM2 * (radiantK ** 4 - surfaceK ** 4);
  const convectionW =
    WOOD_FIRE_CONVECTION_COEFFICIENT_W_PER_M2_K * params.convectiveAreaM2 * (params.draftTempC - params.surfaceTempC);
  const totalFluxW = radiationW + convectionW;

  const process = params.process ?? 'oven:wood-fired';
  const wasteHeatAccount = params.charge.wasteHeatAccount ?? WORLD_ACCOUNTS.space;
  const atmosphereAccount = params.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere;

  const combustion = combustWoodCharge(params.charge, atmosphereAccount, `${process}:combustion`);

  const moistureFraction = params.charge.moistureFraction ?? DEFAULT_WOOD_MOISTURE_FRACTION;
  const [moistureMassUg] = splitByFraction(params.charge.fuelMassUg, moistureFraction);
  const moistureEvapJ = (Number(moistureMassUg) / Number(UG_PER_KG)) * LATENT_HEAT_VAPORISATION_J_PER_KG;
  const grossJ = Number(combustion.grossEnergy) / 1_000_000;
  const netAvailableJ = Math.max(0, grossJ - moistureEvapJ);

  const fluxImpliedJ = totalFluxW * params.dtSeconds;
  const deliveredJ = Math.max(0, Math.min(fluxImpliedJ, netAvailableJ));
  const delivered = roundHalfEven(deliveredJ * 1_000_000);
  const waste = combustion.grossEnergy - delivered; // exact by subtraction, per CONTRACT.md rule 1.

  const transfer: Posting = {
    process: `${process}:to-product`,
    entries: [
      { account: wasteHeatAccount, commodity: ENERGY, delta: -delivered },
      { account: params.productThermalAccount, commodity: ENERGY, delta: delivered },
    ],
  };

  return stepFamilyWithDelivery(
    'wood-fired',
    { radiation: radiationW, convection: convectionW },
    totalFluxW,
    params,
    [combustion.posting, transfer],
    delivered,
    waste,
  );
}
