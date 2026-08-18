import { describe, expect, it } from 'vitest';

import { kilograms } from '../core/commodity.js';
import type { Formulation } from '../bake/formulation.js';
import type { CakeDesign, DesignTier } from './types.js';
import { designMaterialDemand } from './materials.js';

/** Equal-parts pound cake: flour, sugar, egg, fat each at 100% — total percent 400,
 * so a layer stated at 4 kg resolves to exactly 1 kg of each ingredient. */
const POUND_CAKE: Formulation = {
  name: 'pound cake',
  ingredients: [
    { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
    { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
    { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 100 },
    { substanceId: 'butter', role: 'fat', bakersPercent: 100 },
  ],
};

function design(tiers: readonly DesignTier[]): CakeDesign {
  return {
    id: 'd',
    name: 'materials test',
    tiers,
    toppers: [],
    thermal: { bakeTempC: 20, ambientTempC: 20, convectionCoefficientWPerM2K: 10, totalMassUg: kilograms(1), surfaceAreaM2: 0.1 },
  };
}

describe('designMaterialDemand', () => {
  it('resolves a layer stated by real total mass into real per-ingredient masses that sum back to it', () => {
    const tier: DesignTier = {
      id: 't',
      diameterM: 0.2,
      layers: [{ id: 'l', formulation: POUND_CAKE, massUg: kilograms(4), heightM: 0.05 }],
      fillings: [],
      finishes: [],
      dowelled: false,
      dowelCount: 0,
    };
    const demand = designMaterialDemand(design([tier]));
    const total = demand.reduce((sum, line) => sum + line.massUg, 0n);
    expect(total).toBe(kilograms(4));

    const flour = demand.find((line) => line.substanceId === 'wheat-flour-white');
    const sugar = demand.find((line) => line.substanceId === 'sucrose');
    expect(flour?.massUg).toBe(kilograms(1));
    expect(sugar?.massUg).toBe(kilograms(1));
  });

  it('sums fillings, finishes and toppers by substance across every tier', () => {
    const tier: DesignTier = {
      id: 't',
      diameterM: 0.2,
      layers: [],
      fillings: [{ id: 'f', substanceId: 'raspberry-jam', massUg: kilograms(0.3), heightM: 0.01 }],
      finishes: [{ id: 'i', kind: 'icing', substanceId: 'sucrose', massUg: kilograms(0.5), elapsedSecondsSinceBake: 0 }],
      dowelled: false,
      dowelCount: 0,
    };
    const d = design([tier]);
    const withTopper: CakeDesign = { ...d, toppers: [{ id: 'top', tierId: 't', substanceId: 'sucrose', massUg: kilograms(0.1) }] };

    const demand = designMaterialDemand(withTopper);
    const jam = demand.find((line) => line.substanceId === 'raspberry-jam');
    const sugarTotal = demand.find((line) => line.substanceId === 'sucrose');
    expect(jam?.massUg).toBe(kilograms(0.3));
    // Icing (0.5 kg) + topper (0.1 kg), both sucrose — summed, not overwritten.
    expect(sugarTotal?.massUg).toBe(kilograms(0.6));
  });

  it('returns nothing for a design with no material at all', () => {
    expect(designMaterialDemand(design([]))).toEqual([]);
  });
});
