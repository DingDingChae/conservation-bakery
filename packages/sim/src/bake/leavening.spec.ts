import { describe, expect, it } from 'vitest';

import { ENERGY, elementCommodity, grams } from '../core/commodity.js';
import type { Posting } from '../core/ledger.js';
import { Ledger } from '../core/ledger.js';
import { ETHANOL_MOLAR_MASS, fermentGlucose, reactBakingSoda, ventGas } from './leavening.js';

function residuals(posting: Posting): Map<string, bigint> {
  const sums = new Map<string, bigint>();
  for (const e of posting.entries) sums.set(e.commodity, (sums.get(e.commodity) ?? 0n) + e.delta);
  return sums;
}

function expectBalanced(posting: Posting): void {
  for (const [commodity, residual] of residuals(posting)) {
    expect(residual, `${posting.process}: ${commodity} residual`).toBe(0n);
  }
}

const AWKWARD_MASSES: readonly bigint[] = [1n, 3n, 97n, 9_973n, grams(1), grams(50), grams(500)];

describe('ETHANOL_MOLAR_MASS', () => {
  it('closes the fermentation mass balance to real IUPAC atomic weights', () => {
    // Glucose 180.156 g/mol == 2 x ethanol + 2 x CO2, to 3 decimal places.
    const co2MolarMass = 12.011 + 2 * 15.999;
    const glucoseMolarMass = 6 * 12.011 + 12 * 1.008 + 6 * 15.999;
    expect(2 * ETHANOL_MOLAR_MASS + 2 * co2MolarMass).toBeCloseTo(glucoseMolarMass, 2);
  });
});

describe('reactBakingSoda', () => {
  it.each(AWKWARD_MASSES)('balances exactly with excess acid for %s ug of baking soda', (bakingSodaMass) => {
    const { posting } = reactBakingSoda({
      bakingSodaAccount: 'soda',
      acidAccount: 'acid',
      gasAccount: 'gas',
      byproductAccount: 'liquid',
      bakingSodaMass,
      acidMass: bakingSodaMass * 10n, // acid always in excess
    });
    expectBalanced(posting);
  });

  it.each(AWKWARD_MASSES)('balances exactly with excess soda for %s ug of acid', (acidMass) => {
    const { posting } = reactBakingSoda({
      bakingSodaAccount: 'soda',
      acidAccount: 'acid',
      gasAccount: 'gas',
      byproductAccount: 'liquid',
      bakingSodaMass: acidMass * 10n, // soda always in excess
      acidMass,
    });
    expectBalanced(posting);
  });

  it('consumes the limiting reagent in full and produces a positive mass of CO2', () => {
    const result = reactBakingSoda({
      bakingSodaAccount: 'soda',
      acidAccount: 'acid',
      gasAccount: 'gas',
      byproductAccount: 'liquid',
      bakingSodaMass: grams(84), // ~1 mole
      acidMass: grams(6), // acid is scarce here
    });
    expect(result.acidConsumed).toBe(grams(6));
    expect(result.bakingSodaConsumed).toBeLessThan(grams(84));
    const co2Mass = [...result.co2.values()].reduce((sum, v) => sum + v, 0n);
    expect(co2Mass).toBeGreaterThan(0n);
  });

  it('actually posts against a real ledger and holds every account non-negative', () => {
    const ledger = new Ledger();
    ledger.openAccount({ id: 'soda', kind: 'stock', label: 'test soda' });
    ledger.openAccount({ id: 'acid', kind: 'stock', label: 'test acid' });
    ledger.openAccount({ id: 'gas', kind: 'stock', label: 'test batter gas' });
    ledger.openAccount({ id: 'liquid', kind: 'stock', label: 'test batter liquid' });

    // Fund each element generously (well past what the reaction below could
    // possibly consume) rather than tightly to NaHCO3's real stoichiometric
    // ratio — this test is checking ledger integration, not re-deriving the
    // molar-mass split `reactBakingSoda` itself already owns and is tested
    // for elsewhere in this file.
    ledger.post({
      process: 'test:fund-soda',
      entries: [
        { account: 'genesis', commodity: elementCommodity('Na'), delta: -grams(100) },
        { account: 'soda', commodity: elementCommodity('Na'), delta: grams(100) },
        { account: 'genesis', commodity: elementCommodity('H'), delta: -grams(100) },
        { account: 'soda', commodity: elementCommodity('H'), delta: grams(100) },
        { account: 'genesis', commodity: elementCommodity('C'), delta: -grams(100) },
        { account: 'soda', commodity: elementCommodity('C'), delta: grams(100) },
        { account: 'genesis', commodity: elementCommodity('O'), delta: -grams(100) },
        { account: 'soda', commodity: elementCommodity('O'), delta: grams(100) },
      ],
    });
    ledger.post({
      process: 'test:fund-acid',
      entries: [
        { account: 'genesis', commodity: elementCommodity('C'), delta: -grams(100) },
        { account: 'acid', commodity: elementCommodity('C'), delta: grams(100) },
        { account: 'genesis', commodity: elementCommodity('H'), delta: -grams(100) },
        { account: 'acid', commodity: elementCommodity('H'), delta: grams(100) },
        { account: 'genesis', commodity: elementCommodity('O'), delta: -grams(100) },
        { account: 'acid', commodity: elementCommodity('O'), delta: grams(100) },
      ],
    });

    const { posting } = reactBakingSoda({
      bakingSodaAccount: 'soda',
      acidAccount: 'acid',
      gasAccount: 'gas',
      byproductAccount: 'liquid',
      bakingSodaMass: grams(84),
      acidMass: grams(60),
    });
    ledger.post(posting);

    ledger.assertBalanced('after reactBakingSoda');
    for (const account of ['soda', 'acid', 'gas', 'liquid']) {
      for (const commodity of ledger.commodityIds()) {
        expect(ledger.balance(account, commodity)).toBeGreaterThanOrEqual(0n);
      }
    }
    expect(ledger.balance('gas', elementCommodity('C'))).toBeGreaterThan(0n);
  });
});

