/**
 * Designer: pure logic.
 *
 * Everything here is deterministic, has no DOM dependency, and takes plain data in
 * and plain data out — the reference "line" a design is checked against, the small
 * set of real formulations and substances a keyboard-only editor can choose from
 * without a search field, the geometry the cross-section elevation is drawn from, and
 * the mapping from a structural/thermal/feasibility problem's structured fields
 * (never its bare English sentence — see `@conservation-bakery/sim`'s own doc
 * comments) onto a real, translatable catalogue key. `panel.ts` is DOM plumbing only;
 * every decision that can be tested without a document is made here instead, exactly
 * the split `faceplate/logic.ts` already established for this renderer.
 *
 * ## Why this module holds its own reference kitchen
 *
 * `evaluateDesign` (from `@conservation-bakery/sim`) needs a real `Inventory`,
 * `LineCapability`, `PriceTable` and hourly wage to check a design against. The
 * live, canonical version of that state belongs to the running simulation, reached
 * only through `shared/ipc.ts`'s `Command`/`WorldSnapshot` seam — a seam this task
 * does not own and that carries no cake-designer channel today. Rather than block on
 * that, or invent a second, parallel copy of the simulation's own state, this module
 * declares one clearly named reference kitchen (`REFERENCE_INVENTORY`,
 * `REFERENCE_LINE`, `REFERENCE_PRICES`, `REFERENCE_HOURLY_WAGE_MINOR_UNITS`), built
 * from the same real equipment families `plant/equipment/finishing.ts` defines and
 * representative per-kilogram prices in the same range `econ/market.ts` itself uses
 * for these ingredients — a real, working bakery a design can be checked against
 * today, honestly presented as a reference kitchen rather than live plant state.
 */

import type {
  CakeDesign,
  DesignFilling,
  DesignFinish,
  DesignLayer,
  DesignTier,
  DesignTopper,
  FeasibilityProblem,
  FinishKind,
  Inventory,
  LineCapability,
  PriceTable,
  StructuralProblem,
  ThermalProblem,
  TierStructuralVerdict,
} from '@conservation-bakery/sim';
import type { Translate } from '../context.js';

// ---------------------------------------------------------------------------
// The reference kitchen — see the module doc comment for why this exists here.
// ---------------------------------------------------------------------------

/** Kilograms, expressed as the `bigint` micrograms every conserved mass in this
 * simulation is stored as (CONTRACT.md: "conserved quantities are always bigint"). */
function kilograms(value: number): bigint {
  return BigInt(Math.round(value * 1_000_000_000));
}

/** A generously stocked reference pantry — real substance ids from
 * `packages/data/substances`, each held far past anything one design plausibly needs,
 * so a design is refused for a real shortfall and not for this reference kitchen
 * simply being too small. */
export const REFERENCE_INVENTORY: Inventory = {
  stockUg: new Map([
    ['wheat-flour-white', kilograms(200)],
    ['sucrose', kilograms(200)],
    ['hen-egg-whole', kilograms(80)],
    ['butter', kilograms(150)],
    ['water-liquid', kilograms(100)],
    ['cocoa-butter', kilograms(40)],
    ['honey', kilograms(20)],
    ['cream', kilograms(40)],
    ['gelatin', kilograms(5)],
    ['cherry', kilograms(20)],
    ['strawberry', kilograms(20)],
    ['gold-leaf', kilograms(0.05)],
  ]),
};

/** Every finishing machine family `plant/equipment/finishing.ts` defines, by its own
 * `MachineDefinition.type` string — a fully equipped decoration line. */
export const REFERENCE_LINE: LineCapability = {
  availableEquipmentTypes: new Set([
    'icing-depositor',
    'glazer',
    'layering-line',
    'edible-ink-printer',
  ]),
  promisedMinutes: 45,
};

/** Representative per-kilogram prices, minor currency units — the same order of
 * magnitude `econ/market.ts`'s own `basePriceMinorUnitsPerKg` figures use for these
 * ingredients (flour, sugar, butter and egg prices are drawn directly from that
 * module's own base prices; the rest are representative bakery figures for
 * ingredients that module does not price). */
export const REFERENCE_PRICES: PriceTable = {
  pricePerKgMinorUnitsBySubstance: new Map([
    ['wheat-flour-white', 60n],
    ['sucrose', 90n],
    ['hen-egg-whole', 300n],
    ['butter', 550n],
    ['water-liquid', 1n],
    ['cocoa-butter', 1_400n],
    ['honey', 900n],
    ['cream', 400n],
    ['gelatin', 1_800n],
    ['cherry', 700n],
    ['strawberry', 650n],
    ['gold-leaf', 900_000n],
  ]),
};

/** A representative bakery-decorator hourly wage, minor currency units — the same
 * order of magnitude `econ/staff.ts`'s own `Worker.hourlyWageMinorUnits` figures use. */
export const REFERENCE_HOURLY_WAGE_MINOR_UNITS = 1_800n;

