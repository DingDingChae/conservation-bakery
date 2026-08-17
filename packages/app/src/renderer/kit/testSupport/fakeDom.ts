/**
 * A minimal, hand-written DOM stand-in for this kit's unit tests.
 *
 * There is no jsdom (or any DOM shim) installed in this repository, and adding one is
 * a new dependency this task may not add — so the real `document`/`HTMLElement`
 * globals simply do not exist under Vitest's plain Node environment. This file
 * implements exactly the surface `dom.ts`, `focus.ts` and `live.ts` touch, nothing
 * more, and every consumer casts an instance to the real DOM type it stands in for
 * (`as unknown as HTMLElement`, etc.) at the call site — that cast is the acknowledged
 * cost of exercising browser code without a browser. Production kit code never imports
 * this file; only `*.spec.ts` files do.
 */

type FakeListener = (event: FakeEvent) => void;

export class FakeEvent {
  defaultPrevented = false;

  constructor(
    readonly type: string,
    private readonly init: { readonly key?: string; readonly shiftKey?: boolean } = {},
  ) {}

  get key(): string | undefined {
    return this.init.key;
  }

  get shiftKey(): boolean {
    return this.init.shiftKey ?? false;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class FakeClassList {
  readonly #classes = new Set<string>();

  add(name: string): void {
    this.#classes.add(name);
  }

  remove(name: string): void {
    this.#classes.delete(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.#classes.has(name);
    if (next) this.#classes.add(name);
    else this.#classes.delete(name);
    return next;
  }

  contains(name: string): boolean {
    return this.#classes.has(name);
  }

  toString(): string {
    return [...this.#classes].join(' ');
  }
}

export class FakeElement {
  readonly tagName: string;
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  ownerDocument: FakeDocument | null;
  focusCalls = 0;
  scrollIntoViewCalls = 0;

  readonly #attributes = new Map<string, string>();
  readonly #listeners = new Map<string, Set<FakeListener>>();
  #text = '';

  constructor(tag: string, ownerDocument: FakeDocument | null = null) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
  }

  setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.#attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.#attributes.delete(name);
  }

  get textContent(): string {
    return this.#text;
  }

  set textContent(value: string) {
    this.#text = value;
    this.children.length = 0;
  }

  append(...items: readonly (FakeElement | string)[]): void {
    for (const item of items) {
      if (typeof item === 'string') {
        this.#text += item;
        continue;
      }
      item.parent = this;
      item.ownerDocument = this.ownerDocument;
      this.children.push(item);
    }
  }

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    return child;
  }

  /** Only `'*'` (every descendant) is implemented — the one query `focus.ts` needs. */
  querySelectorAll(selector: string): FakeElement[] {
    if (selector !== '*') {
      throw new Error(`fakeDom: querySelectorAll only supports "*", got "${selector}"`);
    }
    const found: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
      for (const child of node.children) {
        found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  addEventListener(type: string, listener: FakeListener): void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: FakeEvent): void {
    for (const listener of this.#listeners.get(event.type) ?? []) listener(event);
  }

  focus(): void {
    this.focusCalls += 1;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  scrollIntoView(): void {
    this.scrollIntoViewCalls += 1;
  }
}

export class FakeDocument {
  activeElement: FakeElement | null = null;

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
}
