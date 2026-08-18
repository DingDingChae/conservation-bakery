/**
 * Origin regions: the modelled import chain.
 *
 * CONTRACT.md rule 1 is "every gram in this world has a source, and that source
 * is somewhere else in this world." Every non-local ingredient this directory
 * produces — cocoa, vanilla, coffee, citrus, nuts, honey, maple syrup, mined
 * minerals — grows or is won somewhere that is not the bakery's own field, under
 * its own season, and then takes real time to arrive. An `OriginRegion` is that
 * "somewhere else": its own soil or mineral reservoir (seeded once from `GENESIS`,
 * exactly like `world/accounts.ts` seeds the bakery's own fields — see
 * `seedCropRegion`/`seedMineralRegion`), its own climate driving `agri/field.ts`'s
 * real weather-and-growth machinery, and a real, cited shipping time before a
 * harvest becomes a delivery at the bakery's gate (see `shipping.ts`).
 *
 * `kind: 'crop'` regions grow something (cocoa, vanilla, coffee, citrus, nuts,
 * berries, stone fruit, forage, sugar maple, grapevine): they carry climate
 * parameters for `agri/field.ts`'s `generateSeasonalWeather` and a soil reservoir
 * seeded the same way `world/accounts.ts`'s `seedSoil` seeds the bakery's own
 * fields. `kind: 'mineral'` regions are won, not grown (salt flats and mines,
 * phosphate rock, a soda-mineral deposit, a gold reef, a rendering works taking
 * in real hide/bone stock): they carry no climate, only a mineral reservoir
 * seeded with a real, cited elemental composition for that deposit or feedstock.
 */

import type { Element, Micrograms } from '../core/commodity.js';
import { elementCommodity, kilograms } from '../core/commodity.js';
import type { AccountId, Entry, Ledger } from '../core/ledger.js';
import { GENESIS } from '../core/ledger.js';

export type OriginRegionKind = 'crop' | 'mineral';

export interface CropClimate {
  readonly meanTemperatureC: number;
  readonly temperatureAmplitudeC: number;
  readonly peakInsolationWPerM2: number;
  readonly meanRainfallMmPerDay: number;
  /** Day of year (0..364) the growing season this region is used for begins. */
  readonly dayOfYearStart: number;
}

export interface OriginRegion {
  readonly id: string;
  readonly label: string;
  readonly kind: OriginRegionKind;
  /** Real, cited transit time from this region's gate to the bakery's, by the
   * representative bulk shipping mode for what it produces (sea freight for bulk
   * agricultural commodities and minerals, road for short-haul perishables) — see
   * each region's own inline citation below. */
  readonly shippingDays: number;
  readonly climate?: CropClimate;
  /** Growing/deposit area, square metres — sizes the reservoir `seedCropRegion`/
   * `seedMineralRegion` seeds, the same role `world/accounts.ts`'s `fieldAreaM2`
   * plays for the bakery's own fields. */
  readonly areaM2: bigint;
}

/**
 * Every origin region this directory's chains draw from. Climate figures are
 * illustrative, order-of-magnitude representative values for the named real
 * growing region or deposit type, in the same spirit as `world/accounts.ts`'s own
 * reservoir figures — the point is a real, finite, sourced "somewhere else", not
 * meteorological precision. Shipping times are real, cited, typical transit
 * durations for the commodity's usual bulk shipping mode.
 */
