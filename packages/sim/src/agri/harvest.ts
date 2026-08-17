/**
 * Harvest: splitting standing crop biomass into its harvested organ (grain / root)
 * and residue (straw / crown), and drying the harvested organ down to a storage
 * moisture content.
 *
 * The split uses `partition()` -- CONTRACT.md's only sanctioned way to divide an
 * exact quantity -- so the two parts always sum back to exactly the standing
 * biomass, for every commodity that account holds (every tracked element, and any
 * stored chemical energy `crop.ts`'s photosynthesis posted there). Moisture added at
 * harvest and later removed by drying are both real, balanced transfers against a
 * soil account and the atmosphere respectively; nothing here estimates a moisture
 * content by inspecting elemental mass after the fact; the added-water amount is
 * carried forward explicitly instead, so a later drying step never has to guess how
 * much of an account's hydrogen and oxygen was "moisture" versus organic matter.
 */

import type { CommodityId, ElementCommodity, Micrograms } from '../core/commodity.js';
import { elementCommodity, partition, roundHalfEven } from '../core/commodity.js';
import type { AccountId, Entry, Ledger, Posting } from '../core/ledger.js';
import { MOLAR_MASS, splitMolecule } from '../world/accounts.js';
import { evaporate } from '../world/exchange.js';
import type { CropDefinition } from './crop.js';

const WEIGHT_PRECISION = 1_000_000;

const H2O_FORMULA = [
  { element: 'H', atoms: 2 },
  { element: 'O', atoms: 1 },
] as const satisfies readonly { element: 'C' | 'H' | 'N' | 'O'; atoms: number }[];

/** Mass fraction of water's own hydrogen: 2 * M(H) / M(H2O). Used to bound how much
 * liquid water a soil account's hydrogen balance could actually still supply -- see
 * the identical reasoning in `crop.ts`. */
const WATER_HYDROGEN_MASS_FRACTION = (2 * MOLAR_MASS.H) / (2 * MOLAR_MASS.H + MOLAR_MASS.O);

function isElementCommodity(commodity: CommodityId): commodity is ElementCommodity {
  return commodity.startsWith('el:');
}

function floorMicrograms(value: number): Micrograms {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value));
}

function minBig(a: Micrograms, b: Micrograms): Micrograms {
  return a < b ? a : b;
}

export interface HarvestSplitResult {
  readonly posting: Posting;
  /** Dry mass credited to the harvested-organ account (grain / root). */
  readonly primaryMassUg: Micrograms;
  /** Dry mass credited to the residue account (straw / crown). */
  readonly residueMassUg: Micrograms;
}

/**
 * Split every commodity `biomassAccount` holds -- every tracked element and any
 * stored chemical energy -- between `primaryAccount` and `residueAccount` in the
 * crop's `harvestIndex` ratio, using `partition()` so each commodity's two shares
 * sum back to exactly what the standing crop held. Read-only against the ledger;
 * the caller applies the returned posting.
 */
export function splitStandingBiomass(
  ledger: Ledger,
  definition: CropDefinition,
  biomassAccount: AccountId,
  primaryAccount: AccountId,
  residueAccount: AccountId,
  process = 'agri:harvest-split',
): HarvestSplitResult {
  const balances = ledger.balances(biomassAccount);
  const primaryWeight = BigInt(Math.round(definition.harvestIndex * WEIGHT_PRECISION));
  const residueWeight = BigInt(Math.round((1 - definition.harvestIndex) * WEIGHT_PRECISION));

  const entries: Entry[] = [];
  let primaryMassUg = 0n;
  let residueMassUg = 0n;

  for (const [commodity, amount] of balances) {
    if (amount === 0n) continue;
    const [primaryShare = 0n, residueShare = 0n] = partition(amount, [primaryWeight, residueWeight]);
    entries.push({ account: biomassAccount, commodity, delta: -amount });
    entries.push({ account: primaryAccount, commodity, delta: primaryShare });
    entries.push({ account: residueAccount, commodity, delta: residueShare });
    if (isElementCommodity(commodity)) {
      primaryMassUg += primaryShare;
      residueMassUg += residueShare;
    }
  }

  return { posting: { process, entries }, primaryMassUg, residueMassUg };
}

export interface FieldMoistureParams {
  /** Read-only: used to cap the water drawn at what `soilAccount` actually holds. */
  readonly ledger: Ledger;
  readonly definition: CropDefinition;
  readonly primaryAccount: AccountId;
  readonly soilAccount: AccountId;
  /** The dry mass just credited to `primaryAccount`, e.g. from `splitStandingBiomass`. */
  readonly dryMassUg: Micrograms;
  readonly process?: string;
}

