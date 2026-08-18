import { describe, expect, it } from 'vitest';

import { grams, kilograms } from '../../core/commodity.js';
import { Ledger } from '../../core/ledger.js';
import { defaultSubstanceRegistry } from '../../substance/registry.js';
import type { ProcessUnit } from '../unit.js';
import { washDownEquipment } from './shared.js';
import {
  checkWeightTolerance,
  createCasePacker,
  createCheckweigher,
  createDateCoder,
  createFlowWrapper,
  createLabeller,
  createMapFlushStation,
  createMetalDetector,
  createPalletiser,
  createQaLab,
  createTraySealer,
  createThermoformer,
  createVisionInspection,
  createXrayInspection,
  flushModifiedAtmosphere,
  inspectAndSort,
  measureColour,
  measureMoisture,
  measurePh,
  measureTexture,
  measureWaterActivity,
  packageProduct,
  palletise,
} from './packaging.js';
import { openAccounts, seedFromGenesis } from './testSupport.js';

const registry = defaultSubstanceRegistry();

function readyUnit(unit: ProcessUnit): ProcessUnit {
  unit.machine.commission();
  unit.machine.requestMode('MANUAL');
  return unit;
}

describe('flow wrapper, thermoformer, tray sealer, labeller, date coder, case packer — packageProduct', () => {
  const creators: readonly [string, (id: string, label: string) => ProcessUnit][] = [
    ['flow wrapper', createFlowWrapper],
    ['thermoformer', createThermoformer],
    ['tray sealer', createTraySealer],
    ['labeller', createLabeller],
    ['date coder', createDateCoder],
    ['case packer', createCasePacker],
  ];

  for (const [name, create] of creators) {
    it(`${name} merges product and packaging material exactly, across a wide range of batch sizes`, () => {
      const masses = [1n, 41n, kilograms(1), kilograms(300)];

      for (const massUg of masses) {
        const unit = readyUnit(create('u', 'x'));
        const ledger = new Ledger();
        openAccounts(ledger, [
          { id: 'product', kind: 'stock' },
          { id: 'material', kind: 'stock' },
          { id: 'packaged', kind: 'stock' },
        ]);
        const productComposition = registry.getComposition('wheat-flour-white', massUg);
        const materialMassUg = massUg / 10n + 1n;
        const materialComposition = registry.getComposition('polypropylene-film', materialMassUg);
        seedFromGenesis(ledger, 'product', productComposition, 'genesis:test-product');
        seedFromGenesis(ledger, 'material', materialComposition, 'genesis:test-material');

        const { posting, packagedMass } = packageProduct(unit, {
          productAccount: 'product',
          productComposition,
          materialAccount: 'material',
          materialComposition,
          packagedAccount: 'packaged',
        });

        ledger.post(posting);
        expect(ledger.audit().ok).toBe(true);
        expect(packagedMass).toBe(massUg + materialMassUg);
        expect(ledger.balance('product', 'el:C')).toBe(0n);
        expect(ledger.balance('material', 'el:C')).toBe(0n);
      }
    });
  }
});

describe('palletiser', () => {
  it('transfers cased goods exactly, adding no mass, across a wide range of batch sizes', () => {
    const masses = [1n, 41n, kilograms(1), kilograms(500)];

    for (const massUg of masses) {
      const unit = readyUnit(createPalletiser('palletiser-1', 'x'));
      unit.machine.setTag('case-count', 1);

      const ledger = new Ledger();
      openAccounts(ledger, [
        { id: 'cased', kind: 'stock' },
        { id: 'palletised', kind: 'stock' },
      ]);
      const casedGoodsComposition = registry.getComposition('cardboard', massUg);
      seedFromGenesis(ledger, 'cased', casedGoodsComposition, 'genesis:test-cased');

      const { posting } = palletise(unit, {
        casedGoodsAccount: 'cased',
        casedGoodsComposition,
        palletisedAccount: 'palletised',
        caseCount: 1,
      });

      ledger.post(posting);
      expect(ledger.audit().ok).toBe(true);
      expect(ledger.balance('cased', 'el:C')).toBe(0n);
      const palletisedTotal = [...ledger.balances('palletised').values()].reduce((a, b) => a + b, 0n);
      expect(palletisedTotal).toBe(massUg);
    }
  });

  it('refuses to run with nothing staged', () => {
    const unit = readyUnit(createPalletiser('palletiser-2', 'x'));
    expect(() =>
      palletise(unit, {
        casedGoodsAccount: 'cased',
        casedGoodsComposition: registry.getComposition('cardboard', kilograms(1)),
        palletisedAccount: 'palletised',
        caseCount: 1,
      }),
    ).toThrow(/no cases staged/);
  });
});

