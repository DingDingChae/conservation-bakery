/**
 * The command palette's default search: plain text ranked against label and keywords.
 *
 * This is deliberately separate from `regex.ts`'s pattern builder. Most of the time a
 * player types a fragment of a word and expects the obviously-best match first; the
 * regex builder is the escape hatch for someone who wants to say precisely what they
 * mean. `rankEntries` never throws and never needs a backtracking guard — it does no
 * regex matching of the query itself, only fixed string operations.
 */

import type { PaletteEntry } from '../context.js';

import { escapeRegExpLiteral } from './regex.js';

/** Lower ranks first: an exact match beats a prefix match beats a match that starts at
 * a word boundary beats any other substring match. */
type MatchRank = 0 | 1 | 2 | 3;

interface RankedEntry {
  readonly entry: PaletteEntry;
  readonly rank: MatchRank;
}

/** Matches "the pattern begins at a word boundary somewhere in the string" without
 * requiring it to be a prefix (that case is already handled, and checked, first). */
function wordBoundaryMatch(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  return new RegExp(`\\b${escapeRegExpLiteral(needle)}`).test(haystack);
}

function classify(haystack: string, needle: string): MatchRank | null {
  if (haystack === needle) return 0;
  if (haystack.startsWith(needle)) return 1;
  if (wordBoundaryMatch(haystack, needle)) return 2;
  if (haystack.includes(needle)) return 3;
  return null;
}

function bestRank(entry: PaletteEntry, needle: string, caseSensitive: boolean): MatchRank | null {
  const normalize = (value: string): string => (caseSensitive ? value : value.toLowerCase());
  const normalizedNeedle = normalize(needle);
  const candidates = [entry.label, ...(entry.keywords ?? [])];

  let best: MatchRank | null = null;
  for (const candidate of candidates) {
    const rank = classify(normalize(candidate), normalizedNeedle);
    if (rank === null) continue;
    if (best === null || rank < best) best = rank;
    if (best === 0) break; // nothing beats an exact match
  }
  return best;
}

export interface MatchOptions {
  readonly caseSensitive?: boolean;
}

/**
 * Ranks palette entries against a plain-text query over label and keywords: exact match
 * first, then prefix, then a match starting at a word boundary, then any other substring
 * match. An entry that matches nothing is dropped. Ties within the same rank are broken
 * by id, so two searches that produce the identical rank multiset always come back in
 * the identical order — the list never reshuffles under an unchanged query, and a
 * player's arrow-key position stays meaningful.
 */
export function rankEntries(
  entries: readonly PaletteEntry[],
  query: string,
  options: MatchOptions = {},
): readonly PaletteEntry[] {
  const caseSensitive = options.caseSensitive ?? false;
  const ranked: RankedEntry[] = [];
  for (const entry of entries) {
    const rank = bestRank(entry, query, caseSensitive);
    if (rank === null) continue;
    ranked.push({ entry, rank });
  }
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
  });
  return ranked.map((item) => item.entry);
}
