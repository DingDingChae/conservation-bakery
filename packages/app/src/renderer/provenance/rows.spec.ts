import { describe, expect, it } from 'vitest';
import type { ProvenanceNode } from '../../shared/ipc.js';
import {
  anyRowTruncated,
  flattenProvenanceTree,
  formatMicrogramsAsGrams,
  isWorldRootSubstance,
} from './rows.js';

function node(partial: Partial<ProvenanceNode> & Pick<ProvenanceNode, 'lotId' | 'substanceId'>): ProvenanceNode {
  return {
    label: partial.substanceId,
    mass: '0',
    tick: 0,
    process: 'test',
    children: [],
    ...partial,
  };
}

describe('flattenProvenanceTree', () => {
  it('flattens a single leaf lot into exactly one row at depth 0 with no parent', () => {
    const tree = node({ lotId: 'lot:1:0', substanceId: 'atmosphere', label: 'Atmosphere', mass: '500000', tick: 3, process: 'genesis' });
    const rows = flattenProvenanceTree(tree);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      index: 0,
      parentIndex: null,
      childIndices: [],
      depth: 0,
      lotId: 'lot:1:0',
      substanceId: 'atmosphere',
      label: 'Atmosphere',
      mass: '500000',
      tick: 3,
      process: 'genesis',
      hasChildren: false,
      truncated: false,
      rootKind: 'world',
    });
  });

  it('orders a multi-level tree pre-order: parent immediately before its own children', () => {
    // cake
    //  |- flour
    //  |   |- wheat-grain
    //  |       |- atmosphere (root)
    //  |       |- soil.wheat-field (root)
    //  |- sucrose
    //      |- sugar-beet
    //          |- market.suppliers (root)
    const tree = node({
      lotId: 'lot:cake',
      substanceId: 'baked-cake',
      children: [
        node({
          lotId: 'lot:flour',
          substanceId: 'wheat-flour-white',
          children: [
            node({
              lotId: 'lot:grain',
              substanceId: 'wheat-grain',
              children: [
                node({ lotId: 'root:atmosphere', substanceId: 'atmosphere' }),
                node({ lotId: 'root:soil', substanceId: 'soil.wheat-field' }),
              ],
            }),
          ],
        }),
        node({
          lotId: 'lot:sucrose',
          substanceId: 'sucrose',
          children: [
            node({
              lotId: 'lot:beet',
              substanceId: 'sugar-beet',
              children: [node({ lotId: 'root:supplier', substanceId: 'market.suppliers' })],
            }),
          ],
        }),
      ],
    });

    const rows = flattenProvenanceTree(tree);

    expect(rows.map((r) => r.lotId)).toEqual([
      'lot:cake',
      'lot:flour',
      'lot:grain',
      'root:atmosphere',
      'root:soil',
      'lot:sucrose',
      'lot:beet',
      'root:supplier',
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 3, 3, 1, 2, 3]);
  });

  it('gives every row a correct index, parentIndex and childIndices addressed by index, not reference', () => {
    const tree = node({
      lotId: 'lot:cake',
      substanceId: 'baked-cake',
      children: [
        node({ lotId: 'lot:flour', substanceId: 'wheat-flour-white' }),
        node({ lotId: 'lot:butter', substanceId: 'butter' }),
      ],
    });
    const rows = flattenProvenanceTree(tree);
    const byId = new Map(rows.map((r) => [r.lotId, r]));

    const cake = byId.get('lot:cake');
    const flour = byId.get('lot:flour');
    const butter = byId.get('lot:butter');
    expect(cake?.index).toBe(0);
    expect(cake?.childIndices).toEqual([flour?.index, butter?.index]);
    expect(flour?.parentIndex).toBe(cake?.index);
    expect(butter?.parentIndex).toBe(cake?.index);
    expect(flour?.hasChildren).toBe(false);
    expect(cake?.hasChildren).toBe(true);
  });

  it('flags a node truncated by the walk without pretending it is a reached root', () => {
    const tree = node({
      lotId: 'lot:cake',
      substanceId: 'baked-cake',
      children: [node({ lotId: 'lot:deep', substanceId: 'some-intermediate', truncated: true })],
    });
    const rows = flattenProvenanceTree(tree);
    const truncatedRow = rows.find((r) => r.lotId === 'lot:deep');

    expect(truncatedRow?.truncated).toBe(true);
    expect(truncatedRow?.hasChildren).toBe(false);
    // A truncated leaf is NOT a rootKind — the walk stopped here, it did not conclude
    // this lot has no ancestry. Silently reading it as a reached root would let a
    // capped tree pass for a complete one, which is the one thing this screen must
    // never do.
    expect(truncatedRow?.rootKind).toBeUndefined();
    expect(anyRowTruncated(rows)).toBe(true);
  });

  it('reports anyRowTruncated false when no node in the tree was capped', () => {
    const tree = node({
      lotId: 'lot:cake',
      substanceId: 'baked-cake',
      children: [node({ lotId: 'root:atmosphere', substanceId: 'atmosphere' })],
    });
    expect(anyRowTruncated(flattenProvenanceTree(tree))).toBe(false);
  });

  it('classifies a market-delivered root as "market", distinct from a world reservoir root', () => {
    const tree = node({
      lotId: 'lot:cardboard-pack',
      substanceId: 'palletised-cake',
      children: [node({ lotId: 'root:cardboard', substanceId: 'market.suppliers' })],
    });
    const rows = flattenProvenanceTree(tree);
    expect(rows[1]?.rootKind).toBe('market');
  });

  it('classifies every named world reservoir — atmosphere, soil, groundwater, sun — as a world root', () => {
    for (const substanceId of ['atmosphere', 'soil.wheat-field', 'groundwater', 'sun', 'surface-water']) {
      const tree = node({ lotId: `root:${substanceId}`, substanceId });
      const [row] = flattenProvenanceTree(tree);
      expect(row?.rootKind, substanceId).toBe('world');
      expect(isWorldRootSubstance(substanceId)).toBe(true);
    }
  });

  it('classifies an ordinary intermediate lot with no children and no truncation as "other", not silently as a world root', () => {
    const tree = node({ lotId: 'lot:mystery', substanceId: 'some-unlabelled-thing' });
    const [row] = flattenProvenanceTree(tree);
    expect(row?.rootKind).toBe('other');
  });

  it('preserves a merge: the same parent contributing to two different children keeps two independent rows', () => {
    // The lot GRAPH dedupes a shared ancestor by lotId; a rendered TREE (what the
    // wire actually sends) may legitimately repeat a node once per path to it. This
    // function must not silently collapse that repetition, since each occurrence
    // carries its own depth and its own parent context in the tree the user sees.
    const shared = node({ lotId: 'root:water', substanceId: 'groundwater' });
    const tree = node({
      lotId: 'lot:batter',
      substanceId: 'cake-batter',
      children: [
        node({ lotId: 'lot:flour', substanceId: 'wheat-flour-white', children: [shared] }),
        node({ lotId: 'lot:egg', substanceId: 'hen-egg-whole', children: [shared] }),
      ],
    });
    const rows = flattenProvenanceTree(tree);
    const waterRows = rows.filter((r) => r.lotId === 'root:water');
    expect(waterRows).toHaveLength(2);
    expect(waterRows[0]?.index).not.toBe(waterRows[1]?.index);
    expect(waterRows[0]?.parentIndex).not.toBe(waterRows[1]?.parentIndex);
  });
});

