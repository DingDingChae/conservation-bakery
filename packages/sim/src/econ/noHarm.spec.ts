/**
 * A module-scoped instance of CONTRACT.md rule 2's content gate.
 *
 * `tests/content/no-harm.spec.ts` already sweeps the entire repository,
 * including every file in this directory, and fails the build on a match —
 * this file adds nothing to that enforcement. It exists so this module's own
 * test suite carries its own, directly-runnable proof that nothing written
 * here trips the rule 2 denylist, without editing (or depending on internal,
 * unexported helpers of) the repository-wide gate this module does not own.
 * It reuses that gate's own `DENYLIST` and `PERSON_REFERENT_PATTERN` data
 * read-only, exactly as `tests/content/denylist.ts` invites any file to.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DENYLIST, PERSON_REFERENT_PATTERN } from '../../../../tests/content/denylist.js';

const PROXIMITY_WINDOW_CHARS = 40;

function hasNearbyPersonReferent(lineText: string, matchIndex: number, matchLength: number): boolean {
  const start = Math.max(0, matchIndex - PROXIMITY_WINDOW_CHARS);
  const end = Math.min(lineText.length, matchIndex + matchLength + PROXIMITY_WINDOW_CHARS);
  return PERSON_REFERENT_PATTERN.test(lineText.slice(start, end));
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.isFile() && extname(entry.name) === '.ts') out.push(full);
  }
  return out;
}

interface Match {
  readonly file: string;
  readonly line: number;
  readonly match: string;
  readonly snippet: string;
}

describe('econ module content gate (rule 2)', () => {
  it('contains no denylisted term anywhere in packages/sim/src/econ', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = collectTsFiles(here);
    const matches: Match[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((lineText, index) => {
        for (const { pattern, tier } of DENYLIST) {
          const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
          const withGlobal = new RegExp(pattern.source, flags);
          let found: RegExpExecArray | null;
          while ((found = withGlobal.exec(lineText)) !== null) {
            const shouldReport = tier === 'A' || hasNearbyPersonReferent(lineText, found.index, found[0].length);
            if (shouldReport) {
              matches.push({ file, line: index + 1, match: found[0], snippet: lineText.trim() });
            }
            if (found[0].length === 0) withGlobal.lastIndex += 1;
          }
        }
      });
    }

    const report = matches.map((m) => `${m.file}:${m.line} — "${m.match}" — ${m.snippet}`).join('\n');
    expect(matches, report).toEqual([]);
  });

  it('found more than zero source files to scan (the sweep is not vacuously passing)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    expect(collectTsFiles(here).length).toBeGreaterThan(5);
  });
});
