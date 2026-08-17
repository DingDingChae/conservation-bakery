import { describe, expect, it } from 'vitest';

import { kilograms } from '../core/commodity.js';
import { Ledger } from '../core/ledger.js';
import { createSeededRng } from '../process/failure.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';
import {
  PASTEURIZATION_HOLD_TEMP_C,
  churnCream,
  createCreamery,
  pasteurize,
  separateMilk,
} from './creamery.js';

const registry = defaultSubstanceRegistry();

function openCreameryLedger(): Ledger {
  const ledger = new Ledger();
  for (const id of ['milk', 'cream', 'skim', 'butter', 'buttermilk', 'utility', 'waste-heat']) {
    ledger.openAccount({
      id,
      kind: id === 'utility' || id === 'waste-heat' ? 'external' : 'stock',
      label: id,
    });
  }
  return ledger;
}

function seedMilk(ledger: Ledger, massUg: bigint): void {
  const composition = registry.getComposition('cow-milk-whole', massUg);
  const entries = [];
  for (const [element, amount] of composition) {
    if (amount === 0n) continue;
    entries.push({ account: 'milk', commodity: `el:${element}` as const, delta: amount });
    entries.push({ account: 'genesis', commodity: `el:${element}` as const, delta: -amount });
  }
  ledger.post({ process: 'genesis:test-milk', entries });
}

function readyCreamery(id = 'creamery-1') {
  const unit = createCreamery(id, 'test creamery');
  unit.machine.commission();
  unit.machine.requestMode('MANUAL');
  return unit;
}

describe('separateMilk', () => {
  it('refuses to run with an empty vat', () => {
    const unit = readyCreamery();
    const milkComposition = registry.getComposition('cow-milk-whole', kilograms(100));
    expect(() =>
      separateMilk(unit, registry, {
        milkAccount: 'milk',
        milkComposition,
        creamAccount: 'cream',
        skimAccount: 'skim',
      }),
    ).toThrow(/vat is empty/);
  });

  it('is mass-and-element exact across a wide range of batch sizes and separation rates', () => {
    const rng = createSeededRng(998877);
    const masses = [1n, 13n, 97n, kilograms(1), kilograms(250), 999_999_999_999n];

    for (const massUg of masses) {
      const unit = readyCreamery();
      unit.machine.setTag('vat-level-kg', 1_000_000);
      unit.machine.setTag('separation-rate', 0.06 + rng.next() * (0.18 - 0.06));

      const ledger = openCreameryLedger();
      seedMilk(ledger, massUg);
      const milkComposition = registry.getComposition('cow-milk-whole', massUg);

      const { posting, yields } = separateMilk(unit, registry, {
        milkAccount: 'milk',
        milkComposition,
        creamAccount: 'cream',
        skimAccount: 'skim',
      });

      ledger.post(posting);
      expect(ledger.audit().ok).toBe(true);
      expect(yields.cream + yields.skim).toBe(massUg);
    }
  });

  it("lands cream's yield near the documented ~10% separation rate by default", () => {
    const unit = readyCreamery();
    unit.machine.setTag('vat-level-kg', 1_000_000);
    const ledger = openCreameryLedger();
    const massUg = kilograms(1_000);
    seedMilk(ledger, massUg);
    const milkComposition = registry.getComposition('cow-milk-whole', massUg);

    const { posting, yields } = separateMilk(unit, registry, {
      milkAccount: 'milk',
      milkComposition,
      creamAccount: 'cream',
      skimAccount: 'skim',
    });
    ledger.post(posting);

    const creamFraction = Number(yields.cream) / Number(massUg);
    expect(creamFraction).toBeGreaterThan(0.03);
    expect(creamFraction).toBeLessThan(0.2);
  });
});

describe('pasteurize', () => {
  it('moves no mass, only energy, drawn from a real utility account', () => {
    const unit = readyCreamery();
    const ledger = openCreameryLedger();
    const composition = registry.getComposition('cream', kilograms(100));

    const { posting, energy } = pasteurize(unit, {
      composition,
      utilityAccount: 'utility',
      wasteHeatAccount: 'waste-heat',
    });

    expect(energy).toBeGreaterThan(0n);
    for (const entry of posting.entries) {
      expect(entry.commodity).toBe('energy:uJ');
    }
    ledger.post(posting);
    expect(ledger.audit().ok).toBe(true);
    expect(ledger.balance('utility', 'energy:uJ')).toBe(-energy);
    expect(ledger.balance('waste-heat', 'energy:uJ')).toBe(energy);
    expect(unit.machine.getTag('pasteurization-temperature-c')).toBe(PASTEURIZATION_HOLD_TEMP_C);
  });

  it('costs no energy when the stream is already at or above the hold temperature', () => {
    const unit = readyCreamery();
    const composition = registry.getComposition('cream', kilograms(10));
    const { energy } = pasteurize(unit, {
      composition,
      utilityAccount: 'utility',
      wasteHeatAccount: 'waste-heat',
      startTempC: PASTEURIZATION_HOLD_TEMP_C,
    });
    expect(energy).toBe(0n);
  });
});

