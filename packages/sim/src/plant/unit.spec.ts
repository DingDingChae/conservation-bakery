/**
 * The balance-guarantee tests for `unit.ts` — the file every unit operation in
 * this directory depends on. If these hold, no process built on top of
 * `buildProcessPosting` or `splitByProfile` can silently leak or invent mass.
 */

import { describe, expect, it } from 'vitest';

import { grams, type Composition, type Element } from '../core/commodity.js';
import { Ledger } from '../core/ledger.js';
import { createSeededRng } from '../process/failure.js';
import type { MachineDefinition } from '../process/machine.js';
import {
  ProcessUnit,
  UnbalancedProcessError,
  buildProcessPosting,
  splitByProfile,
  type ProcessStep,
} from './unit.js';

function composition(entries: readonly (readonly [Element, bigint])[]): Composition {
  return new Map(entries);
}

function totalOf(composition: Composition): bigint {
  let sum = 0n;
  for (const amount of composition.values()) sum += amount;
  return sum;
}

/** Every commodity a posting touches must sum to exactly zero across its
 * entries — the same invariant `world/exchange.spec.ts` checks on its own
 * reaction builders, applied here to `buildProcessPosting`'s output. */
function expectSelfBalanced(entries: readonly { commodity: string; delta: bigint }[]): void {
  const sums = new Map<string, bigint>();
  for (const entry of entries) sums.set(entry.commodity, (sums.get(entry.commodity) ?? 0n) + entry.delta);
  for (const [commodity, residual] of sums) {
    expect(residual, `commodity ${commodity} residual`).toBe(0n);
  }
}

