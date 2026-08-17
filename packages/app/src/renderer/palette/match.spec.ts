import { describe, expect, it } from 'vitest';

import type { PaletteEntry } from '../context.js';

import { rankEntries } from './match.js';

function entry(id: string, label: string, keywords?: readonly string[]): PaletteEntry {
  return { id, label, group: 'Test', keywords, run: () => undefined };
}

describe('rankEntries — ranking order', () => {
  it('ranks an exact match first, then a prefix, then a word-boundary match, then any other substring match', () => {
    const entries = [
      entry('word-boundary', 'Open oven zone 1'),
      entry('prefix', 'Oven zone 1 setpoint'),
      entry('exact', 'oven'),
      // "oven" is present only inside "proven" here — no word boundary immediately
      // before it, so this must rank below every boundary/prefix/exact case above.
      entry('substring-only', 'proven results'),
    ];

    const ranked = rankEntries(entries, 'oven');
    const ids = ranked.map((e) => e.id);

    // The true substring-only case ("proven") must rank behind every boundary/prefix/exact case.
    expect(ids.indexOf('substring-only')).toBe(ids.length - 1);
    expect(ids[0]).toBe('exact');
    expect(ids.indexOf('prefix')).toBeLessThan(ids.indexOf('word-boundary'));
    expect(ids.indexOf('word-boundary')).toBeLessThan(ids.indexOf('substring-only'));
  });

  it('drops entries that do not match at all', () => {
    const entries = [entry('a', 'Open mixer line 2'), entry('b', 'Acknowledge alarms')];
    const ranked = rankEntries(entries, 'oven');
    expect(ranked).toEqual([]);
  });

  it('matches against keywords as well as the label', () => {
    const entries = [
      entry('a', 'Open faceplate', ['oven', 'thermal']),
      entry('b', 'Acknowledge alarms', ['reset']),
    ];
    const ranked = rankEntries(entries, 'oven');
    expect(ranked.map((e) => e.id)).toEqual(['a']);
  });

  it('takes the best rank across label and keywords, not the label alone', () => {
    // Label only contains "oven" as a substring-in-a-larger-word; the keyword is an
    // exact match. The entry should rank as an exact match, not a weak substring one.
    const weak = entry('weak', 'proven results', ['oven']);
    const other = entry('other', 'open oven zone', []);
    const ranked = rankEntries([weak, other], 'oven');
    expect(ranked[0]?.id).toBe('weak');
  });
});

describe('rankEntries — case handling', () => {
  it('is case-insensitive by default', () => {
    const entries = [entry('a', 'Open Oven Zone 1')];
    expect(rankEntries(entries, 'oven').map((e) => e.id)).toEqual(['a']);
    expect(rankEntries(entries, 'OVEN').map((e) => e.id)).toEqual(['a']);
  });

  it('is case-sensitive when requested', () => {
    const entries = [entry('a', 'Open Oven Zone 1')];
    expect(rankEntries(entries, 'oven', { caseSensitive: true })).toEqual([]);
    expect(rankEntries(entries, 'Oven', { caseSensitive: true }).map((e) => e.id)).toEqual(['a']);
  });
});

describe('rankEntries — stable, deterministic ordering', () => {
  it('breaks ties within the same rank by id', () => {
    const entries = [entry('zebra', 'oven'), entry('apple', 'oven'), entry('mango', 'oven')];
    const ranked = rankEntries(entries, 'oven');
    expect(ranked.map((e) => e.id)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('produces the identical order across repeated calls with unchanged input', () => {
    const entries = [
      entry('c', 'Open cooler'),
      entry('a', 'Open oven'),
      entry('b', 'Open mixer'),
    ];
    const first = rankEntries(entries, 'open').map((e) => e.id);
    const second = rankEntries(entries, 'open').map((e) => e.id);
    const third = rankEntries(entries, 'open').map((e) => e.id);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('never reorders between two identical searches even when input entry order varies but content does not', () => {
    const entries = [entry('a', 'Open oven'), entry('b', 'Open mixer')];
    const shuffled = [entries[1]!, entries[0]!];
    // Same underlying rank multiset (both are prefix matches for "open"), so the id
    // tie-break must produce the same order regardless of input array order.
    expect(rankEntries(entries, 'open').map((e) => e.id)).toEqual(
      rankEntries(shuffled, 'open').map((e) => e.id),
    );
  });
});

describe('rankEntries — empty query', () => {
  it('returns every entry (an empty string is a prefix of everything)', () => {
    const entries = [entry('a', 'Open oven'), entry('b', 'Open mixer')];
    expect(rankEntries(entries, '').map((e) => e.id).sort()).toEqual(['a', 'b']);
  });
});
