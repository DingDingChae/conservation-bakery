import { describe, expect, it } from 'vitest';

import { kilograms } from '../core/commodity.js';
import type { Formulation } from '../bake/formulation.js';
import type { CakeDesign, DesignLayer, DesignTier } from './types.js';
import {
  CRUMB_STRENGTH_MAX_KPA,
  CRUMB_STRENGTH_MIN_KPA,
  evaluateStructure,
  minimumDowelCount,
  tierCrumbStrengthPa,
} from './structure.js';

/** Classic pound cake — equal parts flour, sugar, egg, fat — lands `structureIndex`
 * at exactly 0 (see `bake/formulation.spec.ts`), the midpoint of the crumb strength
 * span this module maps it onto. */
const POUND_CAKE: Formulation = {
  name: 'pound cake',
  ingredients: [
    { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
    { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
    { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 100 },
    { substanceId: 'butter', role: 'fat', bakersPercent: 100 },
  ],
};

/** A very rich, tender formulation — sugar and fat dominate flour and egg — lands a
 * strongly negative `structureIndex`, the weakest end of the crumb-strength span. */
const RICH_WEAK_CAKE: Formulation = {
  name: 'very rich cake',
  ingredients: [
    { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
    { substanceId: 'sucrose', role: 'sugar', bakersPercent: 180 },
    { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 20 },
    { substanceId: 'butter', role: 'fat', bakersPercent: 150 },
    { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 60 },
  ],
};

function layer(formulation: Formulation, massKg: number, heightM = 0.05): DesignLayer {
  return { id: `${formulation.name}-layer`, formulation, massUg: kilograms(massKg), heightM };
}

function tier(id: string, diameterM: number, layers: readonly DesignLayer[], overrides: Partial<DesignTier> = {}): DesignTier {
  return {
    id,
    diameterM,
    layers,
    fillings: [],
    finishes: [],
    dowelled: false,
    dowelCount: 0,
    ...overrides,
  };
}

function design(tiers: readonly DesignTier[]): CakeDesign {
  return {
    id: 'design-1',
    name: 'test design',
    tiers,
    toppers: [],
    thermal: {
      bakeTempC: 20,
      ambientTempC: 20,
      convectionCoefficientWPerM2K: 10,
      totalMassUg: kilograms(1),
      surfaceAreaM2: 0.1,
    },
  };
}

describe('tierCrumbStrengthPa', () => {
  it('lands the pound cake (structureIndex 0) at the midpoint of the published span', () => {
    const strengthPa = tierCrumbStrengthPa(tier('t', 0.2, [layer(POUND_CAKE, 1)]));
    const midpointPa = ((CRUMB_STRENGTH_MIN_KPA + CRUMB_STRENGTH_MAX_KPA) / 2) * 1_000;
    expect(strengthPa).toBeCloseTo(midpointPa, 0);
  });

  it('is weaker for a rich, tender formulation than for a lean, structured one', () => {
    const weak = tierCrumbStrengthPa(tier('t', 0.2, [layer(RICH_WEAK_CAKE, 1)]));
    const strong = tierCrumbStrengthPa(tier('t', 0.2, [layer(POUND_CAKE, 1)]));
    expect(weak).toBeLessThan(strong);
  });

  it('is zero for a tier with no layer at all', () => {
    expect(tierCrumbStrengthPa(tier('t', 0.2, []))).toBe(0);
  });
});

describe('minimumDowelCount', () => {
  it('never goes below the minimum of three', () => {
    expect(minimumDowelCount(0.05)).toBe(3);
  });

  it('scales with diameter at one dowel per 10 cm', () => {
    expect(minimumDowelCount(0.30)).toBe(3);
    expect(minimumDowelCount(0.45)).toBe(5);
  });
});

describe('evaluateStructure', () => {
  it('accepts a single tier carrying nothing above it', () => {
    const d = design([tier('base', 0.25, [layer(POUND_CAKE, 1)])]);
    const report = evaluateStructure(d);
    expect(report.ok).toBe(true);
    expect(report.tiers[0]?.loadAboveN).toBe(0);
  });

  it('refuses an overloaded, undowelled tier, naming the stress and the crumb strength', () => {
    // A deliberately heavy top tier over a small footprint and a weak, rich base
    // crumb — enough to force a real compressive failure for this test to observe.
    const base = tier('base', 0.30, [layer(RICH_WEAK_CAKE, 1)]);
    const top = tier('top', 0.20, [layer(POUND_CAKE, 25)]);
    const report = evaluateStructure(design([base, top]));

    expect(report.ok).toBe(false);
    const baseVerdict = report.tiers[0]!;
    expect(baseVerdict.ok).toBe(false);
    expect(baseVerdict.stressPa).toBeGreaterThan(baseVerdict.crumbStrengthPa);
    expect(baseVerdict.problems.map((p) => p.code)).toContain('tier-overloaded-no-dowels');
    expect(baseVerdict.problems[0]?.message).toMatch(/base/);
  });

  it('accepts the same overload once the tier is dowelled with enough dowels', () => {
    const base = tier('base', 0.30, [layer(RICH_WEAK_CAKE, 1)], { dowelled: true, dowelCount: 3 });
    const top = tier('top', 0.20, [layer(POUND_CAKE, 25)]);
    const report = evaluateStructure(design([base, top]));

    expect(report.ok).toBe(true);
    expect(report.tiers[0]?.dowelled).toBe(true);
  });

  it('refuses a tier dowelled with too few dowels for its own diameter', () => {
    const base = tier('base', 0.40, [layer(RICH_WEAK_CAKE, 1)], { dowelled: true, dowelCount: 2 });
    const top = tier('top', 0.20, [layer(POUND_CAKE, 25)]);
    const report = evaluateStructure(design([base, top]));

    expect(report.ok).toBe(false);
    expect(report.tiers[0]?.problems.map((p) => p.code)).toContain('insufficient-dowels');
  });

  it('refuses an overhanging tier wider than the tier beneath it', () => {
    const base = tier('base', 0.20, [layer(POUND_CAKE, 1)]);
    const top = tier('top', 0.30, [layer(POUND_CAKE, 0.5)]);
    const report = evaluateStructure(design([base, top]));

    expect(report.ok).toBe(false);
    expect(report.tiers[0]?.problems.map((p) => p.code)).toContain('overhanging-tier');
  });

  it('refuses a tier with no cake layer at all', () => {
    const report = evaluateStructure(design([tier('empty', 0.2, [])]));
    expect(report.ok).toBe(false);
    expect(report.tiers[0]?.problems.map((p) => p.code)).toContain('empty-tier');
  });
});
