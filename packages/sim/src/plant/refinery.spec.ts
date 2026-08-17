import { describe, expect, it } from 'vitest';

import { kilograms } from '../core/commodity.js';
import { Ledger } from '../core/ledger.js';
import { createSeededRng } from '../process/failure.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';
import { createRefinery, refineSugarBeet } from './refinery.js';

const registry = defaultSubstanceRegistry();

function openRefineryLedger(): Ledger {
  const ledger = new Ledger();
  for (const id of ['beet', 'sucrose', 'pulp', 'molasses']) {
    ledger.openAccount({ id, kind: 'stock', label: id });
  }
  ledger.openAccount({ id: 'atmosphere', kind: 'reservoir', label: 'atmosphere' });
  return ledger;
}

function seedBeet(ledger: Ledger, massUg: bigint): void {
  const composition = registry.getComposition('sugar-beet', massUg);
  const entries = [];
  for (const [element, amount] of composition) {
    if (amount === 0n) continue;
    entries.push({ account: 'beet', commodity: `el:${element}` as const, delta: amount });
    entries.push({ account: 'genesis', commodity: `el:${element}` as const, delta: -amount });
  }
  ledger.post({ process: 'genesis:test-beet', entries });
}

function readyRefinery(id = 'refinery-1') {
  const unit = createRefinery(id, 'test refinery');
  unit.machine.commission();
  unit.machine.requestMode('MANUAL');
  return unit;
}

describe('refineSugarBeet', () => {
  it('refuses to run with an empty hopper', () => {
    const unit = readyRefinery();
    const beetComposition = registry.getComposition('sugar-beet', kilograms(100));
    expect(() =>
      refineSugarBeet(unit, registry, {
        beetAccount: 'beet',
        beetComposition,
        sucroseAccount: 'sucrose',
        pulpAccount: 'pulp',
        molassesAccount: 'molasses',
        evaporationAccount: 'atmosphere',
      }),
    ).toThrow(/hopper is empty/);
  });

  it('is mass-and-element exact across a wide range of batch sizes and setpoints', () => {
    const rng = createSeededRng(554433);
    const masses = [1n, 11n, 9_973n, kilograms(1), kilograms(400), 1_299_827_000_003n];

    for (const massUg of masses) {
      const unit = readyRefinery();
      unit.machine.setTag('hopper-level-kg', 5_000_000);
      unit.machine.setTag('extraction-rate', 0.1 + rng.next() * (0.18 - 0.1));
      unit.machine.setTag('pulp-fraction', 0.3 + rng.next() * (0.7 - 0.3));
      unit.machine.setTag('evaporation-loss-fraction', rng.next() * 0.05);

      const ledger = openRefineryLedger();
      seedBeet(ledger, massUg);
      const beetComposition = registry.getComposition('sugar-beet', massUg);

      const { posting, yields } = refineSugarBeet(unit, registry, {
        beetAccount: 'beet',
        beetComposition,
        sucroseAccount: 'sucrose',
        pulpAccount: 'pulp',
        molassesAccount: 'molasses',
        evaporationAccount: 'atmosphere',
      });

      ledger.post(posting);
      expect(ledger.audit().ok).toBe(true);
      expect(ledger.balance('beet', 'el:C')).toBe(0n);

      const total = yields.sucrose + yields.pulp + yields.molasses + yields.evaporationLoss;
      expect(total).toBe(massUg);
    }
  });

  it('lands sucrose extraction near the documented ~15% rate by default, as near-pure sucrose', () => {
    const unit = readyRefinery();
    unit.machine.setTag('hopper-level-kg', 5_000_000);

    const ledger = openRefineryLedger();
    const massUg = kilograms(1_000);
    seedBeet(ledger, massUg);
    const beetComposition = registry.getComposition('sugar-beet', massUg);

    const { posting, yields, compositions } = refineSugarBeet(unit, registry, {
      beetAccount: 'beet',
      beetComposition,
      sucroseAccount: 'sucrose',
      pulpAccount: 'pulp',
      molassesAccount: 'molasses',
      evaporationAccount: 'atmosphere',
    });
    ledger.post(posting);

    const sucroseFraction = Number(yields.sucrose) / Number(massUg);
    expect(sucroseFraction).toBeGreaterThan(0.08);
    expect(sucroseFraction).toBeLessThan(0.25);

    // The sucrose stream should carry essentially none of the beet's minerals —
    // it draws only on sucrose's own (C, H, O)-only profile.
    expect(compositions.sucrose.get('K') ?? 0n).toBe(0n);
    expect(compositions.sucrose.get('Ca') ?? 0n).toBe(0n);
    expect(compositions.sucrose.get('Ash') ?? 0n).toBe(0n);
  });

  it('keeps the ledger in audit across a long run of many batches', () => {
    const unit = readyRefinery();
    const ledger = openRefineryLedger();
    const rng = createSeededRng(9001);

    for (let batch = 0; batch < 50; batch += 1) {
      const massUg = kilograms(50) + BigInt(Math.floor(rng.next() * 2_000_000_000));
      unit.machine.setTag('hopper-level-kg', 5_000_000);
      seedBeet(ledger, massUg);
      const beetComposition = registry.getComposition('sugar-beet', massUg);

      const { posting } = refineSugarBeet(unit, registry, {
        beetAccount: 'beet',
        beetComposition,
        sucroseAccount: 'sucrose',
        pulpAccount: 'pulp',
        molassesAccount: 'molasses',
        evaporationAccount: 'atmosphere',
      });
      ledger.post(posting);

      const events = unit.machine.advance(1, 0.65, rng);
      void events;
      expect(ledger.audit().ok).toBe(true);
    }

    expect(ledger.postingCount).toBeGreaterThan(50);
  });
});
