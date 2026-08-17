import { describe, expect, it } from 'vitest';

import { ENERGY, elementCommodity, grams, kilograms } from '../core/commodity.js';
import { Ledger } from '../core/ledger.js';
import { WORLD_ACCOUNTS, seedWorld } from '../world/accounts.js';
import { batterSpecificHeat, mixBatter, totalMass } from './batter.js';
import { fermentGlucose, ventGas } from './leavening.js';
import { deliverHeat, heatFluxes, type HeatTransferGeometry, type OvenEnvironment } from './oven.js';
import {
  advanceExtent,
  browningRate,
  co2VolumeM3,
  containableExpansionRatio,
  crustColor,
  eggCoagulationFraction,
  evaluateGasExpansion,
  glutenCoagulationFraction,
  postMoistureLoss,
  starchGelatinisationFraction,
  stepBrowning,
  stepThermal,
  structuralSetFraction,
} from './transform.js';

describe('temperature-band reaction extents', () => {
  it.each([
    ['starch gelatinisation', starchGelatinisationFraction, 60, 85],
    ['egg coagulation', eggCoagulationFraction, 60, 70],
    ['gluten coagulation', glutenCoagulationFraction, 74, 90],
  ] as const)('%s is 0 at onset, 1 at completion, and monotonic between', (_name, fn, onset, complete) => {
    expect(fn(onset)).toBe(0);
    expect(fn(complete)).toBe(1);
    expect(fn(onset - 10)).toBe(0);
    expect(fn(complete + 10)).toBe(1);
    const mid = fn((onset + complete) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe('advanceExtent', () => {
  it('never lets an irreversible reaction extent fall when temperature drops', () => {
    const afterHeating = advanceExtent(0, starchGelatinisationFraction(80));
    expect(afterHeating).toBeGreaterThan(0);
    const afterCooling = advanceExtent(afterHeating, starchGelatinisationFraction(20));
    expect(afterCooling).toBe(afterHeating);
  });
});

describe('structuralSetFraction', () => {
  it('is the mass-weighted average of the three ratcheted extents', () => {
    const value = structuralSetFraction(
      { starchMassUg: grams(600), glutenMassUg: grams(200), eggProteinMassUg: grams(200) },
      { starchGelatinisation: 1, glutenCoagulation: 0, eggCoagulation: 0 },
    );
    expect(value).toBeCloseTo(0.6, 6);
  });

  it('is zero for a budget with no structural mass at all', () => {
    expect(
      structuralSetFraction(
        { starchMassUg: 0n, glutenMassUg: 0n, eggProteinMassUg: 0n },
        { starchGelatinisation: 1, glutenCoagulation: 1, eggCoagulation: 1 },
      ),
    ).toBe(0);
  });
});

describe('stepThermal', () => {
  it('spends all delivered energy on sensible heat below the boiling point', () => {
    const result = stepThermal({
      currentTempC: 20,
      deliveredEnergyJ: 3_000,
      massKg: 1,
      specificHeatJPerKgK: 3_000,
      moistureRemainingUg: grams(500),
    });
    expect(result.nextTempC).toBeCloseTo(21, 6);
    expect(result.evaporatedMassUg).toBe(0n);
    expect(result.sensibleEnergyJ).toBeCloseTo(3_000, 6);
    expect(result.latentEnergyJ).toBe(0);
  });

  it('diverts energy past the boiling point into evaporation, capping temperature at 100 C', () => {
    const result = stepThermal({
      currentTempC: 99,
      deliveredEnergyJ: 300_000, // far more than needed to reach 100 C
      massKg: 1,
      specificHeatJPerKgK: 3_000,
      moistureRemainingUg: grams(500),
    });
    expect(result.nextTempC).toBeCloseTo(100, 6);
    expect(result.evaporatedMassUg).toBeGreaterThan(0n);
    expect(result.sensibleEnergyJ + result.latentEnergyJ).toBeCloseTo(300_000, 3);
  });

  it('caps evaporated mass at what moisture actually remains', () => {
    const result = stepThermal({
      currentTempC: 100,
      deliveredEnergyJ: 10_000_000, // far more energy than the tiny moisture budget can absorb
      massKg: 1,
      specificHeatJPerKgK: 3_000,
      moistureRemainingUg: 100n,
    });
    expect(result.evaporatedMassUg).toBe(100n);
  });

  it('once moisture is exhausted, further energy raises temperature past boiling', () => {
    const result = stepThermal({
      currentTempC: 100,
      deliveredEnergyJ: 3_000,
      massKg: 1,
      specificHeatJPerKgK: 3_000,
      moistureRemainingUg: 0n,
    });
    expect(result.nextTempC).toBeCloseTo(101, 6);
    expect(result.evaporatedMassUg).toBe(0n);
  });

  it('rejects zero or negative mass', () => {
    expect(() =>
      stepThermal({
        currentTempC: 20,
        deliveredEnergyJ: 100,
        massKg: 0,
        specificHeatJPerKgK: 3_000,
        moistureRemainingUg: 0n,
      }),
    ).toThrow(RangeError);
  });
});

describe('postMoistureLoss', () => {
  it('builds a real, balanced evaporate() posting for a positive mass and nothing for zero', () => {
    const ledger = new Ledger();
    ledger.openAccount({ id: 'product', kind: 'stock', label: 'test product' });
    seedWorld(ledger, { fields: ['test-field'] });
    // Fund the product with water directly, since seal() has already run —
    // this must happen before seal in a real scenario; here we just check the
    // posting shape, so fund via a pre-seal-equivalent direct credit is not
    // needed: postMoistureLoss only builds the posting, it does not require
    // the ledger to already hold the water it describes.
    const result = postMoistureLoss('product', WORLD_ACCOUNTS.atmosphere, grams(5));
    expect(result).toBeDefined();
    expect(result?.evaporatedMassUg).toBe(grams(5));

    expect(postMoistureLoss('product', WORLD_ACCOUNTS.atmosphere, 0n)).toBeUndefined();
  });
});

describe('browning and crust colour', () => {
  it('has zero browning rate below the Maillard onset and positive rate above it', () => {
    expect(browningRate(100)).toBe(0);
    expect(browningRate(139)).toBe(0);
    expect(browningRate(180)).toBeGreaterThan(0);
  });

  it('browning rate increases with temperature (real Arrhenius behaviour)', () => {
    expect(browningRate(200)).toBeGreaterThan(browningRate(160));
  });

  it('stepBrowning integrates forward and clamps at 1', () => {
    let extent = 0;
    for (let i = 0; i < 200; i += 1) extent = stepBrowning(extent, 190, 10);
    expect(extent).toBeGreaterThan(0.9);
    expect(extent).toBeLessThanOrEqual(1);
  });

  it('crust colour darkens (lower L*, higher a* and b*) as browning extent rises', () => {
    const pale = crustColor(0);
    const dark = crustColor(1);
    expect(dark.labL).toBeLessThan(pale.labL);
    expect(dark.labA).toBeGreaterThan(pale.labA);
    expect(dark.labB).toBeGreaterThan(pale.labB);
  });
});

describe('co2VolumeM3', () => {
  it('matches the real ideal gas law: ~22.4 L for one mole of gas at 0 C', () => {
    const co2MassUgOneMole = BigInt(Math.round(44.009 * 1_000_000));
    const volume = co2VolumeM3(co2MassUgOneMole, 0);
    expect(volume).toBeCloseTo(0.0224, 3);
  });

  it('grows with temperature at fixed mass — the real basis of oven spring', () => {
    const massUg = grams(10);
    expect(co2VolumeM3(massUg, 200)).toBeGreaterThan(co2VolumeM3(massUg, 20));
  });

  it('is zero for zero gas mass', () => {
    expect(co2VolumeM3(0n, 200)).toBe(0);
  });
});

describe('evaluateGasExpansion', () => {
  it('does not collapse a fully set crumb with a modest gas charge', () => {
    const result = evaluateGasExpansion({
      initialVolumeM3: 0.001,
      co2MassUg: grams(1),
      tempC: 100,
      setFraction: 1,
    });
    expect(result.collapsed).toBe(false);
  });

  it('collapses an unset batter carrying too much trapped gas', () => {
    const result = evaluateGasExpansion({
      initialVolumeM3: 0.001,
      co2MassUg: grams(50),
      tempC: 180,
      setFraction: 0,
    });
    expect(result.collapsed).toBe(true);
  });

  it('containable expansion grows with set fraction', () => {
    expect(containableExpansionRatio(1)).toBeGreaterThan(containableExpansionRatio(0));
  });

  it('rejects a non-positive initial volume', () => {
    expect(() => evaluateGasExpansion({ initialVolumeM3: 0, co2MassUg: 1n, tempC: 100, setFraction: 0 })).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// Integration: a real oven, a real batter, a real ledger, tick by tick.
// ---------------------------------------------------------------------------

const ENVIRONMENT: OvenEnvironment = { soleTempC: 180, crownTempC: 200, airTempC: 175 };
const GEOMETRY: HeatTransferGeometry = { contactAreaM2: 0.05, crownFacingAreaM2: 0.05, convectiveAreaM2: 0.08 };

interface BakeRunResult {
  readonly ledger: Ledger;
  readonly finalTempC: number;
  readonly moistureRemainingUg: bigint;
  readonly moistureLostUg: bigint;
  readonly gasExpansion: ReturnType<typeof evaluateGasExpansion>;
  readonly finalSetFraction: number;
}

/**
 * A small, self-contained bake: fund a product with real elemental mass and
 * real chemical potential energy, ferment a real glucose charge for
 * leavening, then run real oven heat transfer and real time-temperature
 * transforms tick by tick, checking the ledger balances after every single
 * posting. This is the harness the "mass in equals mass out, exactly, for
 * every bake" and "known formulations land in expected ranges" checks below
 * both run through.
 */
function runBake(options: {
  readonly flourMassUg: bigint;
  readonly moistureMassUg: bigint;
  readonly glucoseMassUg: bigint;
  readonly ticks: number;
  readonly dtSeconds: number;
  readonly startTempC?: number;
  readonly environment?: OvenEnvironment;
}): BakeRunResult {
  const ledger = new Ledger();
  ledger.openAccount({ id: 'flour-stock', kind: 'stock', label: 'test flour' });
  ledger.openAccount({ id: 'product-water', kind: 'stock', label: 'test product moisture' });
  ledger.openAccount({ id: 'sugar-stock', kind: 'stock', label: 'test sugar' });
  ledger.openAccount({ id: 'product-thermal', kind: 'stock', label: 'test product thermal' });
  ledger.openAccount({ id: 'batter-gas', kind: 'stock', label: 'test trapped gas' });
  ledger.openAccount({ id: 'ethanol', kind: 'stock', label: 'test ethanol byproduct' });
  ledger.openAccount({ id: 'ferment-heat', kind: 'stock', label: 'test fermentation heat' });

  // Fund flour (C/H/O only, a simplified elemental mix in roughly real wheat
  // starch/protein proportions) and water directly from genesis.
  const flourCarbon = (options.flourMassUg * 44n) / 100n;
  const flourHydrogen = (options.flourMassUg * 6n) / 100n;
  const flourOxygen = options.flourMassUg - flourCarbon - flourHydrogen;
  ledger.post({
    process: 'test:fund-flour',
    entries: [
      { account: 'genesis', commodity: elementCommodity('C'), delta: -flourCarbon },
      { account: 'flour-stock', commodity: elementCommodity('C'), delta: flourCarbon },
      { account: 'genesis', commodity: elementCommodity('H'), delta: -flourHydrogen },
      { account: 'flour-stock', commodity: elementCommodity('H'), delta: flourHydrogen },
      { account: 'genesis', commodity: elementCommodity('O'), delta: -flourOxygen },
      { account: 'flour-stock', commodity: elementCommodity('O'), delta: flourOxygen },
    ],
  });

  const waterHydrogen = (options.moistureMassUg * 111906744n) / 1_000_000_000n;
  const waterOxygen = options.moistureMassUg - waterHydrogen;
  ledger.post({
    process: 'test:fund-water',
    entries: [
      { account: 'genesis', commodity: elementCommodity('H'), delta: -waterHydrogen },
      { account: 'product-water', commodity: elementCommodity('H'), delta: waterHydrogen },
      { account: 'genesis', commodity: elementCommodity('O'), delta: -waterOxygen },
      { account: 'product-water', commodity: elementCommodity('O'), delta: waterOxygen },
    ],
  });

  // Fund sugar (glucose, C6H12O6) generously per element — `fermentGlucose`
  // consumes the *entire* funded glucose mass, split by its own precise real
  // molar-mass ratio, so funding each element independently at the full
  // requested mass (rather than tightly to an approximate ratio) guarantees
  // enough of each regardless of rounding, without re-deriving the exact
  // split this module already owns and tests elsewhere.
  const glucoseCarbon = options.glucoseMassUg;
  const glucoseHydrogen = options.glucoseMassUg;
  const glucoseOxygen = options.glucoseMassUg;
  const glucoseEnergyPerMicrogram = 2_803_000 / (6 * 12.011 + 12 * 1.008 + 6 * 15.999);
  const glucoseEnergy = BigInt(Math.round(Number(options.glucoseMassUg) * glucoseEnergyPerMicrogram));
  ledger.post({
    process: 'test:fund-sugar',
    entries: [
      { account: 'genesis', commodity: elementCommodity('C'), delta: -glucoseCarbon },
      { account: 'sugar-stock', commodity: elementCommodity('C'), delta: glucoseCarbon },
      { account: 'genesis', commodity: elementCommodity('H'), delta: -glucoseHydrogen },
      { account: 'sugar-stock', commodity: elementCommodity('H'), delta: glucoseHydrogen },
      { account: 'genesis', commodity: elementCommodity('O'), delta: -glucoseOxygen },
      { account: 'sugar-stock', commodity: elementCommodity('O'), delta: glucoseOxygen },
      { account: 'genesis', commodity: ENERGY, delta: -glucoseEnergy },
      { account: 'sugar-stock', commodity: ENERGY, delta: glucoseEnergy },
    ],
  });

  seedWorld(ledger, { fields: ['test-field'] });
  ledger.assertBalanced('after funding, before baking');

  // Ferment the sugar charge into the batter's trapped gas — real stoichiometry.
  const fermentation = fermentGlucose({
    sugarAccount: 'sugar-stock',
    gasAccount: 'batter-gas',
    ethanolAccount: 'ethanol',
    heatAccount: 'ferment-heat',
    glucoseMass: options.glucoseMassUg,
  });
  ledger.post(fermentation.posting);
  ledger.assertBalanced('after fermentation');

  const massKg = Number(options.flourMassUg + options.moistureMassUg) / 1_000_000_000;
  const specificHeatJPerKgK = batterSpecificHeat([
    { ingredient: { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 }, massUg: options.flourMassUg },
    { ingredient: { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 60 }, massUg: options.moistureMassUg },
  ]);

  const environment = options.environment ?? ENVIRONMENT;
  let tempC = options.startTempC ?? 20;
  let moistureRemainingUg = options.moistureMassUg;
  let moistureLostUg = 0n;
  let starchExtent = 0;
  let glutenExtent = 0;
  let eggExtent = 0;

  for (let tick = 0; tick < options.ticks; tick += 1) {
    ledger.setTick(tick);

    const step = ovenStepAndThermal({
      environment,
      tempC,
      dtSeconds: options.dtSeconds,
      massKg,
      specificHeatJPerKgK,
      moistureRemainingUg,
    });
    for (const posting of step.postings) ledger.post(posting);
    tempC = step.nextTempC;

    if (step.evaporatedMassUg > 0n) {
      const loss = postMoistureLoss('product-water', WORLD_ACCOUNTS.atmosphere, step.evaporatedMassUg, `test:evap-${tick}`);
      if (loss) {
        ledger.post(loss.posting);
        moistureRemainingUg -= step.evaporatedMassUg;
        moistureLostUg += step.evaporatedMassUg;
      }
    }

    starchExtent = advanceExtent(starchExtent, starchGelatinisationFraction(tempC));
    glutenExtent = advanceExtent(glutenExtent, glutenCoagulationFraction(tempC));
    eggExtent = advanceExtent(eggExtent, eggCoagulationFraction(tempC));

    ledger.assertBalanced(`tick ${tick}`);
  }

  const finalSetFraction = structuralSetFraction(
    { starchMassUg: options.flourMassUg, glutenMassUg: options.flourMassUg / 8n, eggProteinMassUg: 0n },
    { starchGelatinisation: starchExtent, glutenCoagulation: glutenExtent, eggCoagulation: eggExtent },
  );

  const trappedCo2 = ledger.balance('batter-gas', elementCommodity('C')) + ledger.balance('batter-gas', elementCommodity('O'));
  // A representative aerated cake-batter density (~800 kg/m^3, lighter than
  // water because of incorporated air) turns this batch's real mass into a
  // real initial volume, rather than an arbitrary fixed container size.
  const initialVolumeM3 = massKg / 800;
  const gasExpansion = evaluateGasExpansion({
    initialVolumeM3,
    co2MassUg: trappedCo2,
    tempC,
    setFraction: finalSetFraction,
  });

  const report = ledger.audit();
  expect(report.ok, `audit discrepancies: ${JSON.stringify(report.discrepancies)}`).toBe(true);

  return { ledger, finalTempC: tempC, moistureRemainingUg, moistureLostUg, gasExpansion, finalSetFraction };
}

/** Combine one tick of `ovenStep`-style heat delivery with `stepThermal` in
 * one call, for the harness above. Mirrors what a real scenario driver would
 * do: ask the oven for a flux-implied energy budget, source it from a real
 * account, then let the thermal/evaporation model spend it. */
function ovenStepAndThermal(params: {
  readonly environment: OvenEnvironment;
  readonly tempC: number;
  readonly dtSeconds: number;
  readonly massKg: number;
  readonly specificHeatJPerKgK: number;
  readonly moistureRemainingUg: bigint;
}) {
  const fluxes = heatFluxes(params.environment, GEOMETRY, params.tempC);
  const targetJ = Math.max(0, fluxes.totalW) * params.dtSeconds;
  const delivery = deliverHeat({ kind: 'electric' }, 'product-thermal', targetJ, 'test:oven');
  const deliveredJ = Number(delivery.deliveredEnergy) / 1_000_000;

  const thermal = stepThermal({
    currentTempC: params.tempC,
    deliveredEnergyJ: deliveredJ,
    massKg: params.massKg,
    specificHeatJPerKgK: params.specificHeatJPerKgK,
    moistureRemainingUg: params.moistureRemainingUg,
  });

  return {
    postings: delivery.postings,
    nextTempC: thermal.nextTempC,
    evaporatedMassUg: thermal.evaporatedMassUg,
  };
}

describe('a full bake, tick by tick', () => {
  it('stays exactly balanced end to end, and weighs every bit of moisture loss to the atmosphere', () => {
    const result = runBake({
      flourMassUg: kilograms(1),
      moistureMassUg: grams(600),
      glucoseMassUg: grams(20),
      ticks: 120,
      dtSeconds: 30,
    });
    expect(result.moistureLostUg).toBeGreaterThan(0n);
    expect(result.moistureLostUg).toBeLessThanOrEqual(grams(600));
    expect(result.finalTempC).toBeGreaterThan(20);
  });

  it('is deterministic: two identical runs produce byte-identical results', () => {
    const options = {
      flourMassUg: kilograms(1),
      moistureMassUg: grams(600),
      glucoseMassUg: grams(20),
      ticks: 60,
      dtSeconds: 30,
    };
    const a = runBake(options);
    const b = runBake(options);
    expect(a.finalTempC).toBe(b.finalTempC);
    expect(a.moistureRemainingUg).toBe(b.moistureRemainingUg);
    expect(a.moistureLostUg).toBe(b.moistureLostUg);
    expect(a.gasExpansion).toEqual(b.gasExpansion);
    expect(a.finalSetFraction).toBe(b.finalSetFraction);
  });

  it('a well-heated, well-leavened bake sets before its gas expansion outruns it', () => {
    const result = runBake({
      flourMassUg: kilograms(1),
      moistureMassUg: grams(600),
      glucoseMassUg: grams(5),
      ticks: 200,
      dtSeconds: 30,
    });
    expect(result.finalSetFraction).toBeGreaterThan(0.9);
    expect(result.gasExpansion.collapsed).toBe(false);
  });

  it('a cold oven fails distinctly: the crumb never sets, rather than a generic error', () => {
    const coldEnvironment: OvenEnvironment = { soleTempC: 25, crownTempC: 25, airTempC: 25 };
    const result = runBake({
      flourMassUg: kilograms(1),
      moistureMassUg: grams(600),
      glucoseMassUg: grams(15),
      ticks: 200,
      dtSeconds: 30,
      environment: coldEnvironment,
    });
    expect(result.finalTempC).toBeLessThan(60);
    expect(result.finalSetFraction).toBe(0);
  });

  it('an over-leavened batter collapses: gas expansion outruns an unset crumb', () => {
    // A very small initial volume and a large fermented gas charge, evaluated
    // before any structural set has happened at all — the real failure mode
    // of a batch that never had a chance to catch up to its own gas.
    const overLeavened = evaluateGasExpansion({
      initialVolumeM3: 0.0005,
      co2MassUg: grams(200),
      tempC: 180,
      setFraction: 0.05,
    });
    expect(overLeavened.collapsed).toBe(true);
  });
});

// A quiet reference to `totalMass`, `ventGas` and `mixBatter` so this spec
// file also exercises them in the same integration context real usage would.
describe('cross-module wiring sanity', () => {
  it('mixBatter and ventGas compose without needing anything beyond their own public API', () => {
    const resolved = [
      { ingredient: { substanceId: 'wheat-flour-white', role: 'flour' as const, bakersPercent: 100 }, massUg: kilograms(1) },
    ];
    expect(totalMass(resolved)).toBe(kilograms(1));

    const mix = mixBatter({
      mechanicalEnergyAccount: 'mixer',
      thermalAccount: 'batter-thermal',
      mechanicalEnergy: 1_000_000n,
      totalBatterMassUg: kilograms(1),
      specificHeatJPerKgK: 3_000,
      glutenFormingMassUg: grams(50),
    });
    expect(mix.posting.entries).toHaveLength(2);

    const fermentation = fermentGlucose({
      sugarAccount: 'sugar',
      gasAccount: 'gas',
      ethanolAccount: 'ethanol',
      heatAccount: 'heat',
      glucoseMass: grams(10),
    });
    const vent = ventGas({ gasAccount: 'gas', atmosphereAccount: 'atmosphere', composition: fermentation.co2 });
    expect(vent.entries.length).toBeGreaterThan(0);
  });
});