describe('formatMicrogramsAsGrams', () => {
  it('formats an exact whole-gram value with no trailing decimal', () => {
    expect(formatMicrogramsAsGrams('1000000')).toBe('1');
    expect(formatMicrogramsAsGrams('2000000')).toBe('2');
  });

  it('formats a sub-gram value with leading zero preserved', () => {
    expect(formatMicrogramsAsGrams('500000')).toBe('0.5');
    expect(formatMicrogramsAsGrams('1')).toBe('0.000001');
  });

  it('formats zero exactly', () => {
    expect(formatMicrogramsAsGrams('0')).toBe('0');
  });

  it('preserves every significant digit of a value with a non-terminating fractional part', () => {
    expect(formatMicrogramsAsGrams('1234567')).toBe('1.234567');
    expect(formatMicrogramsAsGrams('100000001')).toBe('100.000001');
  });

  it('is exact for a value far beyond Number.MAX_SAFE_INTEGER — no precision lost to a float', () => {
    // 2^53 - 1 is Number.MAX_SAFE_INTEGER; this value is deliberately larger, and by
    // three more orders of magnitude, so a bug that routed through Number would be
    // caught even after JS's usual silent float rounding.
    const huge = '9007199254740993000000';
    const formatted = formatMicrogramsAsGrams(huge);
    // Reconstruct the microgram string from the formatted grams string by pure
    // string surgery (undoing the decimal shift), and compare to the original —
    // this is exactness, not an approximate match.
    const [whole, fraction = ''] = formatted.split('.');
    const reconstructed = `${whole}${fraction.padEnd(6, '0')}`;
    expect(BigInt(reconstructed)).toBe(BigInt(huge));
  });

  it('handles a negative value (should not occur for a real mass, but must not crash or mis-sign)', () => {
    expect(formatMicrogramsAsGrams('-500000')).toBe('-0.5');
    expect(formatMicrogramsAsGrams('-0')).toBe('0');
  });
});
