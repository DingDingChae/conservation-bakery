import { describe, expect, it } from 'vitest';
import { canonicalize, digest, fnv1a64 } from './digest.js';

describe('canonicalize', () => {
  it('sorts object keys regardless of insertion order', () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 });
    const b = canonicalize({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it('sorts Map keys the same way it sorts object keys', () => {
    const map = new Map<string, number>([
      ['z', 1],
      ['a', 2],
    ]);
    expect(canonicalize(map)).toBe('{"a":2,"z":1}');
  });

  it('marks bigint with an explicit prefix distinct from number and string', () => {
    expect(canonicalize(1n)).toBe('n:1');
    expect(canonicalize(1)).toBe('1');
    expect(canonicalize('1')).toBe('"1"');
    expect(canonicalize(1n)).not.toBe(canonicalize(1));
    expect(canonicalize(1)).not.toBe(canonicalize('1'));
  });

  it('canonicalizes negative bigints and large bigints exactly', () => {
    expect(canonicalize(-42n)).toBe('n:-42');
    expect(canonicalize(123456789012345678901234567890n)).toBe(
      'n:123456789012345678901234567890',
    );
  });

  it('treats -0 and 0 as the same canonical state', () => {
    expect(canonicalize(-0)).toBe(canonicalize(0));
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(RangeError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('canonicalizes nested structures deterministically', () => {
    const value = {
      accounts: new Map<string, bigint>([
        ['stockB', 5n],
        ['stockA', 10n],
      ]),
      tick: 42,
      tags: ['x', 'y'],
    };
    expect(canonicalize(value)).toBe(
      '{"accounts":{"stockA":n:10,"stockB":n:5},"tags":["x","y"],"tick":42}',
    );
  });
});

describe('fnv1a64', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1a64('hello')).toBe(fnv1a64('hello'));
  });

  it('differs for different input', () => {
    expect(fnv1a64('hello')).not.toBe(fnv1a64('world'));
  });

  it('matches the known FNV-1a 64-bit test vector for the empty string', () => {
    expect(fnv1a64('')).toBe(0xcbf29ce484222325n);
  });
});

describe('digest', () => {
  it('is a 16-character lowercase hex string', () => {
    const hash = digest({ a: 1n });
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is identical for structurally identical states built in different key order', () => {
    const a = digest({ tick: 1, balances: { x: 10n, y: 20n } });
    const b = digest({ balances: { y: 20n, x: 10n }, tick: 1 });
    expect(a).toBe(b);
  });

  it('differs when a conserved amount differs', () => {
    const a = digest({ tick: 1, balances: { x: 10n } });
    const b = digest({ tick: 1, balances: { x: 11n } });
    expect(a).not.toBe(b);
  });

  it('differs between a bigint and a number that print the same digits', () => {
    expect(digest(1n)).not.toBe(digest(1));
  });
});
