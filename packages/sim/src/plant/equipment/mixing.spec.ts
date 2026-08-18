import { describe, expect, it } from 'vitest';

import type { Element } from '../../core/commodity.js';
import { grams, kilograms } from '../../core/commodity.js';
import { Ledger } from '../../core/ledger.js';
import { createSeededRng } from '../../process/failure.js';
import { defaultSubstanceRegistry } from '../../substance/registry.js';
import type { ProcessUnit } from '../unit.js';
import { UnbalancedProcessError, buildProcessPosting } from '../unit.js';
import {
  aerateBatch,
  createAerator,
  createContinuousMixer,
  createDivider,
  createExtruder,
  createGuillotine,
  createPistonDepositor,
  createPlanetaryMixer,
  createRotaryMoulder,
  createSheeter,
  createSieve,
  createSifter,
  createSiloDoser,
  createSpiralMixer,
  createUltrasonicCutter,
  createVolumetricDepositor,
  createWireCutMoulder,
  doseFromSilo,
  formPortions,
  mixBatch,
} from './mixing.js';
import { openAccounts, seedFromGenesis } from './testSupport.js';

const registry = defaultSubstanceRegistry();

function readyUnit(unit: ProcessUnit): ProcessUnit {
  unit.machine.commission();
  unit.machine.requestMode('MANUAL');
  return unit;
}

describe('mixers: planetary, spiral, continuous', () => {
  const creators: readonly [string, (id: string, label: string) => ProcessUnit][] = [
    ['planetary', createPlanetaryMixer],
    ['spiral', createSpiralMixer],
    ['continuous', createContinuousMixer],
  ];

  for (const [name, create] of creators) {
    it(`${name} mixer conserves energy exactly and reports a non-negative temperature rise, across a wide mass range`, () => {
      const rng = createSeededRng(4242 + name.length);
      const masses = [1n, 97n, kilograms(1), kilograms(500), kilograms(50_000)];

      for (const massUg of masses) {
        const unit = readyUnit(create('mixer-1', 'test mixer'));
        unit.machine.setTag('bowl-guard-closed', 1);
        unit.machine.setTag('specific-work-j-per-kg', 2_000 + rng.next() * (42_000 - 2_000));

        const ledger = new Ledger();
        openAccounts(ledger, [
          { id: 'utility', kind: 'external' },
          { id: 'waste-heat', kind: 'external' },
        ]);

        const productComposition = registry.getComposition('wheat-flour-white', massUg);
        const { posting, energy, temperatureRiseC } = mixBatch(unit, {
          productAccount: 'product',
          productComposition,
          utilityAccount: 'utility',
          wasteHeatAccount: 'waste-heat',
        });

        ledger.post(posting);
        expect(ledger.audit().ok).toBe(true);
        expect(energy).toBeGreaterThanOrEqual(0n);
        expect(temperatureRiseC).toBeGreaterThanOrEqual(0);
        expect(ledger.balance('utility', 'energy:uJ')).toBe(-energy);
        expect(ledger.balance('waste-heat', 'energy:uJ')).toBe(energy);
      }
    });
  }

  it('refuses to mix with the bowl guard open', () => {
    const unit = readyUnit(createPlanetaryMixer('mixer-2', 'test mixer'));
    // bowl-guard-closed left at its initial 0 (open).
    expect(() =>
      mixBatch(unit, {
        productAccount: 'product',
        productComposition: registry.getComposition('wheat-flour-white', kilograms(1)),
        utilityAccount: 'utility',
        wasteHeatAccount: 'waste-heat',
      }),
    ).toThrow(/bowl guard is open/);
  });
});

describe('pressure-whisk aerator', () => {
  it('folds real air mass in from the atmosphere reservoir, exactly, across a wide range of target air fractions', () => {
    const rng = createSeededRng(998811);
    const fractions = [0.01, 0.1, 0.35, 0.5, 0.64];

    for (const fraction of fractions) {
      const unit = readyUnit(createAerator('aerator-1', 'test aerator'));
      unit.machine.setTag('chamber-pressure-bar', 1 + rng.next() * 4);
      unit.machine.setTag('target-air-volume-fraction', fraction);

      const ledger = new Ledger();
      openAccounts(ledger, [
        { id: 'base', kind: 'stock' },
        { id: 'atmosphere', kind: 'reservoir' },
      ]);
      const baseMassUg = kilograms(200);
      const baseComposition = registry.getComposition('cream', baseMassUg);
      seedFromGenesis(ledger, 'base', baseComposition, 'genesis:test-base');
      // A generous but finite atmosphere reservoir to draw whisked air from.
      seedFromGenesis(
        ledger,
        'atmosphere',
        registry.getComposition('atmospheric-nitrogen', kilograms(1_000_000)),
        'genesis:test-air-n',
      );
      seedFromGenesis(
        ledger,
        'atmosphere',
        registry.getComposition('atmospheric-oxygen', kilograms(1_000_000)),
        'genesis:test-air-o',
      );
      // `airComposition` also draws a small "Ash" share standing in for
      // argon and trace gases (see shared.ts) — seed enough for it to draw on.
      seedFromGenesis(
        ledger,
        'atmosphere',
        new Map<Element, bigint>([['Ash', kilograms(1_000_000)]]),
        'genesis:test-air-trace',
      );

      const before =
        ledger.balance('atmosphere', 'el:N') +
        ledger.balance('atmosphere', 'el:O') +
        ledger.balance('atmosphere', 'el:Ash');

      const { posting, airMass } = aerateBatch(unit, {
        baseAccount: 'base',
        baseComposition,
        atmosphereAccount: 'atmosphere',
      });

      ledger.post(posting);
      expect(ledger.audit().ok).toBe(true);
      expect(airMass).toBeGreaterThan(0n);
      // Air is roughly three orders of magnitude less dense than the base —
      // even the maximum setpoint fraction should never approach the base's
      // own mass.
      expect(airMass).toBeLessThan(baseMassUg / 10n);

      const after =
        ledger.balance('atmosphere', 'el:N') +
        ledger.balance('atmosphere', 'el:O') +
        ledger.balance('atmosphere', 'el:Ash');
      expect(before - after).toBeGreaterThan(0n);
    }
  });

  it('refuses to whisk outside its chamber pressure operating band', () => {
    const unit = readyUnit(createAerator('aerator-2', 'test aerator'));
    unit.machine.setTag('chamber-pressure-bar', 0); // below the 1-6 bar band
    expect(() =>
      aerateBatch(unit, {
        baseAccount: 'base',
        baseComposition: registry.getComposition('cream', kilograms(10)),
        atmosphereAccount: 'atmosphere',
      }),
    ).toThrow(/chamber pressure/);
  });
});

