/**
 * A minimal parser that reads `--custom-property: value;` declarations out
 * of one rule block in a plain CSS token file, keyed by a literal selector
 * fragment (e.g. `[data-theme='dark']`). This exists so
 * `contrast.spec.ts` can recompute contrast ratios from the exact hex values
 * a token file declares, rather than from hex values copied into the test —
 * a colour edited in a `tokens/*.css` file and not reflected in a comment
 * cannot silently go unchecked.
 *
 * Deliberately not a general CSS parser: it assumes the token files' own
 * shape (flat declarations, no nested rules other than the one `@media`
 * block color-dark.css uses, no comments inside a value). That is a
 * reasonable assumption to hard-code against files this package itself
 * owns and hand-writes.
 */

/**
 * Finds the first rule block whose selector line contains `selectorLiteral`
 * as a substring, and returns the raw text between its outermost `{` and
 * matching `}` (brace-depth aware, so a block containing a nested block —
 * as color-dark.css's top-level `[data-theme='dark']` block does not, but a
 * future file might — is still extracted correctly).
 *
 * Throws if the selector or a balanced block for it cannot be found, since a
 * missing token block is a bug in the token file, not something to fail
 * open on.
 */
export function extractRuleBlock(css: string, selectorLiteral: string): string {
  const selectorIndex = css.indexOf(selectorLiteral);
  if (selectorIndex === -1) {
    throw new Error(`selector not found: ${selectorLiteral}`);
  }
  const openBrace = css.indexOf('{', selectorIndex);
  if (openBrace === -1) {
    throw new Error(`no opening brace after selector: ${selectorLiteral}`);
  }

  let depth = 0;
  for (let i = openBrace; i < css.length; i += 1) {
    const char = css[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return css.slice(openBrace + 1, i);
      }
    }
  }
  throw new Error(`unbalanced braces for selector: ${selectorLiteral}`);
}

/**
 * Extracts every `--name: value;` custom-property declaration in `block`
 * into a plain map, keyed without the leading `--`. Values are trimmed and
 * inline `/* ... *\/` comments after the value are stripped.
 */
export function parseCustomProperties(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    const name = match[1];
    const rawValue = match[2];
    if (name === undefined || rawValue === undefined) continue;
    const value = rawValue.replace(/\/\*.*?\*\//g, '').trim();
    out[name] = value;
  }
  return out;
}

/** Looks up a required custom property by name, throwing if it is absent. */
export function requireVar(vars: Record<string, string>, name: string): string {
  const value = vars[name];
  if (value === undefined) {
    throw new Error(`missing custom property: --${name}`);
  }
  return value;
}