// ---------------------------------------------------------------------------
// A small, real, keyboard-choosable set of formulations and substances — enough to
// build a real design without a search field, per this surface's accessibility
// obligation (every control reachable by keyboard alone).
// ---------------------------------------------------------------------------

export interface FormulationPreset {
  readonly id: string;
  readonly labelKey: string;
  readonly formulation: DesignLayer['formulation'];
}

/**
 * Two real, classic formulations (Gisslen, *Professional Baking* — the same source
 * `bake/formulation.ts` cites for its own balance rules), at opposite ends of
 * `structureIndex`: pound cake sits at exactly 0 (see that module's own tests);
 * genoise, a lean whipped-egg sponge, sits well into positive (strong) territory.
 * `bake/catalog.ts`'s full 39-cake catalogue is not used here because it loads from
 * disk (`node:fs`) at read time — deliberately out of reach of a browser renderer
 * bundle (see `docs/ARCHITECTURE.md`'s seam rule) — so this module states its own
 * small, real formulation set directly instead.
 */
export const FORMULATION_PRESETS: readonly FormulationPreset[] = [
  {
    id: 'pound-cake',
    labelKey: 'designer.formulation.poundCake',
    formulation: {
      name: 'pound cake',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
        { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
        { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 100 },
        { substanceId: 'butter', role: 'fat', bakersPercent: 100 },
      ],
    },
  },
  {
    id: 'genoise',
    labelKey: 'designer.formulation.genoise',
    formulation: {
      name: 'genoise',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
        { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
        { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 166 },
        { substanceId: 'butter', role: 'fat', bakersPercent: 20 },
      ],
    },
  },
];

export interface SubstancePreset {
  readonly id: string;
  readonly labelKey: string;
}

/** Real substance ids from `packages/data/substances`, each with a catalogue label —
 * the fixed, keyboard-selectable set fillings, finishes and toppers choose from. */
export const SUBSTANCE_PRESETS: readonly SubstancePreset[] = [
  { id: 'butter', labelKey: 'designer.substance.butter' },
  { id: 'sucrose', labelKey: 'designer.substance.sucrose' },
  { id: 'cocoa-butter', labelKey: 'designer.substance.cocoaButter' },
  { id: 'honey', labelKey: 'designer.substance.honey' },
  { id: 'cream', labelKey: 'designer.substance.cream' },
  { id: 'gelatin', labelKey: 'designer.substance.gelatin' },
  { id: 'cherry', labelKey: 'designer.substance.cherry' },
  { id: 'strawberry', labelKey: 'designer.substance.strawberry' },
  { id: 'gold-leaf', labelKey: 'designer.substance.goldLeaf' },
];

/** The default substance a newly added finish of `kind` starts with — a real,
 * physically apt default (buttercream-family finishes default to butter, a chocolate
 * finish to cocoa butter, a sugar finish to sucrose), editable afterward like any
 * other field. */
export function defaultSubstanceForFinish(kind: FinishKind): string {
  switch (kind) {
    case 'ganache':
      return 'cocoa-butter';
    case 'icing':
    case 'fondant':
    case 'transfer':
      return 'sucrose';
    default:
      return 'butter';
  }
}

// ---------------------------------------------------------------------------
// Default builders — every "add" action in the panel starts from one of these, so a
// newly added tier/layer/filling/finish/topper is always a real, physically coherent
// starting point rather than a blank the panel would otherwise have to special-case.
// ---------------------------------------------------------------------------

let nextId = 0;
export function freshId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

/** Resets the id counter — for tests only, so ids are deterministic per test run. */
export function resetIdCounterForTests(): void {
  nextId = 0;
}

export function buildDefaultLayer(): DesignLayer {
  const preset = FORMULATION_PRESETS[0]!;
  return { id: freshId('layer'), formulation: preset.formulation, massUg: kilograms(1), heightM: 0.05 };
}

export function buildDefaultTier(): DesignTier {
  return {
    id: freshId('tier'),
    diameterM: 0.2,
    layers: [buildDefaultLayer()],
    fillings: [],
    finishes: [buildDefaultFinish('icing')],
    dowelled: false,
    dowelCount: 3,
  };
}

export function buildDefaultFilling(): DesignFilling {
  return { id: freshId('filling'), substanceId: 'honey', massUg: kilograms(0.1), heightM: 0.01 };
}

export function buildDefaultFinish(kind: FinishKind): DesignFinish {
  return {
    id: freshId('finish'),
    kind,
    substanceId: defaultSubstanceForFinish(kind),
    massUg: kilograms(0.3),
    elapsedSecondsSinceBake: 3_600,
  };
}

export function buildDefaultTopper(tierId: string): DesignTopper {
  return { id: freshId('topper'), tierId, substanceId: 'gold-leaf', massUg: kilograms(0.01) };
}

export function buildDefaultDesign(): CakeDesign {
  return {
    id: 'design',
    name: 'New design',
    tiers: [buildDefaultTier()],
    toppers: [],
    thermal: {
      bakeTempC: 180,
      ambientTempC: 21,
      convectionCoefficientWPerM2K: 10,
      totalMassUg: kilograms(1),
      surfaceAreaM2: 0.15,
    },
  };
}

