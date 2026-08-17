/**
 * The build-failing accessibility gate for this package's colour tokens.
 *
 * For every colour scheme (light, dark, Kid mode) this test parses the real
 * `tokens/*.css` files, resolves every pair of tokens actually used together
 * as text-on-background or as a non-text state indicator, computes the WCAG
 * contrast ratio from the literal hex values the CSS declares, and fails if
 * any pair is below 4.5:1 for body text or 3:1 for large text / non-text
 * indicators. Nothing here is hand-copied from the CSS comments — a colour
 * changed in a token file and not reflected in its comment cannot pass this
 * test by accident, because the ratio is recomputed from the file itself.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsAA, type ContrastCategory } from './contrast.js';
import { extractRuleBlock, parseCustomProperties, requireVar } from './tokenFile.js';

const here = dirname(fileURLToPath(import.meta.url));
const tokensDir = join(here, '..', 'tokens');

const lightCss = readFileSync(join(tokensDir, 'color-light.css'), 'utf8');
const darkCss = readFileSync(join(tokensDir, 'color-dark.css'), 'utf8');
const kidCss = readFileSync(join(tokensDir, 'kid.css'), 'utf8');

const lightVars = parseCustomProperties(extractRuleBlock(lightCss, "[data-theme='light']"));
const darkVars = parseCustomProperties(extractRuleBlock(darkCss, "[data-theme='dark']"));
const kidVars = parseCustomProperties(extractRuleBlock(kidCss, "[data-mode='kid']"));

interface Scheme {
  readonly name: string;
  readonly vars: Record<string, string>;
}

const schemes: readonly Scheme[] = [
  { name: 'light', vars: lightVars },
  { name: 'dark', vars: darkVars },
  { name: 'kid', vars: kidVars },
];

/**
 * Every colour-pair this component library actually renders together,
 * named by token, not by hex — so the same catalog checks all three
 * schemes. `category` picks the AA threshold (see `contrast.ts`).
 */
interface Pair {
  readonly description: string;
  readonly fg: string;
  readonly bg: string;
  readonly category: ContrastCategory;
}

const PAIRS: readonly Pair[] = [
  { description: 'body ink on page background', fg: 'cb-color-text-primary', bg: 'cb-color-bg', category: 'body' },
  { description: 'body ink on panel surface', fg: 'cb-color-text-primary', bg: 'cb-color-surface-panel', category: 'body' },
  { description: 'body ink on recessed surface', fg: 'cb-color-text-primary', bg: 'cb-color-surface-recess', category: 'body' },
  { description: 'secondary ink on panel surface', fg: 'cb-color-text-secondary', bg: 'cb-color-surface-panel', category: 'body' },
  { description: 'engraved label text on label face', fg: 'cb-color-label-text', bg: 'cb-color-label-bg', category: 'body' },
  { description: 'amber ink on page background', fg: 'cb-color-text-amber', bg: 'cb-color-bg', category: 'body' },
  { description: 'amber ink on panel surface', fg: 'cb-color-text-amber', bg: 'cb-color-surface-panel', category: 'body' },
  { description: 'ink on the amber accent fill', fg: 'cb-color-on-accent-amber', bg: 'cb-color-accent-amber', category: 'body' },
  { description: 'tile ink on a safety-red fill', fg: 'cb-color-on-safety', bg: 'cb-color-safety-red', category: 'body' },
  { description: 'tile ink on a safety-green fill', fg: 'cb-color-on-safety', bg: 'cb-color-safety-green', category: 'body' },
  { description: 'danger ink on page background', fg: 'cb-color-text-danger', bg: 'cb-color-bg', category: 'body' },
  { description: 'danger ink on panel surface', fg: 'cb-color-text-danger', bg: 'cb-color-surface-panel', category: 'body' },
  { description: 'danger ink on recessed surface', fg: 'cb-color-text-danger', bg: 'cb-color-surface-recess', category: 'body' },
  { description: 'border vs panel surface (non-text)', fg: 'cb-color-border', bg: 'cb-color-surface-panel', category: 'nontext' },
  { description: 'border vs page background (non-text)', fg: 'cb-color-border', bg: 'cb-color-bg', category: 'nontext' },
  { description: 'border vs recessed surface (non-text)', fg: 'cb-color-border', bg: 'cb-color-surface-recess', category: 'nontext' },
  { description: 'focus ring vs panel surface (non-text)', fg: 'cb-color-focus-ring', bg: 'cb-color-surface-panel', category: 'nontext' },
  { description: 'focus ring vs page background (non-text)', fg: 'cb-color-focus-ring', bg: 'cb-color-bg', category: 'nontext' },
  { description: 'safety-red fill vs page background (non-text)', fg: 'cb-color-safety-red', bg: 'cb-color-bg', category: 'nontext' },
  { description: 'safety-red fill vs panel surface (non-text)', fg: 'cb-color-safety-red', bg: 'cb-color-surface-panel', category: 'nontext' },
  { description: 'safety-green fill vs page background (non-text)', fg: 'cb-color-safety-green', bg: 'cb-color-bg', category: 'nontext' },
  { description: 'safety-green fill vs panel surface (non-text)', fg: 'cb-color-safety-green', bg: 'cb-color-surface-panel', category: 'nontext' },
];

describe('token colour contrast (WCAG AA)', () => {
  for (const scheme of schemes) {
    describe(`${scheme.name} scheme`, () => {
      for (const pair of PAIRS) {
        it(`${pair.description} — ${pair.category} threshold`, () => {
          const fgHex = requireVar(scheme.vars, pair.fg);
          const bgHex = requireVar(scheme.vars, pair.bg);
          const ratio = contrastRatio(fgHex, bgHex);
          // Printed so a reviewer running this test locally sees the exact
          // measured ratio, not just a pass/fail.
          console.log(
            `[contrast] ${scheme.name}: ${pair.description} = ${ratio.toFixed(2)}:1 ` +
              `(--${pair.fg} on --${pair.bg}, needs >= ${pair.category === 'body' ? '4.5' : '3'}:1)`,
          );
          expect(meetsAA(ratio, pair.category)).toBe(true);
        });
      }
    });
  }

  it('covers every scheme with the same pair catalog (no scheme silently skipped)', () => {
    expect(schemes.map((s) => s.name)).toEqual(['light', 'dark', 'kid']);
    expect(PAIRS.length).toBeGreaterThan(0);
  });
});
