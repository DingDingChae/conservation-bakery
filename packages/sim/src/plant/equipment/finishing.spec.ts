import { describe, expect, it } from 'vitest';

import { kilograms } from '../../core/commodity.js';
import { Ledger } from '../../core/ledger.js';
import { createSeededRng } from '../../process/failure.js';
import { defaultSubstanceRegistry } from '../../substance/registry.js';
import type { ProcessUnit } from '../unit.js';
import {
  CHOCOLATE_SEED_TEMP_C,
  CHOCOLATE_WORK_TEMP_C,
  applyFinish,
  createAirbrushApplicator,
  createBlastChiller,
  createEdibleInkPrinter,
  createEnrober,
  createFreezer,
  createGlazer,
  createIcingDepositor,
  createLayeringLine,
  createProofer,
  createRetarder,
  createSprayApplicator,
  createSprinkleApplicator,
  createSpiralCooler,
  createTemperingKettle,
  enrobe,
  holdAtTemperature,
  temperChocolate,
} from './finishing.js';
import { openAccounts, seedFromGenesis } from './testSupport.js';

const registry = defaultSubstanceRegistry();

function readyUnit(unit: ProcessUnit): ProcessUnit {
  unit.machine.commission();
  unit.machine.requestMode('MANUAL');
  return unit;
}

describe('spiral cooler, blast chiller, freezer, proofer, retarder — holdAtTemperature', () => {
  const coolers: readonly [string, () => ProcessUnit, number][] = [
    ['spiral cooler', () => createSpiralCooler('u', 'x'), 20],
    ['blast chiller', () => createBlastChiller('u', 'x'), 20],
    ['freezer', () => createFreezer('u', 'x'), 4],
    ['retarder', () => createRetarder('u', 'x'), 20],
  ];

  for (const [name, create, startTempC] of coolers) {
    it(`${name} conserves energy exactly on a cooling hold, across a wide mass range`, () => {
      const masses = [1n, 97n, kilograms(1), kilograms(200), kilograms(10_000)];

      for (const massUg of masses) {
        const unit = readyUnit(create());
        unit.machine.setTag('door-closed', 1);

        const ledger = new Ledger();
        openAccounts(ledger, [
          { id: 'product', kind: 'stock' },
          { id: 'utility', kind: 'external' },
          { id: 'waste-heat', kind: 'external' },
          { id: 'condensate', kind: 'stock' },
        ]);
        const productComposition = registry.getComposition('cream', massUg);

        const { posting, energy, heating } = holdAtTemperature(unit, registry, {
          productAccount: 'product',
          productComposition,
          utilityAccount: 'utility',
          wasteHeatAccount: 'waste-heat',
          condensateAccount: 'condensate',
          startTempC,
        });

        ledger.post(posting);
        expect(ledger.audit().ok).toBe(true);
        expect(heating).toBe(false);
        expect(energy).toBeGreaterThanOrEqual(0n);
        expect(ledger.balance('utility', 'energy:uJ')).toBe(-energy);
        expect(ledger.balance('waste-heat', 'energy:uJ')).toBe(energy);
      }
    });
  }

  it('proofer conserves energy exactly on a heating hold', () => {
    const unit = readyUnit(createProofer('proofer-1', 'x'));
    unit.machine.setTag('door-closed', 1);

    const ledger = new Ledger();
    openAccounts(ledger, [
      { id: 'product', kind: 'stock' },
      { id: 'utility', kind: 'external' },
      { id: 'waste-heat', kind: 'external' },
      { id: 'condensate', kind: 'stock' },
    ]);
    const productComposition = registry.getComposition('wheat-flour-white', kilograms(50));

    const { posting, energy, heating } = holdAtTemperature(unit, registry, {
      productAccount: 'product',
      productComposition,
      utilityAccount: 'utility',
      wasteHeatAccount: 'waste-heat',
      condensateAccount: 'condensate',
      startTempC: 20,
    });

    ledger.post(posting);
    expect(ledger.audit().ok).toBe(true);
    expect(heating).toBe(true);
    expect(energy).toBeGreaterThan(0n);
  });

  it('a cooling hold with a non-zero condensate-fraction moves real water mass out of the product, exactly', () => {
    const unit = readyUnit(createFreezer('freezer-1', 'x'));
    unit.machine.setTag('door-closed', 1);
    unit.machine.setTag('condensate-fraction', 0.01);

    const ledger = new Ledger();
    openAccounts(ledger, [
      { id: 'product', kind: 'stock' },
      { id: 'utility', kind: 'external' },
      { id: 'waste-heat', kind: 'external' },
      { id: 'condensate', kind: 'stock' },
    ]);
    const massUg = kilograms(500);
    const productComposition = registry.getComposition('cream', massUg);
    seedFromGenesis(ledger, 'product', productComposition, 'genesis:test-product');

    const { posting, condensateMass } = holdAtTemperature(unit, registry, {
      productAccount: 'product',
      productComposition,
      utilityAccount: 'utility',
      wasteHeatAccount: 'waste-heat',
      condensateAccount: 'condensate',
      startTempC: 20,
    });

    ledger.post(posting);
    expect(ledger.audit().ok).toBe(true);
    expect(condensateMass).toBeGreaterThan(0n);
    expect(ledger.balance('condensate', 'el:H')).toBeGreaterThan(0n);
    expect(ledger.balance('condensate', 'el:O')).toBeGreaterThan(0n);
    // Removed from the product's own account, not invented.
    const remainingMass = [...ledger.balances('product').values()].reduce((a, b) => a + b, 0n);
    expect(remainingMass).toBe(massUg - condensateMass);
  });

  it('refuses to hold with the chamber door open', () => {
    const unit = readyUnit(createBlastChiller('chiller-1', 'x'));
    expect(() =>
      holdAtTemperature(unit, registry, {
        productAccount: 'product',
        productComposition: registry.getComposition('cream', kilograms(10)),
        utilityAccount: 'utility',
        wasteHeatAccount: 'waste-heat',
        condensateAccount: 'condensate',
        startTempC: 20,
      }),
    ).toThrow(/chamber door is open/);
  });
});