export const REGIONS: Readonly<Record<string, OriginRegion>> = {
  cocoaBelt: {
    id: 'cocoa-belt',
    label: 'West African cocoa belt',
    kind: 'crop',
    // Sea freight, West Africa to a European/US port, plus inland collection and
    // handling: commonly cited door-to-door lead time for bulk cocoa is on the
    // order of four to six weeks (ICCO / cocoa trade logistics literature).
    shippingDays: 30,
    areaM2: 20_000n,
    climate: {
      meanTemperatureC: 26,
      temperatureAmplitudeC: 2,
      peakInsolationWPerM2: 550,
      meanRainfallMmPerDay: 6,
      dayOfYearStart: 0,
    },
  },
  vanillaCoast: {
    id: 'vanilla-coast',
    label: 'Madagascar vanilla coast',
    kind: 'crop',
    // Bulk sea freight from the Indian Ocean to Europe/US: typically five to six
    // weeks door to door (spice trade logistics literature); high-value vanilla is
    // often air-freighted in practice, but sea freight is used here as the
    // representative bulk mode, the same modelling choice this codebase already
    // makes elsewhere (e.g. methane as "the" representative fuel gas).
    shippingDays: 35,
    areaM2: 5_000n,
    climate: {
      meanTemperatureC: 24,
      temperatureAmplitudeC: 3,
      peakInsolationWPerM2: 500,
      meanRainfallMmPerDay: 7,
      dayOfYearStart: 0,
    },
  },
  coffeeHighlands: {
    id: 'coffee-highlands',
    label: 'Tropical highland coffee region',
    kind: 'crop',
    // Sea freight from an East African or Latin American highland origin to a
    // roasting market, plus inland mountain transport: typically about four weeks.
    shippingDays: 28,
    areaM2: 15_000n,
    climate: {
      meanTemperatureC: 19,
      temperatureAmplitudeC: 3,
      peakInsolationWPerM2: 480,
      meanRainfallMmPerDay: 5,
      dayOfYearStart: 30,
    },
  },
  citrusGrove: {
    id: 'citrus-grove',
    label: 'Mediterranean-climate citrus grove',
    kind: 'crop',
    // Short-haul refrigerated road/rail freight within a continental market:
    // typically under a week.
    shippingDays: 6,
    areaM2: 25_000n,
    climate: {
      meanTemperatureC: 19,
      temperatureAmplitudeC: 6,
      peakInsolationWPerM2: 450,
      meanRainfallMmPerDay: 2,
      dayOfYearStart: 300,
    },
  },
  nutOrchard: {
    id: 'nut-orchard',
    label: 'Mediterranean-climate almond orchard',
    kind: 'crop',
    // Domestic bulk road/rail freight from a major almond-growing region:
    // typically about a week.
    shippingDays: 7,
    areaM2: 30_000n,
    climate: {
      meanTemperatureC: 16,
      temperatureAmplitudeC: 8,
      peakInsolationWPerM2: 480,
      meanRainfallMmPerDay: 1.5,
      dayOfYearStart: 60,
    },
  },
  berryField: {
    id: 'berry-field',
    label: 'Temperate berry field',
    kind: 'crop',
    // Highly perishable soft fruit: same-region refrigerated road freight,
    // typically one to two days.
    shippingDays: 2,
    areaM2: 4_000n,
    climate: {
      meanTemperatureC: 15,
      temperatureAmplitudeC: 9,
      peakInsolationWPerM2: 460,
      meanRainfallMmPerDay: 3,
      dayOfYearStart: 90,
    },
  },
  stoneFruitOrchard: {
    id: 'stone-fruit-orchard',
    label: 'Temperate stone fruit orchard',
    kind: 'crop',
    // Refrigerated regional road freight: typically three to four days.
    shippingDays: 4,
    areaM2: 8_000n,
    climate: {
      meanTemperatureC: 17,
      temperatureAmplitudeC: 10,
      peakInsolationWPerM2: 470,
      meanRainfallMmPerDay: 2.5,
      dayOfYearStart: 100,
    },
  },
  meadow: {
    id: 'meadow',
    label: 'Wildflower forage meadow',
    kind: 'crop',
    // Regional apiary collection and short-haul road freight: about a week.
    shippingDays: 7,
    areaM2: 50_000n,
    climate: {
      meanTemperatureC: 17,
      temperatureAmplitudeC: 9,
      peakInsolationWPerM2: 440,
      meanRainfallMmPerDay: 2.5,
      dayOfYearStart: 100,
    },
  },
  sugarBush: {
    id: 'sugar-bush',
    label: 'Northeastern sugar maple bush',
    kind: 'crop',
    // Domestic road freight from a maple sugaring region: about a week.
    shippingDays: 7,
    areaM2: 40_000n,
    climate: {
      // A maple "sugaring season" runs during the freeze/thaw window in early
      // spring — a cold mean temperature straddling 0 C, which is what actually
      // drives the freeze/thaw sap-flow cycle real sugarmakers rely on.
      meanTemperatureC: 2,
      temperatureAmplitudeC: 6,
      peakInsolationWPerM2: 350,
      meanRainfallMmPerDay: 2,
      dayOfYearStart: 60,
    },
  },
  vineyard: {
    id: 'vineyard',
    label: 'Wine-region vineyard (tartrate lees)',
    // Cream of tartar is not grown directly — it crystallises from the
    // potassium- and tartaric-acid-rich lees left after winemaking, so this
    // region is modelled as a mineral-style deposit (a store of real,
    // already-fixed organic-acid-and-mineral mass, seeded once), not a fresh
    // growth cycle — see origin/minerals.ts.
    kind: 'mineral',
    shippingDays: 15,
    areaM2: 12_000n,
  },
  saltCoast: {
    id: 'salt-coast',
    label: 'Arid coastal saltworks (solar evaporation)',
    kind: 'mineral',
    // Bulk road/rail freight of a mined mineral commodity: typically about two weeks.
    shippingDays: 14,
    areaM2: 200_000n,
  },
  saltMine: {
    id: 'salt-mine',
    label: 'Continental rock-salt mine',
    kind: 'mineral',
    shippingDays: 12,
    areaM2: 5_000n,
  },
  phosphateBelt: {
    id: 'phosphate-belt',
    label: 'Phosphate-rock mineral belt',
    kind: 'mineral',
    // Bulk carrier plus inland rail for an industrial mineral feedstock:
    // typically about three weeks.
    shippingDays: 21,
    areaM2: 8_000n,
  },
  sodaDeposit: {
    id: 'soda-deposit',
    label: 'Trona (soda-mineral) deposit',
    kind: 'mineral',
    shippingDays: 18,
    areaM2: 8_000n,
  },
  goldReef: {
    id: 'gold-reef',
    label: 'Gold reef and refinery',
    kind: 'mineral',
    // Low-volume, high-value, security-handled freight: typically about three
    // to four weeks including refining and assay.
    shippingDays: 25,
    areaM2: 1_000n,
  },
  renderingWorks: {
    id: 'rendering-works',
    label: 'Rendering works (hide and bone stock)',
    kind: 'mineral',
    // Domestic bulk road freight for an industrial feedstock: about a week.
    shippingDays: 7,
    areaM2: 2_000n,
  },
} as const;

