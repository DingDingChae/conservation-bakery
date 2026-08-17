import { describe, expect, it } from 'vitest';

import { compositionMass, kilograms } from '../core/commodity.js';
import { Ledger } from '../core/ledger.js';
import { createSeededRng } from '../process/failure.js';
import { checkGraphClosure } from '../provenance/closure.js';
import { LotGraph } from '../provenance/graph.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';
import { createMill, millGrain } from './mill.js';

const registry = defaultSubstanceRegistry();

function openMillLedger(): Ledger {
  const ledger = new Ledger();
  for (const id of ['grain', 'flour', 'bran', 'germ', 'dust']) {
    ledger.openAccount({ id, kind: 'stock', label: id });
  }
  ledger.openAccount({ id: 'atmosphere', kind: 'reservoir', label: 'atmosphere' });
  return ledger;
}

/** Seed `grain` with `massUg` of real wheat grain from genesis, then seal off
 * genesis just like `world/accounts.ts`'s `seedWorld` does for the real world. */
function seedGrain(ledger: Ledger, massUg: bigint): void {
  const composition = registry.getComposition('wheat-grain', massUg);
  const entries = [];
  for (const [element, amount] of composition) {
    if (amount === 0n) continue;
    entries.push({ account: 'grain', commodity: `el:${element}` as const, delta: amount });
    entries.push({ account: 'genesis', commodity: `el:${element}` as const, delta: -amount });
  }
  ledger.post({ process: 'genesis:test-grain', entries });
}

function readyMill(id = 'mill-1') {
  const unit = createMill(id, 'test mill');
  unit.machine.commission();
  unit.machine.requestMode('MANUAL');
  return unit;
}