describe('modified-atmosphere flush', () => {
  it('conserves gas exactly: the supply is debited exactly what the headspace and atmosphere are credited, across a wide range of CO2 blends and headspace volumes', () => {
    const cases: readonly [number, number][] = [
      [0, 50],
      [0.3, 150],
      [0.5, 500],
      [1, 2_000],
    ];

    for (const [co2Fraction, headspaceMl] of cases) {
      const unit = readyUnit(createMapFlushStation('map-1', 'x'));
      unit.machine.setTag('co2-mass-fraction', co2Fraction);
      unit.machine.setTag('headspace-volume-ml', headspaceMl);

      const ledger = new Ledger();
      openAccounts(ledger, [
        { id: 'headspace', kind: 'stock' },
        { id: 'gas-supply', kind: 'stock' },
        { id: 'atmosphere', kind: 'reservoir' },
      ]);

      const displacedAirComposition = registry.getComposition('atmospheric-nitrogen', kilograms(1));
      seedFromGenesis(ledger, 'headspace', displacedAirComposition, 'genesis:test-headspace-air');
      // A generous but finite MAP gas manifold to draw from.
      seedFromGenesis(
        ledger,
        'gas-supply',
        registry.getComposition('atmospheric-nitrogen', kilograms(1_000)),
        'genesis:test-gas-n2-budget',
      );
      seedFromGenesis(
        ledger,
        'gas-supply',
        registry.getComposition('carbon-dioxide', kilograms(1_000)),
        'genesis:test-gas-co2-budget',
      );

      const { posting, gasMass, displacedMass } = flushModifiedAtmosphere(unit, {
        headspaceAccount: 'headspace',
        displacedAirComposition,
        gasSupplyAccount: 'gas-supply',
        atmosphereAccount: 'atmosphere',
      });

      ledger.post(posting);
      expect(ledger.audit().ok).toBe(true);
      expect(gasMass).toBeGreaterThan(0n);
      expect(displacedMass).toBe(kilograms(1));

      const headspaceTotal = [...ledger.balances('headspace').values()].reduce((a, b) => a + b, 0n);
      expect(headspaceTotal).toBe(gasMass);

      const atmosphereTotal = [...ledger.balances('atmosphere').values()].reduce((a, b) => a + b, 0n);
      expect(atmosphereTotal).toBe(displacedMass);

      const supplyTotalRemaining = [...ledger.balances('gas-supply').values()].reduce((a, b) => a + b, 0n);
      const supplyTotalSeeded = kilograms(1_000) + kilograms(1_000);
      expect(supplyTotalSeeded - supplyTotalRemaining).toBe(gasMass);
    }
  });
});

describe('metal detector, X-ray inspection, checkweigher, vision inspection — inspectAndSort', () => {
  it('diverts the whole mass to the good account when passed, and to reject when not, exactly, and trips a real reject alarm', () => {
    const stations: readonly [string, () => ReturnType<typeof createMetalDetector>][] = [
      ['metal detector', () => createMetalDetector('u', 'x')],
      ['X-ray inspection', () => createXrayInspection('u', 'x')],
      ['vision inspection', () => createVisionInspection('u', 'x')],
    ];

    for (const [, createStation] of stations) {
      const station = createStation();
      readyUnit(station.unit);
      expect(station.rejectAlarm.state).toBe('normal');

      const massUg = kilograms(2);
      const inputComposition = registry.getComposition('wheat-flour-white', massUg);

      const ledgerGood = new Ledger();
      openAccounts(ledgerGood, [
        { id: 'in', kind: 'stock' },
        { id: 'good', kind: 'stock' },
        { id: 'reject', kind: 'stock' },
      ]);
      seedFromGenesis(ledgerGood, 'in', inputComposition, 'genesis:test-good');
      const passResult = inspectAndSort(station, {
        inputAccount: 'in',
        inputComposition,
        goodAccount: 'good',
        rejectAccount: 'reject',
        reject: false,
        tick: 1,
      });
      ledgerGood.post(passResult.posting);
      expect(ledgerGood.audit().ok).toBe(true);
      expect(ledgerGood.balance('good', 'el:C')).toBe(inputComposition.get('C') ?? 0n);
      expect(ledgerGood.balance('reject', 'el:C')).toBe(0n);
      expect(station.rejectAlarm.state).toBe('normal');

      const ledgerReject = new Ledger();
      openAccounts(ledgerReject, [
        { id: 'in', kind: 'stock' },
        { id: 'good', kind: 'stock' },
        { id: 'reject', kind: 'stock' },
      ]);
      seedFromGenesis(ledgerReject, 'in', inputComposition, 'genesis:test-reject');
      const rejectResult = inspectAndSort(station, {
        inputAccount: 'in',
        inputComposition,
        goodAccount: 'good',
        rejectAccount: 'reject',
        reject: true,
        tick: 2,
      });
      ledgerReject.post(rejectResult.posting);
      expect(ledgerReject.audit().ok).toBe(true);
      expect(ledgerReject.balance('reject', 'el:C')).toBe(inputComposition.get('C') ?? 0n);
      expect(ledgerReject.balance('good', 'el:C')).toBe(0n);
      expect(station.rejectAlarm.state).toBe('active-unacknowledged');
    }
  });

  it('checkweigher flags a unit outside its target/tolerance band, and passes one within it', () => {
    const station = createCheckweigher('checkweigher-1', 'x');
    readyUnit(station.unit);
    station.unit.machine.setTag('target-mass-g', 500);
    station.unit.machine.setTag('tolerance-fraction', 0.02); // +/- 2%

    expect(checkWeightTolerance(station.unit, grams(500))).toBe(false); // exactly on target
    expect(checkWeightTolerance(station.unit, grams(495))).toBe(false); // within band
    expect(checkWeightTolerance(station.unit, grams(400))).toBe(true); // well under
    expect(checkWeightTolerance(station.unit, grams(600))).toBe(true); // well over
  });
});

