/**
 * The anchored regex builder that sits beside the command palette's plain-text search.
 *
 * A raw text field turned directly into a `RegExp` is two hazards at once: a syntax
 * error the caller must not let become an uncaught throw, and a pattern shaped for
 * catastrophic backtracking (nested quantifiers such as `(a+)+$`) that can hang the
 * window for as long as its input is long. `buildPattern` never throws — every failure,
 * syntactic or performance, comes back as a `PatternFailure` with a reason the palette
 * can show verbatim.
 */

import type { PaletteEntry } from '../context.js';

/**
 * literal — the whole string must equal the pattern exactly.
 * prefix — the string must start with the pattern.
 * suffix — the string must end with the pattern.
 * contains — the pattern may appear anywhere.
 * wholeWord — the pattern must appear with a word boundary immediately before it.
 * regex — the pattern is used as-is; the caller supplies their own anchors and syntax.
 */
export type PatternMode = 'literal' | 'prefix' | 'suffix' | 'contains' | 'wholeWord' | 'regex';

export interface PatternOptions {
  readonly mode: PatternMode;
  readonly caseSensitive: boolean;
}

export interface PatternSuccess {
  readonly ok: true;
  readonly regex: RegExp;
}

export interface PatternFailure {
  readonly ok: false;
  readonly reason: string;
}

export type PatternResult = PatternSuccess | PatternFailure;

/** Escapes every regex metacharacter so a literal/prefix/suffix/contains/wholeWord
 * pattern can never accidentally be interpreted as regex syntax. */
export function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceFor(raw: string, mode: PatternMode): string {
  switch (mode) {
    case 'literal':
      return `^${escapeRegExpLiteral(raw)}$`;
    case 'prefix':
      return `^${escapeRegExpLiteral(raw)}`;
    case 'suffix':
      return `${escapeRegExpLiteral(raw)}$`;
    case 'contains':
      return escapeRegExpLiteral(raw);
    case 'wholeWord':
      return `\\b${escapeRegExpLiteral(raw)}\\b`;
    case 'regex':
      return raw;
  }
}

/**
 * A fixed-length probe shaped to blow up the classic catastrophic-backtracking pattern
 * families (nested quantifiers over one repeated character, e.g. `(a+)+$`, `(a|a)+$`)
 * while staying short enough that any well-behaved pattern resolves in well under a
 * millisecond. It is never shown to the caller and never matched against real palette
 * content — its only job is to time-box a pattern before it ever touches the entry list.
 *
 * The exact length matters: long enough that a genuinely catastrophic pattern blows
 * budget with a comfortable margin whether the engine is running the pattern cold (first
 * time, ~450ms measured for the length below) or warm (steady-state repeated typing,
 * ~45ms measured) — and short enough that the worst case is a sub-second stall rather
 * than the many-second-to-unbounded one this guard exists to prevent.
 */
const BACKTRACK_PROBE = `${'a'.repeat(22)}!`;

/** If the probe alone takes longer than this, the same pattern run against real content
 * of arbitrary length would visibly hang the window. Reject it instead of ever running
 * it for real. Comfortably below the measured warm-state cost of a catastrophic pattern
 * against the probe above, and comfortably above any well-behaved pattern (sub-
 * millisecond), so neither state produces a false result. */
const BACKTRACK_BUDGET_MS = 20;

function tookTooLong(regex: RegExp): boolean {
  const start = performance.now();
  try {
    regex.test(BACKTRACK_PROBE);
  } catch {
    // A probe that throws outright (e.g. a stack overflow on some engines) isn't a
    // timing problem; let the caller find out when the pattern actually runs rather
    // than mask it here as a manufactured timeout.
  }
  return performance.now() - start > BACKTRACK_BUDGET_MS;
}

/**
 * Builds a `RegExp` for one of the six modes above. Returns a `PatternFailure` — never
 * throws — for a syntactically invalid pattern (an unbalanced group, for example) or for
 * one that fails the backtracking-time budget.
 */
export function buildPattern(raw: string, options: PatternOptions): PatternResult {
  const source = sourceFor(raw, options.mode);
  let regex: RegExp;
  try {
    regex = new RegExp(source, options.caseSensitive ? '' : 'i');
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid pattern: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (tookTooLong(regex)) {
    return {
      ok: false,
      reason: 'Pattern rejected: it did not resolve on a probe string in time (likely catastrophic backtracking).',
    };
  }
  return { ok: true, regex };
}

function entryMatchesPattern(entry: PaletteEntry, regex: RegExp): boolean {
  if (regex.test(entry.label)) return true;
  return (entry.keywords ?? []).some((keyword) => regex.test(keyword));
}

/**
 * The regex builder's live preview: what a built pattern currently matches among the
 * palette's live entries, so a pattern's effect is visible before it is used to filter
 * anything for real. Sorted by id — not by relevance, the builder has no notion of
 * relevance beyond "matches" — so the preview never reshuffles between two keystrokes
 * that produce the identical match set.
 */
export function previewMatches(
  entries: readonly PaletteEntry[],
  regex: RegExp,
): readonly PaletteEntry[] {
  return entries
    .filter((entry) => entryMatchesPattern(entry, regex))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