describe('forming, cutting and sieving', () => {
  const creators: readonly [string, (id: string, label: string) => ProcessUnit][] = [
    ['sheeter', createSheeter],
    ['extruder', createExtruder],
    ['wire-cut moulder', createWireCutMoulder],
    ['rotary moulder', createRotaryMoulder],
    ['piston depositor', createPistonDepositor],
    ['volumetric depositor', createVolumetricDepositor],
    ['divider', createDivider],
    ['guillotine', createGuillotine],
    ['ultrasonic cutter', createUltrasonicCutter],
    ['sieve', createSieve],
    ['sifter', createSifter],
  ];

  for (const [name, create] of creators) {
    it(`${name} is mass-and-element exact across a wide range of batch sizes and yield fractions`, () => {
      const rng = createSeededRng(13579 + name.length);
      const masses = [1n, 41n, kilograms(1), kilograms(300), kilograms(20_000)];

      for (const massUg of masses) {
        const unit = readyUnit(create('u', 'x'));
        unit.machine.setTag('feed-level-kg', 1_000_000);
        const minYield = unit.machine.tagDefinition('yield-fraction').min;
        unit.machine.setTag('yield-fraction', minYield + rng.next() * (1 - minYield));

        const ledger = new Ledger();
        openAccounts(ledger, [
          { id: 'in', kind: 'stock' },
          { id: 'product', kind: 'stock' },
          { id: 'secondary', kind: 'stock' },
        ]);
        const inputComposition = registry.getComposition('wheat-flour-white', massUg);
        seedFromGenesis(ledger, 'in', inputComposition, 'genesis:test-in');

        const result = formPortions(unit, {
          inputAccount: 'in',
          inputComposition,
          productAccount: 'product',
          secondaryAccount: 'secondary',
        });

        ledger.post(result.posting);
        expect(ledger.audit().ok).toBe(true);
        expect(result.productMass + result.secondaryMass).toBe(massUg);
      }
    });
  }

  it('refuses to run with an empty feed', () => {
    const unit = readyUnit(createSheeter('sheeter-1', 'x'));
    expect(() =>
      formPortions(unit, {
        inputAccount: 'in',
        inputComposition: registry.getComposition('wheat-flour-white', kilograms(1)),
        productAccount: 'product',
        secondaryAccount: 'secondary',
      }),
    ).toThrow(/feed is empty/);
  });
});

describe('metered silo dosing', () => {
  it('meters an exact dose from the silo into a batch, across a wide range of dose sizes', () => {
    const masses = [1n, 13n, grams(50), kilograms(2), kilograms(1_000)];

    for (const doseMassUg of masses) {
      const unit = readyUnit(createSiloDoser('doser-1', 'x'));
      unit.machine.setTag('silo-level-kg', 1_000_000);

      const ledger = new Ledger();
      openAccounts(ledger, [
        { id: 'silo', kind: 'stock' },
        { id: 'batch', kind: 'stock' },
      ]);
      const doseComposition = registry.getComposition('sodium-chloride', doseMassUg);
      seedFromGenesis(ledger, 'silo', doseComposition, 'genesis:test-silo');

      const { posting, doseMass } = doseFromSilo(unit, {
        siloAccount: 'silo',
        doseComposition,
        batchAccount: 'batch',
      });

      ledger.post(posting);
      expect(ledger.audit().ok).toBe(true);
      expect(doseMass).toBe(doseMassUg);
      expect(ledger.balance('silo', 'el:Na')).toBe(0n);
    }
  });

  it('refuses to dose from an empty silo', () => {
    const unit = readyUnit(createSiloDoser('doser-2', 'x'));
    expect(() =>
      doseFromSilo(unit, {
        siloAccount: 'silo',
        doseComposition: registry.getComposition('sodium-chloride', grams(10)),
        batchAccount: 'batch',
      }),
    ).toThrow(/silo is empty/);
  });
});

describe('the shared balance guarantee applies to every equipment posting', () => {
  it('rejects an over-declared output from an equipment-shaped process step, before it ever reaches the ledger', () => {
    const input = registry.getComposition('wheat-flour-white', kilograms(10));
    // Deliberately declare one microgram more carbon than the input has.
    const overDeclared = new Map(input);
    overDeclared.set('C', (overDeclared.get('C') ?? 0n) + 1n);

    expect(() =>
      buildProcessPosting({
        process: 'equipment:test-leaky-forming-unit',
        inputs: [{ account: 'in', composition: input }],
        outputs: [{ account: 'out', composition: overDeclared }],
      }),
    ).toThrow(UnbalancedProcessError);
  });
});
