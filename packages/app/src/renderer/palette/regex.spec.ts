import { describe, expect, it } from 'vitest';

import type { PaletteEntry } from '../context.js';

import { buildPattern, escapeRegExpLiteral, previewMatches } from './regex.js';

function entry(id: string, label: string, keywords?: readonly string[]): PaletteEntry {
  return { id, label, group: 'Test', keywords, run: () => undefined };
}

describe('escapeRegExpLiteral', () => {
  it('escapes every regex metacharacter so the result matches only the literal text', () => {
    const raw = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    const regex = new RegExp(`^${escapeRegExpLiteral(raw)}$`);
    expect(regex.test(raw)).toBe(true);
  });

  it('does not over-escape ordinary characters', () => {
    expect(escapeRegExpLiteral('oven zone 1')).toBe('oven zone 1');
  });
});

describe('buildPattern — mode semantics', () => {
  it('literal mode requires the whole string to match exactly', () => {
    const result = buildPattern('oven', { mode: 'literal', caseSensitive: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.regex.test('oven')).toBe(true);
    expect(result.regex.test('open oven')).toBe(false);
    expect(result.regex.test('oven zone 1')).toBe(false);
  });

  it('prefix mode matches only at the start of the string', () => {
    const result = buildPattern('oven', { mode: 'prefix', caseSensitive: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.regex.test('oven zone 1')).toBe(true);
    expect(result.regex.test('open oven')).toBe(false);
  });

  it('suffix mode matches only at the end of the string', () => {
    const result = buildPattern('zone 1', { mode: 'suffix', caseSensitive: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.regex.test('oven zone 1')).toBe(true);
    expect(result.regex.test('zone 1 oven')).toBe(false);
  });

  it('contains mode matches anywhere in the string', () => {
    const result = buildPattern('zone', { mode: 'contains', caseSensitive: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.regex.test('open oven zone 1')).toBe(true);
    expect(result.regex.test('mixer line 2')).toBe(false);
  });

  it('whole word mode requires a word boundary immediately before the match', () => {
    const result = buildPattern('oven', { mode: 'wholeWord', caseSensitive: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.regex.test('open oven zone 1')).toBe(true);
    // "oven" appears only as a substring of "proven", never at a word boundary.
    expect(result.regex.test('proven results')).toBe(false);
  });

  it('regex mode uses the raw pattern verbatim, including any anchors the caller wrote', () => {
    const result = buildPattern('^oven.*1$', { mode: 'regex', caseSensitive: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.regex.test('oven zone 1')).toBe(true);
    expect(result.regex.test('open oven zone 1')).toBe(false);
  });

  it('literal/prefix/suffix/contains/wholeWord treat the raw text as literal, never as regex syntax', () => {
    const result = buildPattern('oven (zone 1)', { mode: 'contains', caseSensitive: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.regex.test('the oven (zone 1) trend')).toBe(true);
    // If '(' and ')' were interpreted as a regex group instead of literal text, this
    // string (with the parens removed) would incorrectly match too.
    expect(result.regex.test('the oven zone 1 trend')).toBe(false);
  });
});

describe('buildPattern — case handling', () => {
  it('is case-insensitive by default across every mode', () => {
    for (const mode of ['literal', 'prefix', 'suffix', 'contains', 'wholeWord', 'regex'] as const) {
      const result = buildPattern('OVEN', { mode, caseSensitive: false });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.regex.test(mode === 'suffix' || mode === 'literal' ? 'oven' : 'oven zone')).toBe(true);
    }
  });

  it('is case-sensitive when requested', () => {
    const result = buildPattern('OVEN', { mode: 'contains', caseSensitive: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.regex.test('oven zone 1')).toBe(false);
    expect(result.regex.test('OVEN zone 1')).toBe(true);
  });
});

describe('buildPattern — invalid patterns', () => {
  it('reports a syntactically invalid raw regex as a failure, never throws', () => {
    expect(() => buildPattern('(unclosed', { mode: 'regex', caseSensitive: false })).not.toThrow();
    const result = buildPattern('(unclosed', { mode: 'regex', caseSensitive: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/invalid pattern/i);
  });

  it('an invalid raw regex mode failure never reaches a bare RegExp construction error type', () => {
    const result = buildPattern('[', { mode: 'regex', caseSensitive: false });
    expect(result.ok).toBe(false);
  });
});

describe('buildPattern — catastrophic backtracking guard', () => {
  it('rejects a classic catastrophic-backtracking pattern instead of hanging', () => {
    const result = buildPattern('(a+)+$', { mode: 'regex', caseSensitive: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/backtrack/i);
  }, 10_000);

  it('does not reject an ordinary, well-behaved pattern', () => {
    const result = buildPattern('^oven (zone [0-9]+)$', { mode: 'regex', caseSensitive: true });
    expect(result.ok).toBe(true);
  });

  it('does not reject well-behaved patterns produced by the non-regex modes', () => {
    for (const mode of ['literal', 'prefix', 'suffix', 'contains', 'wholeWord'] as const) {
      const result = buildPattern('a very ordinary search phrase', { mode, caseSensitive: false });
      expect(result.ok).toBe(true);
    }
  });
});

describe('previewMatches', () => {
  const entries: readonly PaletteEntry[] = [
    entry('b', 'Open mixer line 2', ['mixer']),
    entry('a', 'Open oven zone 1', ['oven', 'thermal']),
    entry('c', 'Acknowledge all alarms', []),
  ];

  it('matches on label or any keyword', () => {
    const built = buildPattern('thermal', { mode: 'contains', caseSensitive: false });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const matches = previewMatches(entries, built.regex);
    expect(matches.map((m) => m.id)).toEqual(['a']);
  });

  it('is sorted by id and stable across identical calls', () => {
    const built = buildPattern('open', { mode: 'contains', caseSensitive: false });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const first = previewMatches(entries, built.regex).map((m) => m.id);
    const second = previewMatches(entries, built.regex).map((m) => m.id);
    expect(first).toEqual(['a', 'b']);
    expect(second).toEqual(first);
  });

  it('returns an empty list, never throws, when nothing matches', () => {
    const built = buildPattern('nonexistent-thing', { mode: 'contains', caseSensitive: false });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(previewMatches(entries, built.regex)).toEqual([]);
  });
});
