/**
 * Focus trapping and restoration, and a visible-focus utility.
 *
 * `<dialog>` gives a modal surface this for free (see `packages/design/components/
 * command-palette.html` — focus trapping and Escape-to-close come from the browser).
 * `trapFocus` exists for the surfaces built from plain elements instead, so every
 * overlay in the control room gets the same guarantee: Tab and Shift+Tab stay inside
 * it, and closing it gives focus back to wherever it came from.
 */

const FOCUSABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

/**
 * True for an element a keyboard user could Tab to. Mirrors the common focus-trap
 * selector — `a[href], button:not([disabled]), input:not([disabled]),
 * select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])` —
 * as a predicate over attributes rather than a CSS selector string, so it needs no
 * selector engine and is trivial to unit test directly.
 */
export function isFocusableElement(element: Element): boolean {
  if (element.hasAttribute('disabled') || element.hasAttribute('hidden')) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;

  const tabIndexAttr = element.getAttribute('tabindex');
  if (tabIndexAttr !== null) {
    const parsed = Number(tabIndexAttr);
    return Number.isFinite(parsed) && parsed >= 0;
  }
  if (element.tagName === 'A') return element.hasAttribute('href');
  return FOCUSABLE_TAGS.has(element.tagName);
}

export interface FocusTrapOptions {
  /** Element to return focus to when the trap is released. Omit to auto-capture
   * whatever had focus when the trap was created; pass `null` explicitly to opt out of
   * restoration entirely. */
  readonly restoreFocusTo?: HTMLElement | null;
  /** Element to focus first. Defaults to the first focusable descendant, or the
   * container itself if it has none. */
  readonly initialFocus?: HTMLElement | null;
}

/**
 * Confine Tab and Shift+Tab to `container`'s focusable descendants until the returned
 * function is called, then give focus back to whatever held it before (see
 * `FocusTrapOptions.restoreFocusTo`). The focusable set is recomputed on every
 * keypress rather than cached once, because a surface's contents can change while it
 * is open — a filtered command list, a revealed section.
 */
export function trapFocus(container: HTMLElement, options: FocusTrapOptions = {}): () => void {
  const doc = container.ownerDocument;
  const previouslyFocused =
    options.restoreFocusTo !== undefined ? options.restoreFocusTo : (doc.activeElement as HTMLElement | null);

  const focusables = (): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>('*')).filter(isFocusableElement);

  const initial = options.initialFocus ?? focusables()[0] ?? container;
  initial.focus();

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const elements = focusables();
    if (elements.length === 0) {
      // Nothing focusable left inside the trap (e.g. everything got filtered out) —
      // keep focus from escaping to the rest of the page.
      event.preventDefault();
      container.focus();
      return;
    }
    const first = elements[0]!;
    const last = elements[elements.length - 1]!;
    const active = doc.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
    // Otherwise focus is somewhere in the middle of the trap: let the browser's normal
    // Tab order move it, rather than second-guessing that order here.
  };

  container.addEventListener('keydown', onKeydown);

  return () => {
    container.removeEventListener('keydown', onKeydown);
    if (previouslyFocused) previouslyFocused.focus();
  };
}

/**
 * Focus `element` and bring it into view. For a `reveal()` jump — the command palette
 * teleporting to a machine, a tag, or an alarm — that did not originate from a Tab
 * keypress but still needs a visible focus ring exactly as much as one would have.
 */
export function focusVisibly(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'center' });
}
