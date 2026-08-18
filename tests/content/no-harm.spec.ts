/**
 * The build-failing content gate for CONTRACT.md rule 2.
 *
 * This walks the whole repository — every source file, data file and document —
 * and fails the build if any file contains a word or phrase from `denylist.ts`.
 * See CONTRACT.md's second governing rule, whose "How it is enforced" section
 * names this file by path.
 *
 * Only node builtins are used here, deliberately: this gate must never depend on
 * a package that could itself go missing or be swapped for something that stops
 * enforcing the rule.
 *
 * ## Two mechanisms that keep the gate from producing false positives
 *
 * 1. **Declaration blocks.** A document that states rule 2 (this repository's
 *    contract, its agent instructions, its README) is required to name the very
 *    terms it forbids, in order to forbid them. Such a passage can be wrapped in
 *    a marker pair, on lines by themselves:
 *
 *        <!-- rule2:allow-declaration -->
 *        ...the passage that must state the forbidden terms...
 *        <!-- /rule2:allow-declaration -->
 *
 *    or, in TypeScript/JavaScript:
 *
 *        /* rule2:allow-declaration *\/
 *        ...passage...
 *        /* /rule2:allow-declaration *\/
 *
 *    Lines inside a marked block are not scanned. Every block skipped this way is
 *    counted (`SweepResult.skippedBlocks`); see the test below that pins the
 *    repository-wide total to an exact constant, so a new block can never be
 *    added silently to smuggle a real term past the gate. A marker that opens
 *    without closing (unterminated), or opens a second time before the first is
 *    closed (nested), is a bug in the document, not a case to be forgiven — the
 *    sweep throws rather than skips.
 *
 * 2. **Denylist tiers.** `denylist.ts` splits its patterns into Tier A (always
 *    denied — no legitimate use exists) and Tier B, whose entries are only
 *    denied when a word naming a plant employee, visitor or similar appears
 *    close by. Tier B exists because some of its words have a genuine
 *    equipment, chemistry or ordinary-English sense this project's content
 *    legitimately needs (the burner tripped, glucose burned during
 *    respiration, a reading changed by chance during rounding) as well as the
 *    sense rule 2 actually targets. See `hasNearbyPersonReferent` below for
 *    exactly how "close by" is defined.
 */

import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DENYLIST, PERSON_REFERENT_PATTERN } from './denylist.js';

/** One match of one denylist pattern against one line of one file. */
export interface DenyMatch {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly match: string;
  readonly snippet: string;
}

/** The outcome of sweeping a directory tree. */
export interface SweepResult {
  readonly matches: DenyMatch[];
  /** Total number of well-formed rule2:allow-declaration blocks skipped. */
  readonly skippedBlocks: number;
}

/**
 * File extensions this gate reads as text. Everything else (images, fonts,
 * binaries, lockfiles' surrounding tarballs, etc.) is skipped: rule 2 is about
 * content a person could read or hear, not about opaque binary payloads.
 */
const SCAN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.html',
  '.css',
  '.yml',
  '.yaml',
  '.txt',
  '.csv',
]);

/**
 * Directories that are never product content and are never walked into.
 *
 * `release` and `out` hold packaging output. That output embeds a whole Chromium runtime,
 * including its third-party licence manifest, which legitimately contains words this
 * sweep denies — in licence text written by other people, not in anything this product
 * says. Scanning it made a local package build turn the gate red for a reason that had
 * nothing to do with the product's own content.
 *
 * This narrows *where* the rule is enforced, never *what* it forbids: every authored file
 * is still swept, including `packages/app/build`, which holds real installer resources we
 * write ourselves and is deliberately absent from this list.
 */
const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.git',
  'release',
  'out',
  'coverage',
]);

/**
 * How close a Tier B match and a person-referent word must be, in characters,
 * for the match to be reported. A bounded character window is used rather than
 * "same sentence": the sweep already operates one source line at a time, and
 * many of the lines it reads are code, table rows or list bullets with no
 * sentence-ending punctuation to key off. A fixed window is simpler, does not
 * depend on prose punctuation, and is still tight enough that it will not
 * casually reach across an unrelated clause in a long line.
 */
const PROXIMITY_WINDOW_CHARS = 40;