describe('churnCream', () => {
  it('refuses to churn cream that has not been held at pasteurisation temperature', () => {
    const unit = readyCreamery();
    const creamComposition = registry.getComposition('cream', kilograms(50));
    expect(() =>
      churnCream(unit, registry, {
        creamAccount: 'cream',
        creamComposition,
        butterAccount: 'butter',
        buttermilkAccount: 'buttermilk',
      }),
    ).toThrow(/pasteurisation hold temperature/);
  });

  it('is mass-and-element exact once pasteurised, across a wide range of batch sizes', () => {
    const rng = createSeededRng(112233);
    const masses = [1n, 41n, kilograms(1), kilograms(300), 555_555_555_555n];

    for (const massUg of masses) {
      const unit = readyCreamery();
      pasteurize(unit, {
        composition: registry.getComposition('cream', kilograms(1)),
        utilityAccount: 'utility',
        wasteHeatAccount: 'waste-heat',
      });
      unit.machine.setTag('churn-yield-fraction', 0.3 + rng.next() * (0.45 - 0.3));

      const ledger = openCreameryLedger();
      const creamComposition = registry.getComposition('cream', massUg);
      const entries = [];
      for (const [element, amount] of creamComposition) {
        if (amount === 0n) continue;
        entries.push({ account: 'cream', commodity: `el:${element}` as const, delta: amount });
        entries.push({ account: 'genesis', commodity: `el:${element}` as const, delta: -amount });
      }
      ledger.post({ process: 'genesis:test-cream', entries });

      const { posting, yields } = churnCream(unit, registry, {
        creamAccount: 'cream',
        creamComposition,
        butterAccount: 'butter',
        buttermilkAccount: 'buttermilk',
      });

      ledger.post(posting);
      expect(ledger.audit().ok).toBe(true);
      expect(yields.butter + yields.buttermilk).toBe(massUg);
    }
  });

  it("lands butter's yield near cream's own fat fraction for the default churn setpoint", () => {
    const unit = readyCreamery();
    pasteurize(unit, {
      composition: registry.getComposition('cream', kilograms(1)),
      utilityAccount: 'utility',
      wasteHeatAccount: 'waste-heat',
    });

    const massUg = kilograms(500);
    const creamComposition = registry.getComposition('cream', massUg);
    const { yields } = churnCream(unit, registry, {
      creamAccount: 'cream',
      creamComposition,
      butterAccount: 'butter',
      buttermilkAccount: 'buttermilk',
    });

    const butterFraction = Number(yields.butter) / Number(massUg);
    expect(butterFraction).toBeGreaterThan(0.25);
    expect(butterFraction).toBeLessThan(0.5);
  });
});

describe('full creamery run', () => {
  it('keeps the ledger in audit across many separate-pasteurise-churn cycles', () => {
    const unit = readyCreamery();
    const ledger = openCreameryLedger();
    const rng = createSeededRng(2026);

    for (let batch = 0; batch < 30; batch += 1) {
      const milkMassUg = kilograms(20) + BigInt(Math.floor(rng.next() * 1_000_000_000));
      unit.machine.setTag('vat-level-kg', 1_000_000);
      seedMilk(ledger, milkMassUg);
      const milkComposition = registry.getComposition('cow-milk-whole', milkMassUg);

      const { posting: separatePosting, compositions: separateCompositions } = separateMilk(unit, registry, {
        milkAccount: 'milk',
        milkComposition,
        creamAccount: 'cream',
        skimAccount: 'skim',
      });
      ledger.post(separatePosting);
      expect(ledger.audit().ok).toBe(true);

      // Chain the *actual* posted cream composition into the next step, not a
      // nominal registry composition — see `SeparateMilkCompositions`.
      const { posting: pasteurizePosting } = pasteurize(unit, {
        composition: separateCompositions.cream,
        utilityAccount: 'utility',
        wasteHeatAccount: 'waste-heat',
      });
      ledger.post(pasteurizePosting);
      expect(ledger.audit().ok).toBe(true);

      const { posting: churnPosting } = churnCream(unit, registry, {
        creamAccount: 'cream',
        creamComposition: separateCompositions.cream,
        butterAccount: 'butter',
        buttermilkAccount: 'buttermilk',
      });
      ledger.post(churnPosting);

      const events = unit.machine.advance(1, 0.6, rng);
      void events;
      expect(ledger.audit().ok).toBe(true);
      expect(ledger.balance('cream', 'el:C')).toBe(0n);
    }
  });
});
