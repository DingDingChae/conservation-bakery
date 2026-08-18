import { describe, expect, it } from 'vitest';

import { kilograms } from '../core/commodity.js';
import type { CakeDesign, DesignFinish, DesignTier } from './types.js';
import {
  BUTTERCREAM_MAX_SUBSTRATE_TEMP_C,
  FONDANT_MAX_SUBSTRATE_TEMP_C,
  GANACHE_MAX_SUBSTRATE_TEMP_C,
  evaluateThermal,
  productTemperatureAtElapsedSeconds,
} from './thermal.js';

function finish(kind: DesignFinish['kind'], elapsedSecondsSinceBake: number): DesignFinish {
  return { id: `${kind}-${elapsedSecondsSinceBake}`, kind, substanceId: 'butter', massUg: kilograms(0.2), elapsedSecondsSinceBake };
}

function tier(finishes: readonly DesignFinish[]): DesignTier {
  return { id: 't', diameterM: 0.2, layers: [], fillings: [], finishes, dowelled: false, dowelCount: 0 };
}

function design(tiers: readonly DesignTier[], overrides: Partial<CakeDesign['thermal']> = {}): CakeDesign {
  return {
    id: 'd',
    name: 'thermal test',
    tiers,
    toppers: [],
    thermal: {
      bakeTempC: 180,
      ambientTempC: 21,
      convectionCoefficientWPerM2K: 10,
      totalMassUg: kilograms(1),
      surfaceAreaM2: 0.15,
      ...overrides,
    },
  };
}

describe('productTemperatureAtElapsedSeconds', () => {
  it('starts at the bake temperature at zero elapsed time', () => {
    const d = design([]);
    expect(productTemperatureAtElapsedSeconds(d, 0)).toBeCloseTo(180, 5);
  });

  it('approaches ambient temperature as elapsed time grows without bound', () => {
    const d = design([]);
    expect(productTemperatureAtElapsedSeconds(d, 1_000_000)).toBeCloseTo(21, 3);
  });

  it('cools monotonically between those two extremes', () => {
    const d = design([]);
    const early = productTemperatureAtElapsedSeconds(d, 60);
    const later = productTemperatureAtElapsedSeconds(d, 600);
    expect(later).toBeLessThan(early);
    expect(early).toBeLessThan(180);
    expect(later).toBeGreaterThan(21);
  });
});

describe('evaluateThermal', () => {
  it('refuses fondant applied to a still-warm cake, naming the real temperature', () => {
    // 30 seconds after leaving a 180 C oven, a cake with a slow (low-area, high-mass)
    // cooling profile is still far above the fondant ceiling.
    const d = design([tier([finish('fondant', 30)])], { surfaceAreaM2: 0.02, totalMassUg: kilograms(2) });
    const report = evaluateThermal(d);
    expect(report.ok).toBe(false);
    const verdict = report.finishes[0]!;
    expect(verdict.ok).toBe(false);
    expect(verdict.productTempC).toBeGreaterThan(FONDANT_MAX_SUBSTRATE_TEMP_C);
    expect(verdict.problems.map((p) => p.code)).toContain('fondant-substrate-too-warm');
  });

  it('accepts fondant applied once the cake has actually cooled to ambient', () => {
    const d = design([tier([finish('fondant', 100_000)])]);
    const report = evaluateThermal(d);
    expect(report.ok).toBe(true);
  });

  it('refuses ganache on a substrate still warm enough to keep its cocoa butter from setting', () => {
    const d = design([tier([finish('ganache', 30)])], { surfaceAreaM2: 0.02, totalMassUg: kilograms(2) });
    const report = evaluateThermal(d);
    expect(report.ok).toBe(false);
    expect(report.finishes[0]?.productTempC).toBeGreaterThan(GANACHE_MAX_SUBSTRATE_TEMP_C);
    expect(report.finishes[0]?.problems.map((p) => p.code)).toContain('ganache-substrate-too-warm');
  });

  it('refuses buttercream, crumb coat and piping on a too-warm substrate alike', () => {
    for (const kind of ['buttercream', 'crumbCoat', 'piping'] as const) {
      const d = design([tier([finish(kind, 30)])], { surfaceAreaM2: 0.02, totalMassUg: kilograms(2) });
      const report = evaluateThermal(d);
      expect(report.ok).toBe(false);
      expect(report.finishes[0]?.productTempC).toBeGreaterThan(BUTTERCREAM_MAX_SUBSTRATE_TEMP_C);
    }
  });

  it('never gates icing or a printed transfer on temperature', () => {
    const d = design([tier([finish('icing', 0), finish('transfer', 0)])]);
    const report = evaluateThermal(d);
    expect(report.ok).toBe(true);
    expect(report.finishes.every((verdict) => verdict.problems.length === 0)).toBe(true);
  });
});
