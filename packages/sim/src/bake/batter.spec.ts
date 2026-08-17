import { describe, expect, it } from 'vitest';

import { ENERGY, grams, kilograms } from '../core/commodity.js';
import { Ledger } from '../core/ledger.js';
import {
  airVolumeFraction,
  batterSpecificHeat,
  glutenDevelopmentFraction,
  glutenPrecursorFromNitrogen,
  isOverMixed,
  mixBatter,
  totalMass,
} from './batter.js';
import type { ResolvedIngredient } from './formulation.js';

describe('glutenDevelopmentFraction', () => {
  it('is zero for no mechanical energy', () => {
    expect(glutenDevelopmentFraction(0)).toBe(0);
  });

  it('peaks at exactly 1.0 at the characteristic energy', () => {
    expect(glutenDevelopmentFraction(30_000)).toBeCloseTo(1, 6);
  });

  it('is lower on both sides of the peak — under-mixed and over-mixed both develop less', () => {
    const peak = glutenDevelopmentFraction(30_000);
    expect(glutenDevelopmentFraction(10_000)).toBeLessThan(peak);
    expect(glutenDevelopmentFraction(60_000)).toBeLessThan(peak);
  });

  it('flags over-mixing only past the characteristic energy', () => {
    expect(isOverMixed(29_999)).toBe(false);
    expect(isOverMixed(30_001)).toBe(true);
  });
});

describe('airVolumeFraction', () => {
  it('is zero with no energy and saturates toward the aeration ceiling', () => {
    expect(airVolumeFraction(0)).toBe(0);
    expect(airVolumeFraction(1_000_000)).toBeGreaterThan(0.34);
    expect(airVolumeFraction(1_000_000)).toBeLessThanOrEqual(0.35);
  });

  it('increases monotonically with specific energy', () => {
    const low = airVolumeFraction(2_000);
    const high = airVolumeFraction(20_000);
    expect(high).toBeGreaterThan(low);
  });
});

describe('glutenPrecursorFromNitrogen', () => {
  it('derives protein mass via the Jones factor (5.7x) and a gluten-forming fraction of 0.8', () => {
    const nitrogenMassUg = grams(16); // 16 g of elemental nitrogen
    const precursor = glutenPrecursorFromNitrogen(nitrogenMassUg);
    expect(precursor.proteinMassUg).toBe(BigInt(Math.round(16_000_000 * 5.7)));
    expect(precursor.glutenFormingMassUg).toBe(
      BigInt(Math.round(Number(precursor.proteinMassUg) * 0.8)),
    );
  });
});

describe('batterSpecificHeat and totalMass', () => {
  const resolved: readonly ResolvedIngredient[] = [
    { ingredient: { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 }, massUg: kilograms(1) },
    { ingredient: { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 60 }, massUg: kilograms(1) },
  ];

  it('sums total mass exactly', () => {
    expect(totalMass(resolved)).toBe(kilograms(2));
  });

  it('is the mass-weighted average of the ingredient specific heats', () => {
    // Equal masses of flour (1,800 J/kg K) and water (4,186 J/kg K).
    const cp = batterSpecificHeat(resolved);
    expect(cp).toBeCloseTo((1_800 + 4_186) / 2, 3);
  });

  it('falls back to water\'s specific heat for an empty batter rather than dividing by zero', () => {
    expect(batterSpecificHeat([])).toBe(4_186);
  });
});

describe('mixBatter', () => {
  it('posts a single balanced transfer from the mixer to the batter thermal account', () => {
    const ledger = new Ledger();
    ledger.openAccount({ id: 'mixer-motor', kind: 'stock', label: 'test mixer' });
    ledger.openAccount({ id: 'batter-thermal', kind: 'stock', label: 'test batter heat' });
    ledger.post({
      process: 'test:fund-mixer',
      entries: [
        { account: 'genesis', commodity: ENERGY, delta: -1_000_000_000n },
        { account: 'mixer-motor', commodity: ENERGY, delta: 1_000_000_000n },
      ],
    });

    const result = mixBatter({
      mechanicalEnergyAccount: 'mixer-motor',
      thermalAccount: 'batter-thermal',
      mechanicalEnergy: 500_000_000n, // 500 J
      totalBatterMassUg: kilograms(2),
      specificHeatJPerKgK: 3_000,
      glutenFormingMassUg: kilograms(1) / 10n,
    });

    const applied = ledger.post(result.posting);
    expect(applied.entries).toHaveLength(2);
    const residual = applied.entries.reduce((sum, e) => sum + e.delta, 0n);
    expect(residual).toBe(0n);
    expect(ledger.balance('batter-thermal', ENERGY)).toBe(500_000_000n);
    expect(ledger.balance('mixer-motor', ENERGY)).toBe(500_000_000n);
  });

  it('reports gluten development, air incorporation and temperature rise consistent with the energy posted', () => {
    const result = mixBatter({
      mechanicalEnergyAccount: 'mixer-motor',
      thermalAccount: 'batter-thermal',
      mechanicalEnergy: 60_000_000_000n, // 60,000 J
      totalBatterMassUg: kilograms(2), // -> 30,000 J/kg, the characteristic energy
      specificHeatJPerKgK: 3_000,
      glutenFormingMassUg: kilograms(1) / 10n,
    });

    expect(result.specificEnergyJPerKg).toBeCloseTo(30_000, 3);
    expect(result.developmentFraction).toBeCloseTo(1, 6);
    expect(result.overMixed).toBe(false);
    // temperatureRiseK = 60,000 J / (2 kg * 3,000 J/kg K) = 10 K.
    expect(result.temperatureRiseK).toBeCloseTo(10, 6);
  });

  it('refuses to mix a batter of zero mass', () => {
    expect(() =>
      mixBatter({
        mechanicalEnergyAccount: 'mixer-motor',
        thermalAccount: 'batter-thermal',
        mechanicalEnergy: 1_000_000n,
        totalBatterMassUg: 0n,
        specificHeatJPerKgK: 3_000,
        glutenFormingMassUg: 0n,
      }),
    ).toThrow(RangeError);
  });
});
