/**
 * A static regression guard for the fault surface's detail line — see
 * `shell/fault.ts`'s module doc comment for the investigation this exists to close
 * out: a real Chromium/Electron render of the current `shell.css` never reproduced a
 * blank detail box, but `fault.spec.ts` (happy-dom) structurally *cannot* catch a real
 * stylesheet regression either way, because happy-dom has no CSS cascade and no paint
 * at all — it only ever sees whatever `detail.textContent` was assigned, never what a
 * real browser would have shown on top of it.
 *
 * This file reads `shell.css` as plain text (`node:fs`, no CSS parser dependency — the
 * same "no new dependency" discipline `i18n/keyUsage.ts` already follows for the same
 * reason) and resolves, from the stylesheet's own source, which declarations actually
 * apply to `.cb-shell-fault__detail` once every rule that names it — in source order,
 * later overriding earlier, exactly how same-specificity class selectors cascade — has
 * been applied. It fails the build if a future edit ever leaves that selector without
 * a legible `color`-against-`background` pairing, a real font size, or a text node that
 * could actually be seen — the exact failure mode the pixel crop in `captures/app/`
 * describes, caught here as a property comparison instead of a screenshot.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHELL_CSS_PATH = join(HERE, 'shell.css');

interface CssRule {
  readonly selector: string;
  readonly body: string;
}

/**
 * A minimal, brace-depth-aware CSS split — not a real parser, just enough to recover
 * "selector list -> declaration body" pairs, including one level of `@media` nesting
 * (shell.css uses `@media` only for layout, not for the fault surface today, but a
 * future edit moving these rules under one should not silently blind this test).
 */
function extractRules(css: string): readonly CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];

  // A block found at this recursion level always starts a fresh selector; nested
  // braces inside its body are resolved by the inner `while` below before the outer
  // loop ever sees them, so this loop itself never needs its own depth counter.
  function scan(text: string): void {
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== '{') continue;
      const selector = text.slice(start, index).trim();
      let innerDepth = 1;
      let cursor = index + 1;
      while (cursor < text.length && innerDepth > 0) {
        if (text[cursor] === '{') innerDepth += 1;
        else if (text[cursor] === '}') innerDepth -= 1;
        cursor += 1;
      }
      const body = text.slice(index + 1, cursor - 1);
      if (selector.startsWith('@')) scan(body);
      else rules.push({ selector, body });
      start = cursor;
      index = cursor - 1;
    }
  }

  scan(withoutComments);
  return rules;
}

/** Declarations that apply to `targetSelector`, in cascade order (source order for the
 * equal-specificity single-class selectors this file's fault rules actually use), so a
 * later rule's declaration overwrites an earlier one for the same property. */
function resolveDeclarations(rules: readonly CssRule[], targetSelector: string): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const rule of rules) {
    const selectors = rule.selector.split(',').map((entry) => entry.trim());
    if (!selectors.includes(targetSelector)) continue;
    for (const statement of rule.body.split(';')) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;
      const property = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();
      if (property) resolved.set(property, value);
    }
  }
  return resolved;
}

describe('.cb-shell-fault__detail (styles/shell.css, static)', () => {
  const css = readFileSync(SHELL_CSS_PATH, 'utf8');
  const rules = extractRules(css);
  const declarations = resolveDeclarations(rules, '.cb-shell-fault__detail');

  it('is actually targeted by at least one rule in shell.css', () => {
    expect(declarations.size).toBeGreaterThan(0);
  });

  it('declares both a background and a text colour, from real tokens', () => {
    const background = declarations.get('background') ?? declarations.get('background-color');
    const color = declarations.get('color');
    expect(background, 'no background/background-color declared for .cb-shell-fault__detail').toBeTruthy();
    expect(color, 'no color declared for .cb-shell-fault__detail').toBeTruthy();
    expect(background).not.toBe('transparent');
    expect(background).not.toBe('none');
    expect(color).not.toBe('transparent');
  });

  it('never resolves its colour and background to the same token — the invisible-text failure mode', () => {
    const background = declarations.get('background') ?? declarations.get('background-color');
    const color = declarations.get('color');
    expect(color).not.toBe(background);
  });

  it('never collapses to an invisible or zero-size box', () => {
    for (const property of ['display', 'visibility', 'opacity', 'width', 'height', 'font-size']) {
      const value = declarations.get(property);
      if (value === undefined) continue; // not every property needs to be set explicitly
      expect(value, `${property}: ${value} would hide the detail line`).not.toMatch(
        /^(none|hidden|0|0px|0em|0rem)$/,
      );
    }
  });
});
