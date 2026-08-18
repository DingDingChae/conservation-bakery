import { describe, expect, it } from 'vitest';

import { kilograms } from '../core/commodity.js';
import { GLAZING_DEFINITION, ICING_DEPOSITOR_DEFINITION } from '../plant/equipment/finishing.js';
import type { Formulation } from '../bake/formulation.js';
import type { CakeDesign, DesignTier } from './types.js';
import type { DesignEvaluationInputs } from './evaluate.js';
import { evaluateDesign } from './evaluate.js';

const SPONGE: Formulation = {
  name: 'sponge',
  ingredients: [
    { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
    { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
    { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 100 },
    { substanceId: 'butter', role: 'fat', bakersPercent: 100 },
  ],
};

function tier(id: string, diameterM: number, overrides: Partial<DesignTier> = {}): DesignTier {
  return {
    id,
    diameterM,
    layers: [{ id: `${id}-layer`, formulation: SPONGE, massUg: kilograms(1), heightM: 0.05 }],
    fillings: [],
    finishes: [{ id: `${id}-icing`, kind: 'icing', substanceId: 'sucrose', massUg: kilograms(0.2), elapsedSecondsSinceBake: 100_000 }],
    dowelled: false,
    dowelCount: 0,
    ...overrides,
  };
}

function design(tiers: readonly DesignTier[]): CakeDesign {
  return {
    id: 'd',
    name: 'evaluate test',
    tiers,
    toppers: [],
    thermal: { bakeTempC: 180, ambientTempC: 21, convectionCoefficientWPerM2K: 10, totalMassUg: kilograms(1), surfaceAreaM2: 0.1 },
  };
}

const INPUTS: DesignEvaluationInputs = {
  inventory: {
    stockUg: new Map([
      ['wheat-flour-white', kilograms(100)],
      ['sucrose', kilograms(100)],
      ['hen-egg-whole', kilograms(100)],
      ['butter', kilograms(100)],
    ]),
  },
  line: {
    availableEquipmentTypes: new Set([ICING_DEPOSITOR_DEFINITION.type, GLAZING_DEFINITION.type]),
    promisedMinutes: 1_000,
  },
  prices: {
    pricePerKgMinorUnitsBySubstance: new Map([
      ['wheat-flour-white', 60n],
      ['sucrose', 90n],
      ['hen-egg-whole', 300n],
      ['butter', 550n],
    ]),
  },
  hourlyWageMinorUnits: 1_500n,
};

describe('evaluateDesign', () => {
  it('accepts a physically real, feasible, in-stock, cooled design', () => {
    const evaluation = evaluateDesign(design([tier('base', 0.25)]), INPUTS);
    expect(evaluation.accepted).toBe(true);
    expect(evaluation.structure.ok).toBe(true);
    expect(evaluation.thermal.ok).toBe(true);
    expect(evaluation.feasibility.ok).toBe(true);
    expect(evaluation.cost.totalCostMinorUnits).toBeGreaterThan(0n);
  });

  it('refuses on a structural failure even when thermal and feasibility are fine', () => {
    const base = tier('base', 0.30, {
      finishes: [],
      layers: [{ id: 'weak', formulation: { name: 'weak', ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
        { substanceId: 'sucrose', role: 'sugar', bakersPercent: 180 },
        { substanceId: 'butter', role: 'fat', bakersPercent: 150 },
      ] }, massUg: kilograms(1), heightM: 0.05 }],
    });
    const top = tier('top', 0.20, { finishes: [], layers: [{ id: 'heavy', formulation: SPONGE, massUg: kilograms(25), heightM: 0.05 }] });
    const evaluation = evaluateDesign(design([base, top]), INPUTS);

    expect(evaluation.structure.ok).toBe(false);
    expect(evaluation.accepted).toBe(false);
  });

  it('refuses a design whose finish is applied while the cake is still too warm', () => {
    const warm = tier('base', 0.25, {
      finishes: [{ id: 'fondant', kind: 'fondant', substanceId: 'sucrose', massUg: kilograms(0.3), elapsedSecondsSinceBake: 10 }],
    });
    const evaluation = evaluateDesign(design([warm]), INPUTS);
    expect(evaluation.thermal.ok).toBe(false);
    expect(evaluation.accepted).toBe(false);
  });

  it('refuses a design the line cannot build from real stock, naming the shortfall', () => {
    const scarce: DesignEvaluationInputs = {
      ...INPUTS,
      inventory: { stockUg: new Map([['sucrose', kilograms(0.01)]]) },
    };
    const evaluation = evaluateDesign(design([tier('base', 0.25)]), scarce);
    expect(evaluation.feasibility.ok).toBe(false);
    expect(evaluation.feasibility.problems.some((p) => p.code === 'insufficient-stock')).toBe(true);
    expect(evaluation.accepted).toBe(false);
  });

  it('still computes a cost even for a refused design, so a designer can see what it would cost to fix', () => {
    const scarce: DesignEvaluationInputs = { ...INPUTS, inventory: { stockUg: new Map() } };
    const evaluation = evaluateDesign(design([tier('base', 0.25)]), scarce);
    expect(evaluation.accepted).toBe(false);
    expect(evaluation.cost.totalCostMinorUnits).toBeGreaterThan(0n);
  });
});
