import { describe, expect, it } from 'vitest';

import { kilograms } from '../core/commodity.js';
import { GLAZING_DEFINITION, ICING_DEPOSITOR_DEFINITION, LAYERING_LINE_DEFINITION } from '../plant/equipment/finishing.js';
import type { Formulation } from '../bake/formulation.js';
import type { CakeDesign, DesignFinish, DesignTier } from './types.js';
import type { Inventory, LineCapability } from './feasibility.js';
import { evaluateFeasibility } from './feasibility.js';

const SIMPLE_SPONGE: Formulation = {
  name: 'sponge',
  ingredients: [
    { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
    { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
    { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 100 },
    { substanceId: 'butter', role: 'fat', bakersPercent: 100 },
  ],
};

function finish(kind: DesignFinish['kind'], massKg: number): DesignFinish {
  return { id: `${kind}`, kind, substanceId: 'butter', massUg: kilograms(massKg), elapsedSecondsSinceBake: 0 };
}

function tier(overrides: Partial<DesignTier> = {}): DesignTier {
  return {
    id: 't',
    diameterM: 0.2,
    layers: [{ id: 'l', formulation: SIMPLE_SPONGE, massUg: kilograms(1), heightM: 0.05 }],
    fillings: [],
    finishes: [],
    dowelled: false,
    dowelCount: 0,
    ...overrides,
  };
}

function design(tiers: readonly DesignTier[]): CakeDesign {
  return {
    id: 'd',
    name: 'feasibility test',
    tiers,
    toppers: [],
    thermal: { bakeTempC: 20, ambientTempC: 20, convectionCoefficientWPerM2K: 10, totalMassUg: kilograms(1), surfaceAreaM2: 0.1 },
  };
}

const AMPLE_LINE: LineCapability = {
  availableEquipmentTypes: new Set([
    ICING_DEPOSITOR_DEFINITION.type,
    GLAZING_DEFINITION.type,
    LAYERING_LINE_DEFINITION.type,
  ]),
  promisedMinutes: 1_000,
};

/** Ample stock of every substance the fixtures above use, well past anything a test
 * demands. */
const AMPLE_INVENTORY: Inventory = {
  stockUg: new Map([
    ['wheat-flour-white', kilograms(1_000)],
    ['sucrose', kilograms(1_000)],
    ['hen-egg-whole', kilograms(1_000)],
    ['butter', kilograms(1_000)],
  ]),
};

describe('evaluateFeasibility', () => {
  it('accepts a design the line has every machine and enough time and stock for', () => {
    const d = design([tier({ finishes: [finish('icing', 0.5)] })]);
    const report = evaluateFeasibility(d, AMPLE_INVENTORY, AMPLE_LINE);
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it('refuses a design that calls for equipment the line does not have', () => {
    const d = design([tier({ finishes: [finish('fondant', 0.5)] })]);
    const line: LineCapability = { availableEquipmentTypes: new Set([ICING_DEPOSITOR_DEFINITION.type]), promisedMinutes: 1_000 };
    const report = evaluateFeasibility(d, AMPLE_INVENTORY, line);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.code === 'missing-equipment')).toBe(true);
    expect(report.problems[0]?.message).toContain(LAYERING_LINE_DEFINITION.type);
  });

  it('refuses a design that would take longer than the line has promised', () => {
    // Piping is deliberately slow (0.3 kg/min): 3 kg of piping needs 10 minutes.
    const d = design([tier({ finishes: [finish('piping', 3)] })]);
    const line: LineCapability = { availableEquipmentTypes: AMPLE_LINE.availableEquipmentTypes, promisedMinutes: 2 };
    const report = evaluateFeasibility(d, AMPLE_INVENTORY, line);
    expect(report.ok).toBe(false);
    expect(report.totalMinutes).toBeGreaterThan(2);
    expect(report.problems.some((p) => p.code === 'insufficient-time')).toBe(true);
  });

  it('refuses a design needing more of a substance than stock holds, naming the shortfall', () => {
    const d = design([tier({ finishes: [finish('icing', 5)] })]);
    const scarceInventory: Inventory = {
      stockUg: new Map([
        ['wheat-flour-white', kilograms(1_000)],
        ['sucrose', kilograms(1_000)],
        ['hen-egg-whole', kilograms(1_000)],
        ['butter', kilograms(1)], // 1 kg of butter on hand; the layer + 5 kg of icing need far more
      ]),
    };
    const report = evaluateFeasibility(d, scarceInventory, AMPLE_LINE);
    expect(report.ok).toBe(false);
    const stockProblem = report.problems.find((p) => p.code === 'insufficient-stock');
    expect(stockProblem?.message).toContain('butter');
    expect(stockProblem?.message).toMatch(/short/);
  });
});
