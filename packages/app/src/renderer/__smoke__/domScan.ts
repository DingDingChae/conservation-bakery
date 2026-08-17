/**
 * Post-mount DOM inspection for the smoke test: does the mounted tree contain a
 * rendered "unresolved translation key" placeholder anywhere — not just in text a
 * player reads, but in an attribute a screen reader reads (`aria-label`, `title`,
 * `placeholder`, `alt`, ...), since `i18n/catalogue.ts`'s `rawLookup` renders exactly
 * this marker for any key present in code but absent from a catalogue (see that
 * file's own comment), and this app puts `context.t()` output in both places.
 */

/** Matches `i18n/catalogue.ts`'s `rawLookup` fallback, `⟦missing:${key}⟧`, verbatim. */
const MISSING_PLACEHOLDER_PATTERN = /⟦missing:[^⟧]*⟧/g;

/**
 * Every distinct `⟦missing:...⟧` marker found anywhere under `root` — in a text node
 * or in any element attribute — de-duplicated so a repeated key (e.g. the same missing
 * label shown on two rows) is reported once, not once per occurrence.
 */
export function findMissingPlaceholders(root: ParentNode): readonly string[] {
  const hits = new Set<string>();

  const text = root.textContent ?? '';
  for (const match of text.matchAll(MISSING_PLACEHOLDER_PATTERN)) hits.add(match[0]);

  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      for (const match of attribute.value.matchAll(MISSING_PLACEHOLDER_PATTERN)) hits.add(match[0]);
    }
  }

  return [...hits];
}

/** Flush every microtask and the current macrotask queue — enough for a panel's
 * `async load()` (one `await context.provenance(...)`) to finish before the test reads
 * the DOM it wrote, without pulling in fake timers or a bespoke event loop. */
export function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
