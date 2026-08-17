import { describe, expect, it } from 'vitest';
import { checkGraphClosure, checkLotClosure } from './closure.js';
import { LotGraph } from './graph.js';
import { buildSyntheticChain } from './fixture.js';

describe('checkGraphClosure', () => {
  it('closes exactly at every node of a real chain with splits and merges', () => {
    const { graph } = buildSyntheticChain();
    const report = checkGraphClosure(graph);

    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    // 10 lots total; 2 are roots (wheat, sugar) and exempt from this check.
    expect(report.rootsSkipped).toBe(2);
    expect(report.lotsChecked).toBe(8);
  });

  it('exempts root lots (no parents) from the check, whatever their own mass', () => {
    const graph = new LotGraph();
    graph.addLot({
      id: 'lot:1:0',
      substance: 'wheat',
      mass: 1_000_000n,
      tick: 0,
      process: 'harvest',
      parents: [],
      losses: [],
    });
    expect(checkGraphClosure(graph)).toMatchObject({ ok: true, lotsChecked: 0, rootsSkipped: 1 });
  });

  it('catches a lot whose declared parent contributions do not account for its own mass', () => {
    const graph = new LotGraph();
    graph.addLot({
      id: 'lot:1:0',
      substance: 'wheat',
      mass: 1_000_000n,
      tick: 0,
      process: 'harvest',
      parents: [],
      losses: [],
    });
    // Broken on purpose: parent contributes 1,000,000 but the child claims to be
    // 950,000 with only 40,000 declared as lost — 10,000 has vanished unaccounted.
    graph.addLot({
      id: 'lot:2:0',
      substance: 'grain',
      mass: 950_000n,
      tick: 1,
      process: 'thresh',
      parents: [{ lotId: 'lot:1:0', mass: 1_000_000n }],
      losses: [{ reason: 'chaff', mass: 40_000n }],
    });

    const failure = checkLotClosure(graph.getLot('lot:2:0')!);
    expect(failure).toEqual({
      lotId: 'lot:2:0',
      parentTotal: 1_000_000n,
      ownMass: 950_000n,
      declaredLoss: 40_000n,
      discrepancy: 10_000n,
    });

    const report = checkGraphClosure(graph);
    expect(report.ok).toBe(false);
    expect(report.lotsChecked).toBe(1);
    expect(report.rootsSkipped).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.discrepancy).toBe(10_000n);
  });

  it('reports every failure, not just the first, across a broken graph', () => {
    const graph = new LotGraph();
    graph.addLot({
      id: 'root',
      substance: 'wheat',
      mass: 100n,
      tick: 0,
      process: 'harvest',
      parents: [],
      losses: [],
    });
    // Two independently broken children of the same root.
    graph.addLot({
      id: 'bad-1',
      substance: 'grain',
      mass: 90n,
      tick: 1,
      process: 'thresh',
      parents: [{ lotId: 'root', mass: 100n }],
      losses: [], // should have declared 10n of loss to close
    });
    graph.addLot({
      id: 'bad-2',
      substance: 'grain',
      mass: 100n,
      tick: 1,
      process: 'thresh',
      parents: [{ lotId: 'root', mass: 100n }],
      losses: [{ reason: 'chaff', mass: 5n }], // over-declared: claims more than it received
    });

    const report = checkGraphClosure(graph);
    expect(report.ok).toBe(false);
    expect(report.failures.map((f) => f.lotId).sort()).toEqual(['bad-1', 'bad-2']);
  });
});