/** Marker lines, matched against a line with only surrounding whitespace allowed. */
const BLOCK_START =
  /^\s*(?:<!--\s*rule2:allow-declaration\s*-->|\/\*\s*rule2:allow-declaration\s*\*\/)\s*$/;
const BLOCK_END =
  /^\s*(?:<!--\s*\/rule2:allow-declaration\s*-->|\/\*\s*\/rule2:allow-declaration\s*\*\/)\s*$/;

/**
 * True if a person-referent word (see `PERSON_REFERENT_PATTERN`) appears within
 * `PROXIMITY_WINDOW_CHARS` characters of a match, on the same line.
 */
function hasNearbyPersonReferent(lineText: string, matchIndex: number, matchLength: number): boolean {
  const start = Math.max(0, matchIndex - PROXIMITY_WINDOW_CHARS);
  const end = Math.min(lineText.length, matchIndex + matchLength + PROXIMITY_WINDOW_CHARS);
  return PERSON_REFERENT_PATTERN.test(lineText.slice(start, end));
}

/**
 * Recursively read every scannable file under `rootDir` and report every line
 * that matches any denylist pattern for its tier's rules, skipping lines inside
 * a well-formed `rule2:allow-declaration` block.
 *
 * `excludedFiles` lets a caller exempt specific files by absolute or relative
 * path — used here to exempt `denylist.ts` itself, which must be able to name
 * the words it guards against in its own comments. See the note at the top of
 * that file.
 *
 * Throws if any file contains an unterminated or nested declaration block, or a
 * stray end marker with no matching start — a malformed marker is a bug in the
 * document and must fail the build, not be silently tolerated.
 */
export function sweep(rootDir: string, excludedFiles: readonly string[] = []): SweepResult {
  const excluded = new Set(excludedFiles.map((file) => resolve(file)));
  const matches: DenyMatch[] = [];
  let skippedBlocks = 0;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (excluded.has(resolve(full))) continue;
      if (!SCAN_EXTENSIONS.has(extname(entry.name))) continue;

      const content = readFileSync(full, 'utf8');
      const lines = content.split('\n');

      let inBlock = false;
      let blockStartLine = -1;

      lines.forEach((lineText, lineIndex) => {
        const lineNo = lineIndex + 1;

        if (BLOCK_START.test(lineText)) {
          if (inBlock) {
            throw new Error(
              `${full}:${lineNo}: nested rule2:allow-declaration marker — the block ` +
                `opened at line ${blockStartLine} was never closed before this one opened`,
            );
          }
          inBlock = true;
          blockStartLine = lineNo;
          skippedBlocks += 1;
          return;
        }

        if (BLOCK_END.test(lineText)) {
          if (!inBlock) {
            throw new Error(
              `${full}:${lineNo}: rule2:allow-declaration end marker with no matching start`,
            );
          }
          inBlock = false;
          blockStartLine = -1;
          return;
        }

        if (inBlock) return;

        for (const { pattern, tier } of DENYLIST) {
          // Force the global flag so `exec` walks every occurrence in the line
          // rather than stopping at the first, without mutating the shared
          // pattern object (a fresh RegExp is built per scan).
          const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
          const withGlobal = new RegExp(pattern.source, flags);
          let found: RegExpExecArray | null;
          while ((found = withGlobal.exec(lineText)) !== null) {
            const shouldReport =
              tier === 'A' || hasNearbyPersonReferent(lineText, found.index, found[0].length);
            if (shouldReport) {
              matches.push({
                file: full,
                line: lineNo,
                column: found.index + 1,
                match: found[0],
                snippet: lineText.trim(),
              });
            }
            // A zero-length match (should not occur with these patterns, but is
            // possible in principle) would otherwise spin `exec` forever at the
            // same index.
            if (found[0].length === 0) withGlobal.lastIndex += 1;
          }
        }
      });

      if (inBlock) {
        throw new Error(
          `${full}: unterminated rule2:allow-declaration block — opened at line ` +
            `${blockStartLine} and never closed`,
        );
      }
    }
  };

  walk(rootDir);
  return { matches, skippedBlocks };
}

