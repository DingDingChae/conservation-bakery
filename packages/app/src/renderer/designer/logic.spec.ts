import { describe, expect, it } from 'vitest';

import type { CakeDesign, FeasibilityProblem, StructuralProblem, ThermalProblem, TierStructuralVerdict } from '@conservation-bakery/sim';
import type { Translate } from '../context.js';
import {
  FORMULATION_PRESETS,
  REFERENCE_HOURLY_WAGE_MINOR_UNITS,
  REFERENCE_INVENTORY,
  REFERENCE_LINE,
  REFERENCE_PRICES,
  buildDefaultDesign,
  buildDefaultTier,
  computeElevationGeometry,
  defaultSubstanceForFinish,
  describeFeasibilityProblem,
  describeStructuralProblem,
  describeThermalProblem,
  finishKindCatalogueKey,
  resetIdCounterForTests,
} from './logic.js';

/** A recording `Translate` that just returns `key` with its interpolated values
 * appended, so a test can assert both which key was used and what was interpolated
 * into it, without depending on real catalogue copy. */
function recordingTranslate(): Translate {
  return (key, values) => `${key}${values ? JSON.stringify(values) : ''}`;
}

describe('reference kitchen', () => {
  it('is generously stocked and fully equipped, so a default design is always accepted by it', async () => {
    const { evaluateDesign } = await import('@conservation-bakery/sim');
    const design = buildDefaultDesign();
    const evaluation = evaluateDesign(design, {
      inventory: REFERENCE_INVENTORY,
      line: REFERENCE_LINE,
      prices: REFERENCE_PRICES,
      hourlyWageMinorUnits: REFERENCE_HOURLY_WAGE_MINOR_UNITS,
    });
    expect(evaluation.accepted).toBe(true);
  });
});

describe('buildDefaultDesign and friends', () => {
  it('builds a design with one tier, one layer and one finish', () => {
    resetIdCounterForTests();
    const design: CakeDesign = buildDefaultDesign();
    expect(design.tiers).toHaveLength(1);
    expect(design.tiers[0]?.layers).toHaveLength(1);
    expect(design.tiers[0]?.finishes).toHaveLength(1);
  });

  it('gives every freshly built entity a distinct id', () => {
    resetIdCounterForTests();
    const a = buildDefaultTier();
    const b = buildDefaultTier();
    expect(a.id).not.toBe(b.id);
  });

  it('defaults every finish to a physically apt substance', () => {
    expect(defaultSubstanceForFinish('ganache')).toBe('cocoa-butter');
    expect(defaultSubstanceForFinish('fondant')).toBe('sucrose');
    expect(defaultSubstanceForFinish('icing')).toBe('sucrose');
    expect(defaultSubstanceForFinish('transfer')).toBe('sucrose');
    expect(defaultSubstanceForFinish('buttercream')).toBe('butter');
    expect(defaultSubstanceForFinish('crumbCoat')).toBe('butter');
    expect(defaultSubstanceForFinish('piping')).toBe('butter');
  });

  it('offers at least two real formulations at different structural strengths', () => {
    expect(FORMULATION_PRESETS.length).toBeGreaterThanOrEqual(2);
  });
});

describe('computeElevationGeometry', () => {
  it('stacks tiers bottom to top with no gaps or overlaps', () => {
    resetIdCounterForTests();
    const design = buildDefaultDesign();
    const secondTier = buildDefaultTier();
    const withTwoTiers: CakeDesign = { ...design, tiers: [...design.tiers, secondTier] };

    const geometry = computeElevationGeometry(withTwoTiers);
    expect(geometry.tiers).toHaveLength(2);
    const [first, second] = geometry.tiers;
    expect(first?.bottomM).toBe(0);
    expect(second?.bottomM).toBeCloseTo(first!.heightM, 10);
    expect(geometry.totalHeightM).toBeCloseTo(first!.heightM + second!.heightM, 10);
  });

  it('reports the widest tier as the max diameter', () => {
    resetIdCounterForTests();
    const design = buildDefaultDesign();
    const wideTier = { ...buildDefaultTier(), diameterM: 0.5 };
    const withWideTier: CakeDesign = { ...design, tiers: [...design.tiers, wideTier] };
    expect(computeElevationGeometry(withWideTier).maxDiameterM).toBe(0.5);
  });

  it('is empty for a design with no tiers', () => {
    resetIdCounterForTests();
    const design = buildDefaultDesign();
    const empty: CakeDesign = { ...design, tiers: [] };
    const geometry = computeElevationGeometry(empty);
    expect(geometry.tiers).toEqual([]);
    expect(geometry.totalHeightM).toBe(0);
  });
});

