import { describe, expect, it } from 'vitest';

import { kilograms } from '../core/commodity.js';
import type { Formulation } from './formulation.js';
import { evaluateFormulation, resolveFormulation, rolePercent, validateFormulation } from './formulation.js';

/** Classic pound cake: equal parts flour, sugar, egg, butter (fat), no
 * separate liquid. A real, named formulation, not an invented test fixture. */
const POUND_CAKE: Formulation = {
  name: 'pound cake',
  ingredients: [
    { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
    { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
    { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 100 },
    { substanceId: 'butter', role: 'fat', bakersPercent: 100 },
    { substanceId: 'sodium-chloride', role: 'salt', bakersPercent: 1 },
  ],
};

/** Genoise: whipped-egg sponge, no chemical leavening, a little melted butter. */
const GENOISE: Formulation = {
  name: 'genoise',
  ingredients: [
    { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
    { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
    { substanceId: 'hen-egg-whole', role: 'egg', bakersPercent: 166 },
    { substanceId: 'butter', role: 'fat', bakersPercent: 20 },
  ],
};

describe('rolePercent and evaluateFormulation', () => {
  it('sums baker\'s percentage per role', () => {
    expect(rolePercent(POUND_CAKE, 'flour')).toBe(100);
    expect(rolePercent(POUND_CAKE, 'sugar')).toBe(100);
    expect(rolePercent(POUND_CAKE, 'salt')).toBe(1);
  });

  it('lands the classic pound cake structure index at exactly zero', () => {
    // Equal parts flour, sugar, egg, fat: (100 + 100 - 100 - 100) / 100 = 0.
    // Pound cake's real reputation is a dense, moist cake sitting right at the
    // edge of setting — this is the model saying the same thing numerically.
    const metrics = evaluateFormulation(POUND_CAKE);
    expect(metrics.structureIndex).toBeCloseTo(0, 10);
  });

  it('gives genoise a strongly positive structure index from its high egg content', () => {
    const metrics = evaluateFormulation(GENOISE);
    expect(metrics.structureIndex).toBeGreaterThan(1);
  });

  it('computes effective hydration crediting egg water alongside liquid', () => {
    const metrics = evaluateFormulation(GENOISE);
    // No liquid role ingredient, but 166% egg at ~76.15% water.
    expect(metrics.hydrationPercent).toBe(0);
    expect(metrics.effectiveHydrationPercent).toBeCloseTo(166 * 0.7615, 6);
  });
});

describe('validateFormulation', () => {
  it('accepts a real pound cake', () => {
    const result = validateFormulation(POUND_CAKE);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('accepts a real genoise', () => {
    const result = validateFormulation(GENOISE);
    expect(result.ok).toBe(true);
  });

  it('rejects a formulation with no flour, and says exactly why', () => {
    const noFlour: Formulation = {
      name: 'no flour',
      ingredients: [
        { substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 },
        { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 50 },
      ],
    };
    const result = validateFormulation(noFlour);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('no-flour');
    expect(result.problems[0]?.message).toMatch(/starch/i);
  });

  it('rejects a formulation whose flour ingredients do not sum to 100', () => {
    const badTotal: Formulation = {
      name: 'bad total',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 60 },
        { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 60 },
      ],
    };
    const result = validateFormulation(badTotal);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('flour-total-mismatch');
  });

  it('rejects a formulation with no hydration source at all', () => {
    const dry: Formulation = {
      name: 'dry',
      ingredients: [{ substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 }],
    };
    const result = validateFormulation(dry);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('no-hydration');
  });

  it('rejects a sugar-flooded formulation as a confection, not a cake', () => {
    const candy: Formulation = {
      name: 'too much sugar',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
        { substanceId: 'sucrose', role: 'sugar', bakersPercent: 400 },
        { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 300 },
      ],
    };
    const result = validateFormulation(candy);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('sugar-exceeds-flour-headroom');
  });

  it('rejects a fat-flooded formulation that cannot emulsify', () => {
    const greasy: Formulation = {
      name: 'too much fat',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
        { substanceId: 'butter', role: 'fat', bakersPercent: 500 },
        { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 60 },
      ],
    };
    const result = validateFormulation(greasy);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('fat-exceeds-egg-and-flour-headroom');
  });

  it('rejects an over-leavened formulation', () => {
    const overLeavened: Formulation = {
      name: 'over-leavened',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
        { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 60 },
        { substanceId: 'sodium-bicarbonate', role: 'leavening', bakersPercent: 12 },
      ],
    };
    const result = validateFormulation(overLeavened);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('leavening-exceeds-structure-capacity');
  });
});

describe('resolveFormulation', () => {
  it('splits a known total flour mass across multiple flour ingredients exactly', () => {
    const blended: Formulation = {
      name: 'blended flour',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 70 },
        { substanceId: 'wheat-bran', role: 'flour', bakersPercent: 30 },
        { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 60 },
      ],
    };
    const flourMassUg = kilograms(7) + 1n; // deliberately awkward, not a round kilogram split
    const resolved = resolveFormulation(blended, flourMassUg);
    const flourTotal = resolved
      .filter((r) => r.ingredient.role === 'flour')
      .reduce((sum, r) => sum + r.massUg, 0n);
    expect(flourTotal).toBe(flourMassUg);
  });

  it('resolves every ingredient to a non-negative mass, proportional to its baker\'s percentage', () => {
    const resolved = resolveFormulation(POUND_CAKE, kilograms(10));
    for (const { massUg } of resolved) {
      expect(massUg).toBeGreaterThanOrEqual(0n);
    }
    const sugar = resolved.find((r) => r.ingredient.role === 'sugar');
    expect(sugar?.massUg).toBe(kilograms(10)); // sugar is 100% of flour, flour batch is 10 kg
  });
});
