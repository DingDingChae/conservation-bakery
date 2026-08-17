/**
 * Tiny helpers for building elements, setting attributes, and batching class changes.
 *
 * No framework, no virtual DOM, no clever reactivity — plain functions over the real
 * DOM, matching how `packages/design/components/*.js` is written. A panel calls `el()`
 * to build a subtree once, then updates it in place from the next snapshot; nothing
 * here diffs or re-renders for you.
 */

export interface ElementSpec {
  /** One class, or several, all added. */
  readonly class?: string | readonly string[];
  readonly attrs?: Readonly<Record<string, string>>;
  readonly dataset?: Readonly<Record<string, string>>;
  /** Plain text content. Mutually exclusive with `children` — a component either has
   * a caption or a subtree, never both from this helper. */
  readonly text?: string;
  readonly children?: readonly (Node | string)[];
}

/** Build one element in one call: tag, classes, attributes, dataset, and content. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  spec: ElementSpec = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (spec.class) {
    // Split on whitespace before adding. `classList.add` throws InvalidCharacterError on
    // a token containing a space, and the natural thing for a caller to write is the
    // ordinary HTML form, `class: 'cb-annunciator-tile cb-shell-header__annunciator'`.
    // Fixing the call sites instead of the helper would leave the trap armed for the
    // next one — and it throws at mount time, taking the whole window down with it.
    const classes = Array.isArray(spec.class) ? spec.class : [spec.class];
    for (const entry of classes) {
      if (!entry) continue;
      for (const name of entry.split(/\s+/)) {
        if (name) node.classList.add(name);
      }
    }
  }
  if (spec.attrs) {
    for (const [name, value] of Object.entries(spec.attrs)) node.setAttribute(name, value);
  }
  if (spec.dataset) {
    for (const [name, value] of Object.entries(spec.dataset)) node.dataset[name] = value;
  }
  if (spec.text !== undefined) node.textContent = spec.text;
  if (spec.children) node.append(...spec.children);

  return node;
}

/** Add or remove exactly one class, without the ternary at every call site. */
export function setClass(element: Element, className: string, active: boolean): void {
  element.classList.toggle(className, active);
}

/** Add or remove several classes from one map in a single pass. */
export function setClasses(element: Element, classNames: Readonly<Record<string, boolean>>): void {
  for (const [name, active] of Object.entries(classNames)) element.classList.toggle(name, active);
}

/** Remove every child, leaving the node itself (and its own attributes) untouched. */
export function clearChildren(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace `root`'s entire content with `children` in one call. */
export function mount(root: Element, ...children: readonly (Node | string)[]): void {
  clearChildren(root);
  if (children.length > 0) root.append(...children);
}