describe('register-aware problem descriptions', () => {
  const t = recordingTranslate();

  const verdict: TierStructuralVerdict = {
    tierId: 'tier-1',
    ok: false,
    loadAboveN: 100,
    bearingAreaM2: 0.01,
    stressPa: 20_000,
    crumbStrengthPa: 10_000,
    dowelled: false,
    dowelCount: 0,
    minimumDowelCount: 3,
    problems: [],
  };

  it('routes every structural problem code to its own catalogue key with real interpolated values', () => {
    const overloaded: StructuralProblem = { code: 'tier-overloaded-no-dowels', message: 'ignored' };
    const description = describeStructuralProblem(t, verdict, overloaded);
    expect(description).toContain('designer.structure.problem.tierOverloadedNoDowels');
    expect(description).toContain('"tier":"tier-1"');
    expect(description).toContain('"stress":20');
    expect(description).toContain('"strength":10');

    expect(describeStructuralProblem(t, verdict, { code: 'empty-tier', message: 'x' })).toContain(
      'designer.structure.problem.emptyTier',
    );
    expect(describeStructuralProblem(t, verdict, { code: 'insufficient-dowels', message: 'x' })).toContain(
      'designer.structure.problem.insufficientDowels',
    );
    expect(describeStructuralProblem(t, verdict, { code: 'overhanging-tier', message: 'x' })).toContain(
      'designer.structure.problem.overhangingTier',
    );
  });

  it('routes every thermal problem code to its own catalogue key, naming the finish kind for the buttercream family', () => {
    const fondant: ThermalProblem = { code: 'fondant-substrate-too-warm', message: 'ignored' };
    expect(describeThermalProblem(t, 'fondant', 30, fondant)).toContain('designer.thermal.problem.fondantTooWarm');

    const ganache: ThermalProblem = { code: 'ganache-substrate-too-warm', message: 'ignored' };
    expect(describeThermalProblem(t, 'ganache', 30, ganache)).toContain('designer.thermal.problem.ganacheTooWarm');

    const buttercreamProblem: ThermalProblem = { code: 'buttercream-family-substrate-too-warm', message: 'ignored' };
    const description = describeThermalProblem(t, 'buttercream', 26, buttercreamProblem);
    expect(description).toContain('designer.thermal.problem.buttercreamFamilyTooWarm');
    expect(description).toContain(finishKindCatalogueKey('buttercream'));
  });

  it('routes every feasibility problem code to its own catalogue key with the real numeric facts', () => {
    const missing: FeasibilityProblem = { code: 'missing-equipment', equipmentType: 'glazer', message: 'x' };
    expect(describeFeasibilityProblem(t, missing)).toContain('"equipment":"glazer"');

    const time: FeasibilityProblem = { code: 'insufficient-time', neededMinutes: 12.3, promisedMinutes: 5, message: 'x' };
    const timeDescription = describeFeasibilityProblem(t, time);
    expect(timeDescription).toContain('"needed":12.3');
    expect(timeDescription).toContain('"promised":5');

    const stock: FeasibilityProblem = {
      code: 'insufficient-stock',
      substanceId: 'butter',
      neededUg: 2_000_000n,
      availableUg: 500_000n,
      shortfallUg: 1_500_000n,
      message: 'x',
    };
    const stockDescription = describeFeasibilityProblem(t, stock);
    expect(stockDescription).toContain('"substance":"butter"');
    expect(stockDescription).toContain('"needed":2');
    expect(stockDescription).toContain('"available":0.5');
    expect(stockDescription).toContain('"shortfall":1.5');
  });
});
