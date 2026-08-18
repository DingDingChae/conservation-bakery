import { describe, expect, it } from 'vitest';

import { kilograms } from '../core/commodity.js';
import type { Formulation } from '../bake/formulation.js';
import type { CakeDesign, DesignTier } from './types.js';
import type { PriceTable } from './cost.js';
import { evaluateCost } from './cost.js';

const POUND_CAKE: Formulation = {
  name: 'pound cake',
  ingredients: [
    { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
    { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
  ],
};

function design(): CakeDesign {
  const tier: DesignTier = {
    id: 't',
    diameterM: 0.2,
    layers: [{ id: 'l', formulation: POUND_CAKE, massUg: kilograms(2), heightM: 0.05 }],
    fillings: [],
    finishes: [],
    dowelled: false,
    dowelCount: 0,
  };
  return {
    id: 'd',
    name: 'cost test',
    tiers: [tier],
    toppers: [],
    thermal: { bakeTempC: 20, ambientTempC: 20, convectionCoefficientWPerM2K: 10, totalMassUg: kilograms(1), surfaceAreaM2: 0.1 },
  };
}

describe('evaluateCost', () => {
  it('prices every material line at its real per-kilogram price and sums to the material cost', () => {
    const prices: PriceTable = {
      pricePerKgMinorUnitsBySubstance: new Map([
        ['wheat-flour-white', 60n],
        ['sucrose', 90n],
      ]),
    };
    const report = evaluateCost(design(), prices, 1_500n, 0);
    // 1 kg flour @ 60 + 1 kg sugar @ 90 = 150 minor units.
    expect(report.materialCostMinorUnits).toBe(150n);
    expect(report.complete).toBe(true);
    expect(report.laborCostMinorUnits).toBe(0n);
    expect(report.totalCostMinorUnits).toBe(150n);
  });

  it('reports an unpriced substance honestly rather than treating it as free', () => {
    const prices: PriceTable = { pricePerKgMinorUnitsBySubstance: new Map([['wheat-flour-white', 60n]]) };
    const report = evaluateCost(design(), prices, 1_500n, 0);
    expect(report.complete).toBe(false);
    const sugarLine = report.lines.find((line) => line.substanceId === 'sucrose');
    expect(sugarLine?.priced).toBe(false);
    expect(sugarLine?.costMinorUnits).toBe(0n);
    // The flour line is still real and priced, even though the total is incomplete.
    expect(report.materialCostMinorUnits).toBe(60n);
  });

  it('costs finishing time at the real hourly wage', () => {
    const prices: PriceTable = { pricePerKgMinorUnitsBySubstance: new Map() };
    // 30 minutes at 6,000 minor units/hour = 3,000 minor units.
    const report = evaluateCost(design(), prices, 6_000n, 30);
    expect(report.laborCostMinorUnits).toBe(3_000n);
    expect(report.totalCostMinorUnits).toBe(report.materialCostMinorUnits + 3_000n);
  });
});