/** The account a crop region's own soil (or a mineral region's own deposit)
 * lives in — one region, one finite reservoir, exactly `world/accounts.ts`'s
 * `soilAccount` pattern applied to a region rather than a bakery-side field. */
export function originReservoirAccount(region: OriginRegion): AccountId {
  return `origin.${region.id}.reservoir`;
}

/** The account a region's own finished, ready-to-ship production accumulates
 * in before `shipping.ts` moves it to the bakery — the "warehouse at the gate"
 * a real delivery departs from. */
export function originWarehouseAccount(region: OriginRegion): AccountId {
  return `origin.${region.id}.warehouse`;
}

/** The account by-products that stay at origin (husk, shell, pomace, spent
 * lees) accumulate in — real, conserved mass that simply never ships, exactly
 * like a real farm's own compost or mill-tailings heap. A plain `stock`
 * account, so it can grow without bound but never goes negative. */
export function originResidueAccount(region: OriginRegion): AccountId {
  return `origin.${region.id}.residue`;
}

/** Post a genesis draw for one region's reservoir: every credited element is
 * matched by an equal and opposite debit from `GENESIS`, in one posting, so it
 * balances by construction — the same technique `world/accounts.ts`'s
 * `seedFrom` uses. Must run before `ledger.seal()`; genesis is a one-time phase
 * (see `core/ledger.ts`'s `SealedLedgerError`). */
function seedFromGenesis(ledger: Ledger, process: string, account: AccountId, byElement: ReadonlyMap<Element, Micrograms>): void {
  const entries: Entry[] = [];
  for (const [element, amount] of byElement) {
    if (amount === 0n) continue;
    entries.push({ account, commodity: elementCommodity(element), delta: amount });
    entries.push({ account: GENESIS, commodity: elementCommodity(element), delta: -amount });
  }
  if (entries.length === 0) return;
  ledger.post({ process, entries });
}

/** Bulk density and effective depth of a region's own tilled soil, matching
 * `world/accounts.ts`'s own topsoil figure (~1,300 kg/m^3 over ~0.15 m) — the
 * point is that a region's soil is a real, finite, order-of-magnitude quantity
 * of the right physical scale, not a literal survey of any one place. */
const TOPSOIL_KG_PER_M2 = 195n;

