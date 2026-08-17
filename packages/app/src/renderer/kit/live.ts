/**
 * An aria-live region manager implementing the `Announce` contract from `context.ts`:
 * `announce(message, 'polite' | 'assertive')`.
 *
 * Two regions are created once and kept in the DOM for the life of the app — a polite
 * one (`role="status"`) for a value that changed, and an assertive one (`role="alert"`)
 * for an alarm that just latched. Only `textContent` changes on each call, matching
 * `packages/design/components/toast.html`'s note that inserting and removing a live
 * region is announced inconsistently across screen readers, while updating one already
 * present is reliable.
 *
 * Consecutive identical messages on the same channel are dropped rather than re-set:
 * a value that ticks every second and happens to read the same on two consecutive
 * ticks must not retrigger the region, or a screen reader user is flooded with the
 * same sentence once a second for the life of the session.
 */

import { el } from './dom.js';

export type Urgency = 'polite' | 'assertive';

/** The `Announce` shape from `renderer/context.ts`, duplicated structurally so this
 * module has no import-time dependency on it. */
export type Announce = (message: string, urgency?: Urgency) => void;

/** The minimal surface `LiveRegionManager` needs from a live-region host element —
 * deliberately not `HTMLElement`, so a caller can hand it any object with these two
 * members (including a plain DOM element, which has both). */
export interface LiveRegionElement {
  textContent: string;
  setAttribute(name: string, value: string): void;
}

export interface LiveRegionElements {
  readonly politeElement: LiveRegionElement;
  readonly assertiveElement: LiveRegionElement;
}

export class LiveRegionManager {
  readonly #polite: LiveRegionElement;
  readonly #assertive: LiveRegionElement;
  #lastPolite: string | null = null;
  #lastAssertive: string | null = null;

  constructor(elements: LiveRegionElements) {
    this.#polite = elements.politeElement;
    this.#assertive = elements.assertiveElement;
    this.#polite.setAttribute('role', 'status');
    this.#polite.setAttribute('aria-live', 'polite');
    this.#assertive.setAttribute('role', 'alert');
    this.#assertive.setAttribute('aria-live', 'assertive');
  }

  announce(message: string, urgency: Urgency = 'polite'): void {
    if (urgency === 'assertive') {
      if (message === this.#lastAssertive) return;
      this.#lastAssertive = message;
      this.#assertive.textContent = message;
      return;
    }
    if (message === this.#lastPolite) return;
    this.#lastPolite = message;
    this.#polite.textContent = message;
  }

  /** Bind `announce` as a free function matching `context.ts`'s `Announce` type, so it
   * can be handed straight to a `RendererContext` without an extra wrapper closure at
   * every call site. */
  asAnnounce(): Announce {
    return (message, urgency) => this.announce(message, urgency);
  }
}

const VISUALLY_HIDDEN_CLASS = 'cb-visually-hidden';

/**
 * Create and mount the two live regions into `container` (once, for the life of the
 * app) and return the manager that speaks through them. Visually hidden, per the
 * accessibility contract: this is heard, not seen — the visible state change is the
 * panel's job.
 */
export function mountLiveRegions(container: Element): LiveRegionManager {
  const politeElement = el('div', { class: VISUALLY_HIDDEN_CLASS });
  const assertiveElement = el('div', { class: VISUALLY_HIDDEN_CLASS });
  container.append(politeElement, assertiveElement);
  return new LiveRegionManager({ politeElement, assertiveElement });
}