function formatReport(matches: readonly DenyMatch[], rootDir: string): string {
  return matches
    .map((m) => `${relative(rootDir, m.file)}:${m.line}:${m.column} — "${m.match}" — ${m.snippet}`)
    .join('\n');
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const denylistPath = resolve(here, 'denylist.ts');

describe('rule 2 content gate', () => {
  it('no denied term appears anywhere in the repository', () => {
    const { matches } = sweep(repoRoot, [denylistPath]);
    expect(matches, `Rule 2 violation(s) — see CONTRACT.md:\n${formatReport(matches, repoRoot)}`).toEqual(
      [],
    );
  });

  it('has the expected number of rule2:allow-declaration blocks in the repository', () => {
    // A deliberate tripwire: bump this constant only when a document legitimately
    // gains a new marked passage that must state the forbidden terms in order to
    // forbid them. If this number changes without a reviewed reason, a block was
    // added silently and may be smuggling something past the gate.
    const EXPECTED_DECLARATION_BLOCK_COUNT = 15;
    const { skippedBlocks } = sweep(repoRoot, [denylistPath]);
    expect(skippedBlocks).toBe(EXPECTED_DECLARATION_BLOCK_COUNT);
  });

  it('does not flag the equipment, chemistry, scheduling and HACCP vocabulary this project relies on', () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'bakery-content-gate-safe-'));
    try {
      // Every line here pairs a real project idiom with a denylist pattern that
      // must not fire on it — either because the term is Tier A and structurally
      // excluded (a word-boundary or negative-lookahead carve-out), or because it
      // is Tier B and no person referent appears nearby. The words in
      // `denylist.ts` these collide with are described there, not repeated here,
      // so that this comment cannot trip the very gate it is testing.
      const sample = [
        // burner / burnout / burn-in / burning / burns, of equipment and fuel.
        'The line burner tripped on overload and was reset by the operator.',
        'Heating element burnout was detected; the coil was swapped before the next run.',
        "The generator's overnight burn-in finished clean, and the burning gas main was isolated before the burner was serviced.",
        "Yesterday's batch of glucose was burned completely during the respiration trial, and the furnace burns methane at a steady rate.",
        // scald / scalded / scalding — dairy and baking process terms, never a
        // person term.
        'A flour scald was prepared by scalding milk until fully scalded, per the standard formulation.',
        // dead band / deadline / deadlock / dead leg / deadweight.
        'The oven controller uses a 2-degree dead band so the thermostat stops chattering.',
        'The lot report is due by the batch deadline.',
        'Two ovens deadlocked on the shared mixer resource and the scheduler retried.',
        "A dead leg in the CIP loop was flagged for redesign; the pallet's deadweight rating was rechecked.",
        // critical control point / kill switch / killed (a process) / abort / terminate.
        'Critical control point CCP-3 failed specification and the lot was withdrawn.',
        'The kill switch aborted the run and the batch process was killed before it was terminated by the runbook.',
        // by accident (ordinary idiom) / accidental degeneracy (a physics term).
        'The reading changed by accident of rounding, and the model exhibits accidental degeneracy near that energy level.',
        // strain / culture / starter / stress / fatigue / failure / fault / trip /
        // condemn / recall / spoilage / contamination.
        'The yeast strain in the starter culture showed measurable stress, and metal fatigue was ruled out for the mixer arm.',
        'The mixer failure tripped a fault code; the affected lot was condemned and later recalled for spoilage and suspected contamination.',
        'Any repeat trip should condemn the lot automatically rather than wait for manual review.',
      ].join('\n');
      writeFileSync(join(scratchDir, 'sample.md'), sample, 'utf8');

      const { matches } = sweep(scratchDir);
      expect(matches, formatReport(matches, scratchDir)).toEqual([]);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('catches a Tier A term regardless of context, and a Tier B term only near a person referent', () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'bakery-content-gate-catch-'));
    try {
      // Built by concatenation, not written as one literal run of letters: were
      // either word to appear intact in this spec file's own source text, this
      // file would trip the whole-repository sweep above. That is the same
      // self-reference problem `denylist.ts` solves by being excluded from the
      // walk — this file has no such exclusion, so it earns its pass honestly.
      const tierAWord = ['casual', 'ty'].join(''); // Tier A: no legitimate use exists.
      const tierBWord = ['acci', 'dent'].join(''); // Tier B: legitimate ordinary-English idiom.

      const scratchFile = join(scratchDir, 'planted.txt');
      writeFileSync(
        scratchFile,
        [
          'Line one is unremarkable.',
          `A ${tierAWord} was logged on line two.`,
          `An operator reported an ${tierBWord} near the packing line.`,
          `The measurement drifted by ${tierBWord} during calibration.`,
        ].join('\n'),
        'utf8',
      );

      const { matches } = sweep(scratchDir);

      // Tier A: caught on line two, no person referent needed.
      const tierAMatch = matches.find((m) => m.line === 2);
      expect(tierAMatch).toBeDefined();
      expect(tierAMatch?.match.toLowerCase()).toBe(tierAWord);
      expect(tierAMatch?.file).toBe(scratchFile);
      expect(tierAMatch?.column).toBeGreaterThan(0);

      // Tier B, person referent nearby ("operator"): caught on line three.
      const tierBCaughtMatch = matches.find((m) => m.line === 3);
      expect(tierBCaughtMatch).toBeDefined();
      expect(tierBCaughtMatch?.match.toLowerCase()).toBe(tierBWord);

      // Tier B, no person referent nearby (the ordinary "by accident" sense):
      // not caught on line four.
      expect(matches.some((m) => m.line === 4)).toBe(false);

      // Nothing else was reported.
      expect(matches).toHaveLength(2);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('skips lines inside a well-formed rule2:allow-declaration block and counts the block', () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'bakery-content-gate-marker-'));
    try {
      const tierAWord = ['casual', 'ty'].join('');

      writeFileSync(
        join(scratchDir, 'declares.md'),
        [
          'Normal content line, scanned as usual.',
          '<!-- rule2:allow-declaration -->',
          `This passage must state the forbidden term "${tierAWord}" in order to forbid it.`,
          '<!-- /rule2:allow-declaration -->',
          'More normal content, also scanned as usual.',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(scratchDir, 'declares.ts'),
        [
          '// Normal content line, scanned as usual.',
          '/* rule2:allow-declaration */',
          `// This passage must state the forbidden term "${tierAWord}" in order to forbid it.`,
          '/* /rule2:allow-declaration */',
          '// More normal content, also scanned as usual.',
        ].join('\n'),
        'utf8',
      );

      const { matches, skippedBlocks } = sweep(scratchDir);
      expect(matches, formatReport(matches, scratchDir)).toEqual([]);
      expect(skippedBlocks).toBe(2);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('treats a nested rule2:allow-declaration marker as an error, not a skip', () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'bakery-content-gate-nested-'));
    try {
      writeFileSync(
        join(scratchDir, 'nested.md'),
        [
          '<!-- rule2:allow-declaration -->',
          'First passage.',
          '<!-- rule2:allow-declaration -->',
          'Second, nested, passage.',
          '<!-- /rule2:allow-declaration -->',
        ].join('\n'),
        'utf8',
      );

      expect(() => sweep(scratchDir)).toThrow(/nested/i);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('treats an unterminated rule2:allow-declaration marker as an error, not a skip', () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'bakery-content-gate-unterminated-'));
    try {
      writeFileSync(
        join(scratchDir, 'unterminated.md'),
        ['<!-- rule2:allow-declaration -->', 'A passage that never gets closed.'].join('\n'),
        'utf8',
      );

      expect(() => sweep(scratchDir)).toThrow(/unterminated/i);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('treats a stray rule2:allow-declaration end marker with no start as an error', () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'bakery-content-gate-stray-end-'));
    try {
      writeFileSync(
        join(scratchDir, 'stray-end.md'),
        ['Normal content.', '<!-- /rule2:allow-declaration -->'].join('\n'),
        'utf8',
      );

      expect(() => sweep(scratchDir)).toThrow(/no matching start/i);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('reports a precise file:line:column when a denied term is actually present', () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'bakery-content-gate-precise-'));
    try {
      // Built by concatenation for the same self-reference reason as above.
      const deniedWord = ['casual', 'ty'].join('');
      const scratchFile = join(scratchDir, 'planted.txt');
      writeFileSync(
        scratchFile,
        `Line one is unremarkable.\nA ${deniedWord} was logged on line two.\n`,
        'utf8',
      );

      const { matches } = sweep(scratchDir);

      expect(matches.length).toBeGreaterThan(0);
      const match = matches[0];
      expect(match).toBeDefined();
      expect(match?.match.toLowerCase()).toBe(deniedWord);
      expect(match?.line).toBe(2);
      expect(match?.file).toBe(scratchFile);
      expect(match?.column).toBeGreaterThan(0);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