/**
 * Open and seed a crop region's own soil reservoir, in the same illustrative,
 * order-of-magnitude spirit as `world/accounts.ts`'s `seedSoil`: oxygen-
 * dominated mineral mass, a few percent organic carbon, and the usual trace
 * macronutrients, sized to the region's own `areaM2`. Warehouse account is
 * opened alongside it (a plain `stock` account for finished, harvested/processed
 * production awaiting shipment).
 */
export function seedCropRegion(ledger: Ledger, region: OriginRegion): void {
  if (region.kind !== 'crop') throw new RangeError(`region "${region.id}" is not a crop region`);
  const reservoir = originReservoirAccount(region);
  const warehouse = originWarehouseAccount(region);
  const residue = originResidueAccount(region);
  if (!ledger.hasAccount(reservoir)) ledger.openAccount({ id: reservoir, kind: 'reservoir', label: `the soil of ${region.label}` });
  if (!ledger.hasAccount(warehouse)) ledger.openAccount({ id: warehouse, kind: 'stock', label: `finished production at ${region.label}, awaiting shipment` });
  if (!ledger.hasAccount(residue)) ledger.openAccount({ id: residue, kind: 'stock', label: `by-products remaining at ${region.label}` });

  const totalMassUg = kilograms(region.areaM2 * TOPSOIL_KG_PER_M2);
  const shares: Readonly<Record<Element, number>> = {
    O: 0.49, Ash: 0.3316, Fe: 0.035, Ca: 0.025, Mg: 0.015, K: 0.015, Na: 0.01, S: 0.002, C: 0.03, N: 0.002, P: 0.0005, H: 0.0439, Cl: 0,
  };
  const byElement = new Map<Element, Micrograms>();
  let assigned = 0n;
  const entries = Object.entries(shares) as [Element, number][];
  for (const [element, frac] of entries) {
    if (frac <= 0) continue;
    const amount = (totalMassUg * BigInt(Math.round(frac * 1_000_000))) / 1_000_000n;
    byElement.set(element, amount);
    assigned += amount;
  }
  // Any rounding residual (a handful of micrograms out of billions) closes into
  // Ash, the pseudo-element catch-all — never left unaccounted for.
  const residual = totalMassUg - assigned;
  if (residual !== 0n) byElement.set('Ash', (byElement.get('Ash') ?? 0n) + residual);

  seedFromGenesis(ledger, `genesis:origin-soil:${region.id}`, reservoir, byElement);
}

/**
 * Open and seed a mineral region's own deposit reservoir with a real, cited
 * elemental composition (fractions of the total, need not sum to 1 — any
 * shortfall closes into `Ash`, the untracked-mineral catch-all, exactly like
 * `seedCropRegion`).
 */
export function seedMineralRegion(
  ledger: Ledger,
  region: OriginRegion,
  shares: Readonly<Partial<Record<Element, number>>>,
): void {
  if (region.kind !== 'mineral') throw new RangeError(`region "${region.id}" is not a mineral region`);
  const reservoir = originReservoirAccount(region);
  const warehouse = originWarehouseAccount(region);
  const residue = originResidueAccount(region);
  if (!ledger.hasAccount(reservoir)) ledger.openAccount({ id: reservoir, kind: 'reservoir', label: `the deposit at ${region.label}` });
  if (!ledger.hasAccount(warehouse)) ledger.openAccount({ id: warehouse, kind: 'stock', label: `finished production at ${region.label}, awaiting shipment` });
  if (!ledger.hasAccount(residue)) ledger.openAccount({ id: residue, kind: 'stock', label: `by-products remaining at ${region.label}` });

  const totalMassUg = kilograms(region.areaM2 * TOPSOIL_KG_PER_M2);
  const byElement = new Map<Element, Micrograms>();
  let assigned = 0n;
  for (const [element, frac] of Object.entries(shares) as [Element, number][]) {
    if (!frac || frac <= 0) continue;
    const amount = (totalMassUg * BigInt(Math.round(frac * 1_000_000))) / 1_000_000n;
    byElement.set(element, amount);
    assigned += amount;
  }
  const residual = totalMassUg - assigned;
  if (residual !== 0n) byElement.set('Ash', (byElement.get('Ash') ?? 0n) + residual);

  seedFromGenesis(ledger, `genesis:origin-mineral:${region.id}`, reservoir, byElement);
}