describe('chocolate tempering', () => {
  it('conserves energy exactly across a wide mass range and reports a Form V fraction in [0, 1]', () => {
    const rng = createSeededRng(31415);
    const masses = [1n, 97n, kilograms(1), kilograms(100), kilograms(5_000)];

    for (const massUg of masses) {
      const unit = readyUnit(createTemperingKettle('kettle-1', 'x'));
      const ledger = new Ledger();
      openAccounts(ledger, [
        { id: 'utility', kind: 'external' },
        { id: 'waste-heat', kind: 'external' },
      ]);

      const startTempC = 15 + rng.next() * 10;
      const { posting, heatingEnergy, coolingEnergy, crystalFormVFraction } = temperChocolate(unit, {
        massUg,
        startTempC,
        utilityAccount: 'utility',
        wasteHeatAccount: 'waste-heat',
      });

      ledger.post(posting);
      expect(ledger.audit().ok).toBe(true);
      expect(heatingEnergy).toBeGreaterThan(0n);
      expect(coolingEnergy).toBeGreaterThan(0n);
      expect(crystalFormVFraction).toBeGreaterThanOrEqual(0);
      expect(crystalFormVFraction).toBeLessThanOrEqual(1);
    }
  });

  it('lands close to full Form V crystal when held exactly on the documented seed and work temperatures', () => {
    const unit = readyUnit(createTemperingKettle('kettle-2', 'x'));
    unit.machine.setTag('seed-temperature-c', CHOCOLATE_SEED_TEMP_C);
    unit.machine.setTag('work-temperature-c', CHOCOLATE_WORK_TEMP_C);

    const ledger = new Ledger();
    openAccounts(ledger, [
      { id: 'utility', kind: 'external' },
      { id: 'waste-heat', kind: 'external' },
    ]);

    const { crystalFormVFraction } = temperChocolate(unit, {
      massUg: kilograms(10),
      startTempC: 20,
      utilityAccount: 'utility',
      wasteHeatAccount: 'waste-heat',
    });

    expect(crystalFormVFraction).toBeCloseTo(1, 5);
  });

  it('reports a lower Form V fraction when the seed stage misses the nucleation band', () => {
    const unit = readyUnit(createTemperingKettle('kettle-3', 'x'));
    unit.machine.setTag('seed-temperature-c', 24); // well below the 27-28 C nucleation band
    unit.machine.setTag('work-temperature-c', CHOCOLATE_WORK_TEMP_C);

    const { crystalFormVFraction } = temperChocolate(unit, {
      massUg: kilograms(10),
      startTempC: 20,
      utilityAccount: 'utility',
      wasteHeatAccount: 'waste-heat',
    });

    expect(crystalFormVFraction).toBeLessThan(0.5);
  });
});

