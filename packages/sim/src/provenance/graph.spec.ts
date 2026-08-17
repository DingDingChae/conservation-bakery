import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { DuplicateLotError, LotGraph, UnknownLotError, UnknownParentLotError } from './graph.js';
import { buildSyntheticChain } from './fixture.js';

describe('LotGraph.consume', () => {
  it('ignores postings that carry no lot-creation payload', () => {
    const graph = new LotGraph();
    const ledger = new Ledger({ onPosting: graph.consume });
    ledger.openAccount({ id: 'grid', kind: 'external', label: 'grid' });
    ledger.openAccount({ id: 'oven', kind: 'stock', label: 'oven' });

    ledger.post({
      process: 'preheat',
      entries: [
        { account: 'grid', commodity: 'energy:uJ', delta: -5n },
        { account: 'oven', commodity: 'energy:uJ', delta: 5n },
      ],
    });

    expect(graph.size).toBe(0);
  });

  it('derives lot ids from the posting seq and creation index, matching deriveLotId', () => {
    const { graph, ids } = buildSyntheticChain();
    // The first posting in the fixture (harvest) is seq 1, single lot -> index 0.
    expect(ids.wheat).toBe('lot:1:0');
    // split-batch is the fourth posting (seq 4) and creates two lots.
    expect(ids.batterA).toBe('lot:4:0');
    expect(ids.batterB).toBe('lot:4:1');
    expect(graph.hasLot(ids.batterA)).toBe(true);
    expect(graph.hasLot(ids.batterB)).toBe(true);
  });
});

describe('LotGraph.addLot', () => {
  it('rejects a duplicate lot id', () => {
    const graph = new LotGraph();
    const lot = {
      id: 'lot:1:0',
      substance: 'wheat',
      mass: 1_000_000n,
      tick: 0,
      process: 'harvest',
      parents: [],
      losses: [],
    };
    graph.addLot(lot);
    expect(() => graph.addLot(lot)).toThrow(DuplicateLotError);
  });

  it('rejects a lot whose declared parent has not been added yet', () => {
    const graph = new LotGraph();
    expect(() =>
      graph.addLot({
        id: 'lot:2:0',
        substance: 'grain',
        mass: 900_000n,
        tick: 0,
        process: 'thresh',
        parents: [{ lotId: 'lot:1:0', mass: 900_000n }],
        losses: [],
      }),
    ).toThrow(UnknownParentLotError);
  });
});

describe('LotGraph.ancestors', () => {
  it('walks a finished lot back to every root, with exact contributed mass per hop', () => {
    const { graph, ids } = buildSyntheticChain();
    const result = graph.ancestors(ids.cake);

    expect(result.truncated).toBe(false);
    expect(result.truncatedAt).toEqual([]);
    expect(new Set(result.roots)).toEqual(new Set([ids.wheat, ids.sugar]));
    // Every lot in this single connected chain is an ancestor of the finished cake.
    expect(result.lots.size).toBe(graph.size);

    const massOf = (parent: string, child: string): bigint | undefined =>
      result.edges.find((e) => e.parent === parent && e.child === child)?.mass;

    expect(massOf(ids.bakedA, ids.cake)).toBe(400_000n);
    expect(massOf(ids.bakedBlend, ids.cake)).toBe(360_000n);
    expect(massOf(ids.batterB, ids.blended)).toBe(300_000n);
    expect(massOf(ids.sugar, ids.blended)).toBe(100_000n);
    expect(massOf(ids.wheat, ids.grain)).toBe(1_000_000n);
  });

  it('reports honest truncation, not a silent cut, when maxDepth is exceeded', () => {
    const { graph, ids } = buildSyntheticChain();
    const result = graph.ancestors(ids.cake, { maxDepth: 1 });

    expect(result.truncated).toBe(true);
    expect(new Set(result.truncatedAt)).toEqual(new Set([ids.bakedA, ids.bakedBlend]));
    expect(result.roots).toEqual([]);
    expect(result.lots.size).toBe(3); // cake + its two immediate parents, no further
  });

  it('reports honest truncation, not a silent cut, when maxLots is exceeded', () => {
    const { graph, ids } = buildSyntheticChain();
    const result = graph.ancestors(ids.cake, { maxLots: 2 });

    expect(result.truncated).toBe(true);
    expect(result.truncatedAt.length).toBeGreaterThan(0);
    expect(result.lots.size).toBeLessThanOrEqual(2);
  });

  it('throws for a lot id the graph has never seen', () => {
    const { graph } = buildSyntheticChain();
    expect(() => graph.ancestors('lot:does-not-exist:0')).toThrow(UnknownLotError);
  });

  it('a root lot has itself as its only ancestor result and no roots beyond it', () => {
    const { graph, ids } = buildSyntheticChain();
    const result = graph.ancestors(ids.wheat);
    expect(result.lots.size).toBe(1);
    expect(result.roots).toEqual([ids.wheat]);
    expect(result.edges).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe('LotGraph.descendants', () => {
  it('walks a root forward to every lot it ever contributed to', () => {
    const { graph, ids } = buildSyntheticChain();
    const result = graph.descendants(ids.wheat);

    expect(result.truncated).toBe(false);
    expect(result.leaves).toEqual([ids.cake]);
    // wheat reaches everything except sugar, which enters the chain independently.
    expect(result.lots.size).toBe(graph.size - 1);
    expect(result.lots.has(ids.sugar)).toBe(false);

    const massOf = (parent: string, child: string): bigint | undefined =>
      result.edges.find((e) => e.parent === parent && e.child === child)?.mass;
    expect(massOf(ids.wheat, ids.grain)).toBe(1_000_000n);
    expect(massOf(ids.bakedA, ids.cake)).toBe(400_000n);
  });

  it('a leaf lot has itself as its only descendant result', () => {
    const { graph, ids } = buildSyntheticChain();
    const result = graph.descendants(ids.cake);
    expect(result.lots.size).toBe(1);
    expect(result.leaves).toEqual([ids.cake]);
    expect(result.truncated).toBe(false);
  });
});