// ---------------------------------------------------------------------------
// Register-aware problem descriptions. Every structured problem field is
// interpolated into a real catalogue key — panel register states the real physical
// figures; Kid register explains the same fact in plain language, per this surface's
// register-aware obligation. Neither register ever shows the sim's own bare English
// sentence, which exists only for a non-UI caller.
// ---------------------------------------------------------------------------

function kilopascals(pa: number): number {
  return Math.round((pa / 1_000) * 10) / 10;
}

function grams(massUg: bigint): number {
  return Math.round(Number(massUg) / 100_000) / 10;
}

export function describeStructuralProblem(t: Translate, verdict: TierStructuralVerdict, problem: StructuralProblem): string {
  switch (problem.code) {
    case 'empty-tier':
      return t('designer.structure.problem.emptyTier', { tier: verdict.tierId });
    case 'tier-overloaded-no-dowels':
      return t('designer.structure.problem.tierOverloadedNoDowels', {
        tier: verdict.tierId,
        stress: kilopascals(verdict.stressPa),
        strength: kilopascals(verdict.crumbStrengthPa),
      });
    case 'insufficient-dowels':
      return t('designer.structure.problem.insufficientDowels', {
        tier: verdict.tierId,
        count: verdict.dowelCount,
        required: verdict.minimumDowelCount,
      });
    case 'overhanging-tier':
      return t('designer.structure.problem.overhangingTier', { tier: verdict.tierId });
  }
}

export function describeThermalProblem(t: Translate, kind: FinishKind, productTempC: number, problem: ThermalProblem): string {
  const temp = Math.round(productTempC * 10) / 10;
  switch (problem.code) {
    case 'fondant-substrate-too-warm':
      return t('designer.thermal.problem.fondantTooWarm', { temp });
    case 'ganache-substrate-too-warm':
      return t('designer.thermal.problem.ganacheTooWarm', { temp });
    case 'buttercream-family-substrate-too-warm':
      return t('designer.thermal.problem.buttercreamFamilyTooWarm', {
        temp,
        kind: t(finishKindCatalogueKey(kind)),
      });
  }
}

export function describeFeasibilityProblem(t: Translate, problem: FeasibilityProblem): string {
  switch (problem.code) {
    case 'missing-equipment':
      return t('designer.feasibility.problem.missingEquipment', { equipment: problem.equipmentType });
    case 'insufficient-time':
      return t('designer.feasibility.problem.insufficientTime', {
        needed: Math.round(problem.neededMinutes * 10) / 10,
        promised: Math.round(problem.promisedMinutes * 10) / 10,
      });
    case 'insufficient-stock':
      return t('designer.feasibility.problem.insufficientStock', {
        substance: problem.substanceId,
        needed: grams(problem.neededUg),
        available: grams(problem.availableUg),
        shortfall: grams(problem.shortfallUg),
      });
  }
}

const FINISH_KIND_CATALOGUE_KEY: Readonly<Record<FinishKind, string>> = {
  crumbCoat: 'designer.finish.kind.crumbCoat',
  icing: 'designer.finish.kind.icing',
  buttercream: 'designer.finish.kind.buttercream',
  ganache: 'designer.finish.kind.ganache',
  fondant: 'designer.finish.kind.fondant',
  piping: 'designer.finish.kind.piping',
  transfer: 'designer.finish.kind.transfer',
};

export function finishKindCatalogueKey(kind: FinishKind): string {
  return FINISH_KIND_CATALOGUE_KEY[kind];
}

// ---------------------------------------------------------------------------
// Elevation geometry — a real cross-section, computed here so `elevation.spec.ts` can
// check it without a DOM; `panel.ts` only turns these plain rectangles into SVG nodes.
// ---------------------------------------------------------------------------

export interface TierElevationRect {
  readonly tierId: string;
  /** Metres from the base of the stack to the bottom of this tier. */
  readonly bottomM: number;
  readonly heightM: number;
  readonly diameterM: number;
  readonly dowelled: boolean;
}

export interface ElevationGeometry {
  readonly tiers: readonly TierElevationRect[];
  readonly totalHeightM: number;
  readonly maxDiameterM: number;
}

function tierHeightM(tier: DesignTier): number {
  const layerHeight = tier.layers.reduce((sum, l) => sum + l.heightM, 0);
  const fillingHeight = tier.fillings.reduce((sum, f) => sum + f.heightM, 0);
  return layerHeight + fillingHeight;
}

export function computeElevationGeometry(design: CakeDesign): ElevationGeometry {
  let bottomM = 0;
  const tiers: TierElevationRect[] = [];
  let maxDiameterM = 0;
  for (const tier of design.tiers) {
    const heightM = Math.max(tierHeightM(tier), 0.01);
    tiers.push({ tierId: tier.id, bottomM, heightM, diameterM: tier.diameterM, dowelled: tier.dowelled });
    bottomM += heightM;
    maxDiameterM = Math.max(maxDiameterM, tier.diameterM);
  }
  return { tiers, totalHeightM: bottomM, maxDiameterM };
}