describe('enrober', () => {
  it('merges product and retained coating exactly, across a wide mass range, with excess coating never leaving the supply', () => {
    const masses = [1n, 41n, kilograms(1), kilograms(300)];

    for (const massUg of masses) {
      const unit = readyUnit(createEnrober('enrober-1', 'x'));
      const ledger = new Ledger();
      openAccounts(ledger, [
        { id: 'product', kind: 'stock' },
        { id: 'coating', kind: 'stock' },
        { id: 'coated', kind: 'stock' },
      ]);
      const productComposition = registry.getComposition('wheat-flour-white', massUg);
      const coatingMassUg = massUg / 4n + 1n;
      const retainedCoatingComposition = registry.getComposition('butter', coatingMassUg);
      seedFromGenesis(ledger, 'product', productComposition, 'genesis:test-product');
      seedFromGenesis(ledger, 'coating', retainedCoatingComposition, 'genesis:test-coating');

      const { posting, coatedMass } = enrobe(unit, {
        productAccount: 'product',
        productComposition,
        coatingAccount: 'coating',
        retainedCoatingComposition,
        coatedProductAccount: 'coated',
      });

      ledger.post(posting);
      expect(ledger.audit().ok).toBe(true);
      expect(coatedMass).toBe(massUg + coatingMassUg);
      expect(ledger.balance('product', 'el:C')).toBe(0n);
      expect(ledger.balance('coating', 'el:C')).toBe(0n);
    }
  });
});

describe('spray, airbrush, glazing, icing depositor, edible-ink printer, sprinkle applicator, layering line', () => {
  const creators: readonly [string, (id: string, label: string) => ProcessUnit][] = [
    ['spray applicator', createSprayApplicator],
    ['airbrush applicator', createAirbrushApplicator],
    ['glazer', createGlazer],
    ['icing depositor', createIcingDepositor],
    ['edible-ink printer', createEdibleInkPrinter],
    ['sprinkle applicator', createSprinkleApplicator],
    ['layering line', createLayeringLine],
  ];

  for (const [name, create] of creators) {
    it(`${name} is mass-and-element exact across a wide range of batch sizes and retained fractions`, () => {
      const rng = createSeededRng(24680 + name.length);
      const masses = [1n, 41n, kilograms(1), kilograms(50)];

      for (const massUg of masses) {
        const unit = readyUnit(create('u', 'x'));
        const minRetained = unit.machine.tagDefinition('retained-fraction').min;
        unit.machine.setTag('retained-fraction', minRetained + rng.next() * (1 - minRetained));

        const ledger = new Ledger();
        openAccounts(ledger, [
          { id: 'product', kind: 'stock' },
          { id: 'finish', kind: 'stock' },
          { id: 'finished', kind: 'stock' },
          { id: 'loss', kind: 'stock' },
        ]);
        const productComposition = registry.getComposition('wheat-flour-white', massUg);
        const finishMassUg = massUg / 5n + 1n;
        const finishComposition = registry.getComposition('sucrose', finishMassUg);
        seedFromGenesis(ledger, 'product', productComposition, 'genesis:test-product');
        seedFromGenesis(ledger, 'finish', finishComposition, 'genesis:test-finish');

        const { posting, retainedMass, lossMass } = applyFinish(unit, {
          productAccount: 'product',
          productComposition,
          finishAccount: 'finish',
          finishComposition,
          finishedProductAccount: 'finished',
          lossAccount: 'loss',
        });

        ledger.post(posting);
        expect(ledger.audit().ok).toBe(true);
        expect(retainedMass + lossMass).toBe(finishMassUg);
      }
    });
  }
});