describe('QA lab: moisture, water activity, pH, texture, colour', () => {
  const tests: readonly [string, typeof measureMoisture][] = [
    ['moisture', measureMoisture],
    ['water activity', measureWaterActivity],
    ['pH', measurePh],
    ['texture', measureTexture],
    ['colour', measureColour],
  ];

  for (const [name, measure] of tests) {
    it(`${name}: a real sample genuinely leaves the batch, exactly, across a wide range of batch and sample sizes`, () => {
      const cases: readonly [bigint, number][] = [
        [kilograms(1), 1],
        [kilograms(10), 5],
        [kilograms(500), 50],
        [grams(20), 0.5],
      ];

      for (const [batchMassUg, sampleMassG] of cases) {
        const unit = readyUnit(createQaLab('qa-lab-1', 'x'));
        unit.machine.setTag('sample-mass-g', sampleMassG);

        const ledger = new Ledger();
        openAccounts(ledger, [
          { id: 'batch', kind: 'stock' },
          { id: 'consumed', kind: 'stock' },
        ]);
        const batchComposition = registry.getComposition('wheat-flour-white', batchMassUg);
        seedFromGenesis(ledger, 'batch', batchComposition, 'genesis:test-batch');

        const before = ledger.balance('batch', 'el:C');
        const { posting, sampleMass, sampleComposition, remainingComposition } = measure(unit, {
          batchAccount: 'batch',
          batchComposition,
          consumedAccount: 'consumed',
        });

        ledger.post(posting);
        expect(ledger.audit().ok).toBe(true);
        expect(sampleMass).toBeGreaterThan(0n);
        expect(sampleMass).toBeLessThanOrEqual(batchMassUg);

        // The sample's own carbon genuinely left the batch account and landed,
        // whole, in the consumed account — never simply discarded.
        const sampleCarbon = sampleComposition.get('C') ?? 0n;
        const after = ledger.balance('batch', 'el:C');
        expect(after).toBe(remainingComposition.get('C') ?? 0n);
        expect(before - after).toBe(sampleCarbon);
        expect(ledger.balance('consumed', 'el:C')).toBe(sampleCarbon);
      }
    });
  }

  it('refuses to sample more mass than the batch actually has', () => {
    const unit = readyUnit(createQaLab('qa-lab-2', 'x'));
    unit.machine.setTag('sample-mass-g', 1_000_000); // an absurd sample size
    expect(() =>
      measureMoisture(unit, {
        batchAccount: 'batch',
        batchComposition: registry.getComposition('wheat-flour-white', grams(1)),
        consumedAccount: 'consumed',
      }),
    ).toThrow(/exceeds the batch/);
  });

  it('refuses to sample an empty batch', () => {
    const unit = readyUnit(createQaLab('qa-lab-3', 'x'));
    expect(() =>
      measureMoisture(unit, {
        batchAccount: 'batch',
        batchComposition: new Map(),
        consumedAccount: 'consumed',
      }),
    ).toThrow(/empty batch/);
  });
});

describe('equipment wash-down (wash water is real, tracked mass)', () => {
  it('rinse water and residue both leave for the drain exactly, never simply discarded', () => {
    const unit = readyUnit(createTraySealer('tray-sealer-1', 'x'));
    const ledger = new Ledger();
    openAccounts(ledger, [
      { id: 'residue', kind: 'stock' },
      { id: 'water-main', kind: 'external' },
      { id: 'drain', kind: 'stock' },
    ]);

    const residueComposition = registry.getComposition('sucrose', grams(2));
    const waterComposition = registry.getComposition('water-liquid', kilograms(2));
    seedFromGenesis(ledger, 'residue', residueComposition, 'genesis:test-residue');

    const { posting, wasteWaterComposition } = washDownEquipment(unit, {
      residueAccount: 'residue',
      residueComposition,
      waterSupplyAccount: 'water-main',
      waterComposition,
      wasteWaterAccount: 'drain',
    });

    ledger.post(posting);
    expect(ledger.audit().ok).toBe(true);
    expect(ledger.balance('residue', 'el:C')).toBe(0n);
    const drainTotal = [...ledger.balances('drain').values()].reduce((a, b) => a + b, 0n);
    expect(drainTotal).toBe(grams(2) + kilograms(2));
    const wasteWaterMass = [...wasteWaterComposition.values()].reduce((a, b) => a + b, 0n);
    expect(wasteWaterMass).toBe(grams(2) + kilograms(2));
  });
});
