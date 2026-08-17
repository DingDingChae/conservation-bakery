import { describe, expect, it } from 'vitest';
import {
  exportGraphToCsv,
  exportGraphToJson,
  exportTreeToCsv,
  exportTreeToJson,
  serialiseLot,
} from './export.js';
import { buildSyntheticChain } from './fixture.js';

describe('serialiseLot', () => {
  it('carries mass as a decimal string exact beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 9_007_199_254_740_993_000_000n; // well past 2^53, would lose precision as a Number
    const serialised = serialiseLot({
      id: 'lot:1:0',
      substance: 'wheat',
      mass: huge,
      tick: 0,
      process: 'harvest',
      parents: [],
      losses: [],
    });
    expect(serialised.mass).toBe(huge.toString());
    expect(BigInt(serialised.mass)).toBe(huge);
  });
});

describe('exportGraphToJson / exportGraphToCsv', () => {
  it('round-trips every lot mass in the chain exactly through JSON', () => {
    const { graph, ids } = buildSyntheticChain();
    const parsed = JSON.parse(exportGraphToJson(graph)) as Array<{
      id: string;
      mass: string;
      parents: Array<{ lotId: string; mass: string }>;
    }>;

    expect(parsed).toHaveLength(graph.size);
    for (const lot of graph.lots()) {
      const found = parsed.find((p) => p.id === lot.id);
      expect(found).toBeDefined();
      expect(BigInt(found?.mass ?? '0')).toBe(lot.mass);
      expect(found?.parents).toHaveLength(lot.parents.length);
    }

    const cake = parsed.find((p) => p.id === ids.cake);
    expect(BigInt(cake?.mass ?? '0')).toBe(740_000n);
  });

  it('writes one CSV row per lot plus a header, with parent masses exact', () => {
    const { graph, ids } = buildSyntheticChain();
    const csv = exportGraphToCsv(graph);
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe('id,substance,mass_ug,tick,process,parents,losses');
    expect(lines).toHaveLength(graph.size + 1);

    const cakeLine = lines.find((line) => line.startsWith(`${ids.cake},`));
    expect(cakeLine).toContain('740000');
    expect(cakeLine).toContain(`${ids.bakedA}:400000`);
    expect(cakeLine).toContain(`${ids.bakedBlend}:360000`);
    expect(cakeLine).toContain('trim:20000');
  });
});

describe('exportTreeToJson / exportTreeToCsv', () => {
  it('serialises an ancestors() walk with roots, honest truncation, and exact edge masses', () => {
    const { graph, ids } = buildSyntheticChain();
    const result = graph.ancestors(ids.cake);
    const parsed = JSON.parse(exportTreeToJson(result)) as {
      lots: unknown[];
      edges: Array<{ parent: string; child: string; mass: string }>;
      truncated: boolean;
      roots: string[];
    };

    expect(parsed.truncated).toBe(false);
    expect(new Set(parsed.roots)).toEqual(new Set([ids.wheat, ids.sugar]));
    expect(parsed.lots).toHaveLength(result.lots.size);

    const edge = parsed.edges.find((e) => e.parent === ids.sugar && e.child === ids.blended);
    expect(edge).toBeDefined();
    expect(BigInt(edge?.mass ?? '0')).toBe(100_000n);
  });

  it('serialises a descendants() walk with leaves instead of roots', () => {
    const { graph, ids } = buildSyntheticChain();
    const result = graph.descendants(ids.wheat);
    const parsed = JSON.parse(exportTreeToJson(result)) as { leaves: string[] };
    expect(parsed.leaves).toEqual([ids.cake]);
  });

  it('writes one CSV edge row per hop, decimal-exact', () => {
    const { graph, ids } = buildSyntheticChain();
    const result = graph.ancestors(ids.cake);
    const csv = exportTreeToCsv(result);
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe('parent,child,mass_ug');
    expect(lines).toHaveLength(result.edges.length + 1);
    expect(lines).toContain(`${ids.sugar},${ids.blended},100000`);
  });
});
