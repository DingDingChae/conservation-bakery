import { describe, expect, it } from 'vitest';
import { decodeLotCreations, deriveLotId, encodeLotCreations } from './lot.js';

describe('deriveLotId', () => {
  it('is deterministic and derived only from the posting seq and an index', () => {
    expect(deriveLotId(5, 0)).toBe('lot:5:0');
    expect(deriveLotId(5, 0)).toBe(deriveLotId(5, 0));
  });

  it('distinguishes different postings and different lots within one posting', () => {
    expect(deriveLotId(5, 0)).not.toBe(deriveLotId(6, 0));
    expect(deriveLotId(5, 0)).not.toBe(deriveLotId(5, 1));
  });
});

describe('encodeLotCreations / decodeLotCreations', () => {
  it('round-trips masses exactly, including values beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 123_456_789_012_345_678_901_234_567_890n;
    const note = encodeLotCreations([
      {
        substance: 'flour',
        mass: huge,
        parents: [{ lotId: 'lot:1:0', mass: huge }],
        losses: [{ reason: 'bran', mass: 7n }],
      },
    ]);

    const decoded = decodeLotCreations(note);
    expect(decoded).toHaveLength(1);
    const spec = decoded?.[0];
    expect(spec?.substance).toBe('flour');
    expect(spec?.mass).toBe(huge);
    expect(spec?.parents).toEqual([{ lotId: 'lot:1:0', mass: huge }]);
    expect(spec?.losses).toEqual([{ reason: 'bran', mass: 7n }]);
  });

  it('round-trips multiple lot creations from one posting, in order', () => {
    const note = encodeLotCreations([
      { substance: 'batter-a', mass: 450_000n, parents: [{ lotId: 'lot:3:0', mass: 450_000n }] },
      { substance: 'batter-b', mass: 300_000n, parents: [{ lotId: 'lot:3:0', mass: 300_000n }] },
    ]);

    const decoded = decodeLotCreations(note);
    expect(decoded).toHaveLength(2);
    expect(decoded?.[0]?.substance).toBe('batter-a');
    expect(decoded?.[1]?.substance).toBe('batter-b');
  });

  it('defaults losses to an empty array when omitted', () => {
    const note = encodeLotCreations([{ substance: 'wheat', mass: 1_000_000n, parents: [] }]);
    const decoded = decodeLotCreations(note);
    expect(decoded?.[0]?.losses).toEqual([]);
    expect(decoded?.[0]?.parents).toEqual([]);
  });

  it('returns undefined for a posting note with no lot-creation payload', () => {
    expect(decodeLotCreations(undefined)).toBeUndefined();
    expect(decodeLotCreations('burner drew 40kJ from the grid')).toBeUndefined();
    expect(decodeLotCreations('')).toBeUndefined();
  });
});