describe('millGrain', () => {
  it('refuses to run with an empty hopper', () => {
    const unit = readyMill();
    const grainComposition = registry.getComposition('wheat-grain', kilograms(100));
    expect(() =>
      millGrain(unit, registry, {
        grainAccount: 'grain',
        grainComposition,
        flourAccount: 'flour',
        branAccount: 'bran',
        germAccount: 'germ',
        dustAccount: 'dust',
        moistureAccount: 'atmosphere',
      }),
    ).toThrow(/hopper is empty/);
  });

  it('is mass-and-element exact across a wide range of batch sizes and extraction rates', () => {
    const rng = createSeededRng(776655);
    const masses = [
      1n, // the smallest possible unit
      7n,
      9_973n, // prime
      kilograms(1),
      kilograms(50),
      kilograms(500),
      1_299_827_000_003n, // a large, deliberately not-round quantity
    ];

    for (const massUg of masses) {
      const unit = readyMill();
      unit.machine.setTag('hopper-level-kg', 1_000_000);
      unit.machine.setTag('extraction-rate', 0.6 + rng.next() * (0.85 - 0.6));
      unit.machine.setTag('moisture-loss-fraction', rng.next() * 0.08);

      const ledger = openMillLedger();
      seedGrain(ledger, massUg);
      const grainComposition = registry.getComposition('wheat-grain', massUg);

      const { posting, yields } = millGrain(unit, registry, {
        grainAccount: 'grain',
        grainComposition,
        flourAccount: 'flour',
        branAccount: 'bran',
        germAccount: 'germ',
        dustAccount: 'dust',
        moistureAccount: 'atmosphere',
      });

      ledger.post(posting);
      expect(ledger.audit().ok).toBe(true);
      expect(ledger.balance('grain', 'el:C')).toBe(0n);

      const total = yields.flour + yields.bran + yields.germ + yields.dust + yields.moistureLoss;
      expect(total).toBe(massUg);
    }
  });

  it("lands each stream's yield in the documented range for the default extraction rate", () => {
    const unit = readyMill();
    unit.machine.setTag('hopper-level-kg', 1_000_000);
    // Leave extraction-rate and moisture-loss-fraction at their defaults: 76% and 3%.

    const ledger = openMillLedger();
    const massUg = kilograms(1_000);
    seedGrain(ledger, massUg);
    const grainComposition = registry.getComposition('wheat-grain', massUg);

    const { posting, yields } = millGrain(unit, registry, {
      grainAccount: 'grain',
      grainComposition,
      flourAccount: 'flour',
      branAccount: 'bran',
      germAccount: 'germ',
      dustAccount: 'dust',
      moistureAccount: 'atmosphere',
    });
    ledger.post(posting);

    const flourFraction = Number(yields.flour) / Number(massUg);
    const branFraction = Number(yields.bran) / Number(massUg);
    const germFraction = Number(yields.germ) / Number(massUg);
    const moistureFraction = Number(yields.moistureLoss) / Number(massUg);

    // Documented extraction rate is "about 76 percent" — the actual per-element
    // split will land close to, but not necessarily exactly at, the target
    // share, since the split respects real elemental concentration ratios.
    expect(flourFraction).toBeGreaterThan(0.65);
    expect(flourFraction).toBeLessThan(0.85);
    expect(branFraction).toBeGreaterThan(0.05);
    expect(branFraction).toBeLessThan(0.2);
    expect(germFraction).toBeGreaterThan(0);
    expect(germFraction).toBeLessThan(0.06);
    expect(moistureFraction).toBeGreaterThan(0);
    expect(moistureFraction).toBeLessThan(0.08);
  });

  it('keeps the ledger in audit across a long run of many batches', () => {
    const unit = readyMill();
    const ledger = openMillLedger();
    const rng = createSeededRng(42);

    for (let batch = 0; batch < 50; batch += 1) {
      const massUg = kilograms(10) + BigInt(Math.floor(rng.next() * 1_000_000_000));
      unit.machine.setTag('hopper-level-kg', 1_000_000);
      seedGrain(ledger, massUg);
      const grainComposition = registry.getComposition('wheat-grain', massUg);

      const { posting } = millGrain(unit, registry, {
        grainAccount: 'grain',
        grainComposition,
        flourAccount: 'flour',
        branAccount: 'bran',
        germAccount: 'germ',
        dustAccount: 'dust',
        moistureAccount: 'atmosphere',
      });
      ledger.post(posting);

      const events = unit.machine.advance(1, 0.7, rng);
      // Equipment events (component condemned) are legal outcomes of a long run;
      // what must never happen is a conservation failure.
      void events;
      expect(ledger.audit().ok).toBe(true);
    }

    expect(ledger.postingCount).toBeGreaterThan(50);
  });

  it('tracks provenance lots that close exactly when a grain lot id is supplied', () => {
    const unit = readyMill();
    unit.machine.setTag('hopper-level-kg', 1_000_000);
    const ledger = openMillLedger();
    const massUg = kilograms(200);
    seedGrain(ledger, massUg);
    const grainComposition = registry.getComposition('wheat-grain', massUg);

    const { posting, yields } = millGrain(unit, registry, {
      grainAccount: 'grain',
      grainComposition,
      flourAccount: 'flour',
      branAccount: 'bran',
      germAccount: 'germ',
      dustAccount: 'dust',
      moistureAccount: 'atmosphere',
      grainLotId: 'lot:0:0',
    });

    expect(posting.note).toContain('provenance:lots:v1');
    ledger.post(posting);
    expect(ledger.audit().ok).toBe(true);
    expect(yields.flour + yields.bran + yields.germ + yields.dust + yields.moistureLoss).toBe(massUg);
    expect(compositionMass(grainComposition)).toBe(massUg);
  });

  it('creates lots that pass the provenance graph closure audit', () => {
    const graph = new LotGraph();
    const ledger = new Ledger({ onPosting: graph.consume });
    for (const id of ['grain', 'flour', 'bran', 'germ', 'dust']) {
      ledger.openAccount({ id, kind: 'stock', label: id });
    }
    ledger.openAccount({ id: 'atmosphere', kind: 'reservoir', label: 'atmosphere' });

    // A root lot: material that entered the lot graph directly, with no lot
    // ancestry of its own (see `provenance/lot.ts`).
    const grainLotId = 'lot:root:grain';
    graph.addLot({
      id: grainLotId,
      substance: 'wheat-grain',
      mass: kilograms(500),
      tick: 0,
      process: 'genesis:test-grain-lot',
      parents: [],
      losses: [],
    });
    seedGrain(ledger, kilograms(500));
    const grainComposition = registry.getComposition('wheat-grain', kilograms(500));

    const unit = readyMill();
    unit.machine.setTag('hopper-level-kg', 1_000_000);

    const { posting } = millGrain(unit, registry, {
      grainAccount: 'grain',
      grainComposition,
      flourAccount: 'flour',
      branAccount: 'bran',
      germAccount: 'germ',
      dustAccount: 'dust',
      moistureAccount: 'atmosphere',
      grainLotId,
    });
    ledger.post(posting);

    // Four new lots (flour, bran, germ, dust), each with the root grain lot as
    // its only parent.
    expect(graph.size).toBe(5);
    expect(graph.childrenOf(grainLotId)).toHaveLength(4);

    const report = checkGraphClosure(graph);
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.rootsSkipped).toBe(1);
    expect(report.lotsChecked).toBe(4);
  });
});