export interface FieldMoistureResult {
  readonly posting: Posting;
  readonly waterAddedUg: Micrograms;
}

/**
 * Bring a freshly harvested organ up to its crop's typical field moisture content by
 * drawing liquid water from `soilAccount` -- a real, balanced, H2O-stoichiometric
 * transfer, not an assumption that the harvested mass simply arrives already wet.
 * Capped by what `soilAccount` actually holds: a season of transpiration and a wet
 * harvest target can otherwise ask for more moisture than the field has left.
 */
export function addFieldMoisture(params: FieldMoistureParams): FieldMoistureResult {
  const { freshMoistureContent } = params.definition;
  const process = params.process ?? 'agri:field-moisture-uptake';
  if (freshMoistureContent <= 0 || params.dryMassUg <= 0n) {
    return { posting: { process, entries: [] }, waterAddedUg: 0n };
  }

  // freshMass = dryMass / (1 - moistureContent); water = freshMass - dryMass.
  const targetWaterUg = roundHalfEven(
    Number(params.dryMassUg) * (freshMoistureContent / (1 - freshMoistureContent)),
  );
  if (targetWaterUg <= 0n) {
    return { posting: { process, entries: [] }, waterAddedUg: 0n };
  }

  const availableSoilHydrogen = Number(params.ledger.balance(params.soilAccount, elementCommodity('H')));
  const ceilingUg = floorMicrograms(availableSoilHydrogen / WATER_HYDROGEN_MASS_FRACTION);
  const waterUg = minBig(targetWaterUg, ceilingUg);
  if (waterUg <= 0n) {
    return { posting: { process, entries: [] }, waterAddedUg: 0n };
  }

  const byElement = splitMolecule(waterUg, H2O_FORMULA);
  const massH = byElement.get('H') ?? 0n;
  const massO = byElement.get('O') ?? 0n;

  const entries: Entry[] = [
    { account: params.soilAccount, commodity: elementCommodity('H'), delta: -massH },
    { account: params.soilAccount, commodity: elementCommodity('O'), delta: -massO },
    { account: params.primaryAccount, commodity: elementCommodity('H'), delta: massH },
    { account: params.primaryAccount, commodity: elementCommodity('O'), delta: massO },
  ];

  return { posting: { process, entries }, waterAddedUg: massH + massO };
}

export interface DryingParams {
  readonly primaryAccount: AccountId;
  readonly atmosphereAccount?: AccountId;
  /** The organ's dry mass, unaffected by drying. */
  readonly dryMassUg: Micrograms;
  /** How much of `primaryAccount`'s mass is currently free moisture, e.g. from
   * `addFieldMoisture`'s `waterAddedUg` -- tracked explicitly rather than inferred
   * from elemental balances, since a real substance's own hydrogen and oxygen are
   * indistinguishable from added water once posted. */
  readonly currentMoistureMassUg: Micrograms;
  /** Target moisture content, by fresh mass, after drying (e.g. 0.14 for stored wheat). */
  readonly targetMoistureContent: number;
  readonly process?: string;
}

export interface DryingResult {
  readonly posting: Posting;
  readonly waterRemovedUg: Micrograms;
}

/**
 * Dry a harvested organ down to a target moisture content, moving the excess water to
 * the atmosphere via `evaporate` -- real H2O leaving a real account for a real
 * reservoir, never simply discarded.
 */
export function dryGrain(params: DryingParams): DryingResult {
  const process = params.process ?? 'agri:grain-drying';
  if (params.dryMassUg <= 0n || params.currentMoistureMassUg <= 0n) {
    return { posting: { process, entries: [] }, waterRemovedUg: 0n };
  }

  const targetContent = Math.max(0, Math.min(0.999, params.targetMoistureContent));
  const targetWaterUg = roundHalfEven(Number(params.dryMassUg) * (targetContent / (1 - targetContent)));
  const waterToRemove =
    params.currentMoistureMassUg > targetWaterUg ? params.currentMoistureMassUg - targetWaterUg : 0n;

  if (waterToRemove <= 0n) {
    return { posting: { process, entries: [] }, waterRemovedUg: 0n };
  }

  const posting = evaporate({
    waterAccount: params.primaryAccount,
    ...(params.atmosphereAccount !== undefined ? { atmosphereAccount: params.atmosphereAccount } : {}),
    waterMass: waterToRemove,
    process,
  });
  return { posting, waterRemovedUg: waterToRemove };
}