describe('buildProcessPosting', () => {
  it('builds a posting that balances exactly when outputs and losses reconcile with inputs', () => {
    const input = composition([
      ['C', grams(400)],
      ['H', grams(70)],
      ['O', grams(500)],
      ['Ash', grams(30)],
    ]);
    const output = composition([
      ['C', grams(390)],
      ['H', grams(68)],
      ['O', grams(480)],
      ['Ash', grams(28)],
    ]);
    const loss = composition([
      ['C', grams(10)],
      ['H', grams(2)],
      ['O', grams(20)],
      ['Ash', grams(2)],
    ]);

    const step: ProcessStep = {
      process: 'test:split',
      inputs: [{ account: 'in', composition: input }],
      outputs: [{ account: 'out', composition: output }],
      losses: [{ account: 'loss', composition: loss }],
    };

    const posting = buildProcessPosting(step);
    expect(posting.process).toBe('test:split');
    expectSelfBalanced(posting.entries);
  });

  it('conserves energy alongside mass', () => {
    const step: ProcessStep = {
      process: 'test:heat',
      inputs: [],
      outputs: [],
      energyInputs: [{ account: 'utility', amount: 500_000n }],
      energyOutputs: [{ account: 'sink', amount: 500_000n }],
    };
    const posting = buildProcessPosting(step);
    expectSelfBalanced(posting.entries);
  });

  it('rejects an over-declared output with a clear, specific message', () => {
    const input = composition([['C', grams(100)]]);
    const overDeclaredOutput = composition([['C', grams(101)]]); // one gram more carbon than went in

    const step: ProcessStep = {
      process: 'test:leaky',
      inputs: [{ account: 'in', composition: input }],
      outputs: [{ account: 'out', composition: overDeclaredOutput }],
    };

    expect(() => buildProcessPosting(step)).toThrow(UnbalancedProcessError);
    try {
      buildProcessPosting(step);
      expect.unreachable('buildProcessPosting should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnbalancedProcessError);
      const unbalanced = error as UnbalancedProcessError;
      expect(unbalanced.process).toBe('test:leaky');
      expect(unbalanced.commodity).toBe('el:C');
      expect(unbalanced.totalIn).toBe(grams(100));
      expect(unbalanced.totalOut).toBe(grams(101));
      expect(unbalanced.message).toContain('test:leaky');
      expect(unbalanced.message).toContain('el:C');
      expect(unbalanced.message).toContain('over-declared');
    }
  });

  it('rejects an under-declared output just as strictly', () => {
    const input = composition([['O', grams(50)]]);
    const underDeclaredOutput = composition([['O', grams(49)]]);

    const step: ProcessStep = {
      process: 'test:lossy',
      inputs: [{ account: 'in', composition: input }],
      outputs: [{ account: 'out', composition: underDeclaredOutput }],
    };

    expect(() => buildProcessPosting(step)).toThrow(/under-declared/);
  });

  it('rejects a mismatched energy declaration the same way it rejects mass', () => {
    const step: ProcessStep = {
      process: 'test:energy-leak',
      inputs: [],
      outputs: [],
      energyInputs: [{ account: 'utility', amount: 1_000n }],
      energyOutputs: [{ account: 'sink', amount: 999n }],
    };
    expect(() => buildProcessPosting(step)).toThrow(UnbalancedProcessError);
  });

  it('a balanced posting actually applies cleanly to a live ledger and keeps it in audit', () => {
    const ledger = new Ledger();
    ledger.openAccount({ id: 'in', kind: 'stock', label: 'input stock' });
    ledger.openAccount({ id: 'out', kind: 'stock', label: 'output stock' });
    ledger.openAccount({ id: 'loss', kind: 'reservoir', label: 'loss sink' });

    const input = composition([
      ['C', grams(60)],
      ['O', grams(40)],
    ]);
    // Seed the input stock from genesis first, exactly as any real content would.
    ledger.post({
      process: 'genesis:test',
      entries: [
        { account: 'in', commodity: 'el:C', delta: grams(60) },
        { account: 'genesis', commodity: 'el:C', delta: -grams(60) },
        { account: 'in', commodity: 'el:O', delta: grams(40) },
        { account: 'genesis', commodity: 'el:O', delta: -grams(40) },
      ],
    });

    const output = composition([
      ['C', grams(55)],
      ['O', grams(35)],
    ]);
    const loss = composition([
      ['C', grams(5)],
      ['O', grams(5)],
    ]);

    const posting = buildProcessPosting({
      process: 'test:ledger-round-trip',
      inputs: [{ account: 'in', composition: input }],
      outputs: [{ account: 'out', composition: output }],
      losses: [{ account: 'loss', composition: loss }],
    });

    ledger.post(posting);
    expect(ledger.balance('in', 'el:C')).toBe(0n);
    expect(ledger.balance('in', 'el:O')).toBe(0n);
    expect(ledger.balance('out', 'el:C')).toBe(grams(55));
    expect(ledger.balance('loss', 'el:C')).toBe(grams(5));
    expect(ledger.audit().ok).toBe(true);
  });

  it('encodes lot creations onto the posting note when declared, and leaves note alone otherwise', () => {
    const withLots = buildProcessPosting({
      process: 'test:lots',
      inputs: [],
      outputs: [],
      lots: {
        outputs: [{ substance: 'test-product', mass: grams(10), parents: [{ lotId: 'lot:1:0', mass: grams(10) }] }],
      },
    });
    expect(withLots.note).toContain('provenance:lots:v1');

    const withNote = buildProcessPosting({
      process: 'test:note',
      inputs: [],
      outputs: [],
      note: 'a plain diagnostic note',
    });
    expect(withNote.note).toBe('a plain diagnostic note');

    const withNeither = buildProcessPosting({ process: 'test:plain', inputs: [], outputs: [] });
    expect(withNeither.note).toBeUndefined();
  });
});

describe('splitByProfile', () => {
  it('always returns compositions that sum exactly back to the input, across a wide input range', () => {
    const rng = createSeededRng(20260817);
    const streamsA = [
      { id: 'rich-in-c', elements: { C: 800_000_000, O: 200_000_000 }, targetShare: 0.6 },
      { id: 'rich-in-o', elements: { C: 100_000_000, O: 900_000_000 }, targetShare: 0.4 },
    ];

    for (let trial = 0; trial < 200; trial += 1) {
      const massUg = BigInt(Math.floor(rng.next() * 1_000_000_000_000)) + 1n; // 1 ug .. ~1 tonne, never zero
      const input = composition([
        ['C', (massUg * 7n) / 10n],
        ['O', massUg - (massUg * 7n) / 10n],
      ]);
      const [streamA, streamB] = splitByProfile(input, streamsA) as [Composition, Composition];
      expect(totalOf(streamA) + totalOf(streamB)).toBe(totalOf(input));
      for (const element of ['C', 'O'] as const) {
        const a = streamA.get(element) ?? 0n;
        const b = streamB.get(element) ?? 0n;
        expect(a + b).toBe(input.get(element) ?? 0n);
      }
    }
  });

  it('splits proportionally more of an element toward the stream with a higher concentration of it', () => {
    const input = composition([['C', grams(1000)]]);
    const [rich, lean] = splitByProfile(input, [
      { id: 'rich', elements: { C: 900_000_000 }, targetShare: 0.5 },
      { id: 'lean', elements: { C: 100_000_000 }, targetShare: 0.5 },
    ]) as [Composition, Composition];
    expect(rich.get('C')! > lean.get('C')!).toBe(true);
    expect((rich.get('C') ?? 0n) + (lean.get('C') ?? 0n)).toBe(grams(1000));
  });

  it('handles an empty composition and zero streams gracefully', () => {
    const empty = composition([]);
    expect(splitByProfile(empty, [])).toEqual([]);
    const [only] = splitByProfile(empty, [{ id: 'only', elements: { C: 1 }, targetShare: 1 }]) as [Composition];
    expect(totalOf(only)).toBe(0n);
  });

  it('throws a clear error when an element in the input has zero weight across every stream', () => {
    const input = composition([['Fe', grams(1)]]);
    expect(() =>
      splitByProfile(input, [{ id: 'no-iron', elements: { C: 1_000_000 }, targetShare: 1 }]),
    ).toThrow(/Fe/);
  });
});

describe('ProcessUnit', () => {
  const definition: MachineDefinition = {
    type: 'test-unit',
    tags: [{ name: 'setpoint', unit: 'fraction', kind: 'setpoint', min: 0, max: 1, initial: 0.5 }],
    maintenanceIntervalHours: 100,
  };

  it('refuses a batch when the machine is not running', () => {
    const unit = new ProcessUnit({ id: 'u1', label: 'test unit', definition });
    expect(unit.canRun().ok).toBe(false);
    expect(() => unit.buildBatch({ process: 'noop', inputs: [], outputs: [] })).toThrow(/refused/);
  });

  it('refuses a batch when a declared interlock is not satisfied, and accepts once it is', () => {
    let charged = false;
    const unit = new ProcessUnit({
      id: 'u2',
      label: 'test unit',
      definition,
      interlocks: (machine) => [
        {
          id: 'charge',
          label: 'charge interlock',
          protects: 'hopper',
          conditions: [{ id: 'charged', description: 'hopper is empty', isSatisfied: () => charged }],
        },
      ],
    });
    unit.machine.commission();
    unit.machine.requestMode('MANUAL');

    expect(unit.canRun().ok).toBe(false);
    expect(() => unit.buildBatch({ process: 'noop', inputs: [], outputs: [] })).toThrow(/hopper is empty/);

    charged = true;
    expect(unit.canRun().ok).toBe(true);
    const posting = unit.buildBatch({ process: 'noop', inputs: [], outputs: [] });
    expect(posting.process).toBe('noop');
  });

  it('runs a batch once commissioned and in a running mode with no interlocks', () => {
    const unit = new ProcessUnit({ id: 'u3', label: 'test unit', definition });
    unit.machine.commission();
    unit.machine.requestMode('MANUAL');
    expect(unit.canRun().ok).toBe(true);
    const posting = unit.buildBatch({
      process: 'test:batch',
      inputs: [{ account: 'in', composition: composition([['C', grams(1)]]) }],
      outputs: [{ account: 'out', composition: composition([['C', grams(1)]]) }],
    });
    expect(posting.entries.length).toBe(2);
  });
});
