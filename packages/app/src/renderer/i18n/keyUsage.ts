/**
 * Static usage scanner for the translation catalogue — the piece that lets
 * `catalogue.spec.ts` check the catalogue against the *code that actually calls it*,
 * not just against itself. Node builtins only (`node:fs`, `node:path`, `node:url`); no
 * TypeScript parser, no new dependency (CLAUDE.md forbids adding one without explicit
 * instruction).
 *
 * Walks every real renderer source file — everything under `renderer/` except this
 * directory itself (the catalogue's own home; scanning it would make every key
 * trivially "used" by its own declaration) and every `*.spec.ts` file (whose literal
 * strings are test fixtures, not product copy — `catalogue.spec.ts` itself calls
 * `translate('panel', 'en', 'no.such.key')` on purpose, and that must never register as
 * a real call site). Two different things count as "this key is referenced":
 *
 *  1. A **call site**: `t('some.key')` or `translate(..., 'some.key', ...)`, where the
 *     key is a plain string literal immediately after the opening parenthesis — the
 *     exact shape a running `t()` is actually asked to render, and the shape the bug
 *     this task fixed left undetected (48 keys called this way, defined in no
 *     catalogue, rendered as `⟦missing:…⟧` to the player).
 *  2. Any other dot-namespaced string literal, anywhere in the scanned tree, that
 *     happens to equal a canonical key — this also recognises a key reached only
 *     *indirectly*, through a lookup table (`faceplate/logic.ts`'s
 *     `MODE_CATALOGUE_KEY`, `shell/logic.ts`'s `SPEED_CATALOGUE_KEY`) or a plain array
 *     of key names (`shell/settings.ts`'s `DIFFICULTY_PRESET_KEYS`), so a key
 *     legitimately used only that way is not wrongly reported as dead by the
 *     never-used check below.
 *  3. A template literal whose *static* leading segment is itself a dot-namespaced,
 *     dot-terminated prefix immediately followed by `${` — e.g.
 *     `` `faceplate.tag.status.${statusKeySuffix(status)}` `` in `faceplate/render.ts`.
 *     Every canonical key that starts with such a prefix counts as used, even though no
 *     single scanned file ever spells the full key out — this is what keeps a key like
 *     `faceplate.tag.status.deviationLow` (reached only by string-concatenating a
 *     literal prefix with a runtime suffix) from being wrongly reported as dead.
 *
 * A regex still has no way to resolve a key built from an arbitrary runtime variable
 * passed through unchanged (`context.t(translationKey)` in `palette/palette.ts`, where
 * `translationKey` is itself a variable holding one of several possible literals defined
 * elsewhere in the same file) — such a key is invisible to every check below unless
 * something else in the scanned tree also names it as a plain literal or a call-site
 * argument. That is a known, accepted limit of a scan built entirely from node builtins
 * with no real TypeScript parser — it is still a strictly stronger check than comparing
 * the four catalogues to each other, which is all the completeness test did before this
 * task and which could never have caught a key `t()` is actually called with but no
 * catalogue defines.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
/** `renderer/`, one level up from this file (`renderer/i18n/keyUsage.ts`). */
const DEFAULT_RENDERER_DIR = join(THIS_DIR, '..');

const CALL_SITE_PATTERN = /\b(?:t|translate)\(\s*(['"])((?:(?!\1).)*)\1/g;
const KEY_SHAPED_LITERAL_PATTERN = /(['"])([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)\1/g;
/** A template literal's static leading segment, ending in `.` and immediately followed
 * by an interpolation — see point 3 in the module doc comment. */
const TEMPLATE_KEY_PREFIX_PATTERN = /`([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+\.)\$\{/g;

function listSourceFiles(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'i18n') continue; // the catalogue's own home — not a consumer of it
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      listSourceFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

export interface KeyUsageScan {
  /** Every key found as the literal first argument of a `t(...)`/`translate(...)` call,
   * mapped to the scanned-relative file path(s) it was found in — the shape a running
   * `t()` actually sees, and what the "used but no catalogue defines it" check is built
   * from. */
  readonly callSiteKeys: ReadonlyMap<string, readonly string[]>;
  /** Every dot-namespaced string literal anywhere in the scanned tree, call site or
   * not — used only to decide whether a canonical key is reachable at all, including
   * through an indirection table, for the "defined but never used" check. */
  readonly anyKeyShapedLiteral: ReadonlySet<string>;
  /** Every static, dot-terminated template-literal prefix found immediately before an
   * interpolation (point 3 above). A canonical key starting with one of these counts as
   * used even though it never appears spelled out in full anywhere. */
  readonly templateKeyPrefixes: ReadonlySet<string>;
}

/** `rendererDir` is overridable only so a test can point this at a scratch fixture
 * tree; every real caller uses the default (this package's own `renderer/`). */
export function scanKeyUsage(rendererDir: string = DEFAULT_RENDERER_DIR): KeyUsageScan {
  const files = listSourceFiles(rendererDir, []);
  const callSiteKeys = new Map<string, string[]>();
  const anyKeyShapedLiteral = new Set<string>();
  const templateKeyPrefixes = new Set<string>();

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const relativePath = relative(rendererDir, file);

    for (const match of text.matchAll(CALL_SITE_PATTERN)) {
      const key = match[2];
      if (key === undefined) continue;
      const existing = callSiteKeys.get(key);
      if (existing) existing.push(relativePath);
      else callSiteKeys.set(key, [relativePath]);
    }

    for (const match of text.matchAll(KEY_SHAPED_LITERAL_PATTERN)) {
      const key = match[2];
      if (key !== undefined) anyKeyShapedLiteral.add(key);
    }

    for (const match of text.matchAll(TEMPLATE_KEY_PREFIX_PATTERN)) {
      const prefix = match[1];
      if (prefix !== undefined) templateKeyPrefixes.add(prefix);
    }
  }

  return { callSiteKeys, anyKeyShapedLiteral, templateKeyPrefixes };
}