describe('fermentGlucose', () => {
  it.each(AWKWARD_MASSES)('balances exactly (elements and energy) for %s ug of glucose', (glucoseMass) => {
    const { posting } = fermentGlucose({
      sugarAccount: 'sugar',
      gasAccount: 'gas',
      ethanolAccount: 'liquid',
      heatAccount: 'heat',
      glucoseMass,
    });
    expectBalanced(posting);
  });

  it('releases a positive amount of metabolic heat, drawn from the sugar account', () => {
    const { posting } = fermentGlucose({
      sugarAccount: 'sugar',
      gasAccount: 'gas',
      ethanolAccount: 'liquid',
      heatAccount: 'heat',
      glucoseMass: grams(180), // ~1 mole
    });
    const heatEntry = posting.entries.find((e) => e.account === 'heat' && e.commodity === ENERGY);
    const sugarEnergyEntry = posting.entries.find((e) => e.account === 'sugar' && e.commodity === ENERGY);
    expect(heatEntry?.delta ?? 0n).toBeGreaterThan(0n);
    expect(sugarEnergyEntry?.delta ?? 0n).toBeLessThan(0n);
    expect(heatEntry?.delta).toBe(-(sugarEnergyEntry?.delta ?? 0n));
  });

  it('produces both CO2 and ethanol from the same glucose, conserving carbon between them', () => {
    const { co2, ethanol } = fermentGlucose({
      sugarAccount: 'sugar',
      gasAccount: 'gas',
      ethanolAccount: 'liquid',
      heatAccount: 'heat',
      glucoseMass: grams(180),
    });
    const co2Carbon = co2.get('C') ?? 0n;
    const ethanolCarbon = ethanol.get('C') ?? 0n;
    // Glucose has 6 carbons; 2 CO2 (2C) + 2 ethanol (4C) = 6C, so CO2:ethanol
    // carbon should split roughly 1:2 by real Gay-Lussac stoichiometry.
    expect(co2Carbon).toBeGreaterThan(0n);
    expect(ethanolCarbon).toBeGreaterThan(0n);
    const ratio = Number(ethanolCarbon) / Number(co2Carbon);
    expect(ratio).toBeCloseTo(2, 1);
  });
});

describe('ventGas', () => {
  it('moves an arbitrary composition from the gas account to the atmosphere exactly', () => {
    const { co2 } = fermentGlucose({
      sugarAccount: 'sugar',
      gasAccount: 'gas',
      ethanolAccount: 'liquid',
      heatAccount: 'heat',
      glucoseMass: grams(180),
    });
    const posting = ventGas({ gasAccount: 'gas', atmosphereAccount: 'atmosphere', composition: co2 });
    expectBalanced(posting);
    for (const [element, amount] of co2) {
      const gasEntry = posting.entries.find((e) => e.account === 'gas' && e.commodity === elementCommodity(element));
      expect(gasEntry?.delta).toBe(-amount);
    }
  });
});
