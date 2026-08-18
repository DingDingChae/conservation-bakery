/**
 * A minimal, hand-written `RendererContext` and `GestureTarget` stand-in for
 * `index.spec.ts` — this module is the one piece of `renderer/audio` that talks to
 * `RendererContext` (`context.ts`) and to a DOM-shaped gesture source directly, rather
 * than only to plain snapshot data, so its own test needs fakes for both. Production
 * code never imports this file; only `*.spec.ts` files do.
 */

import type { Command, CommandResult, ProvenanceNode, WorldSnapshot } from '../../../shared/ipc.js';
import type { Disposable, PaletteEntry, Preferences, RendererContext, RevealTarget } from '../../context.js';
import type { GestureTarget } from '../index.js';

export interface FakeRendererContextControls {
  readonly context: RendererContext;
  /** Sets the "current" snapshot and, if any listener is already subscribed, notifies
   * it — matching `main.ts`'s own real seeded-cache-then-push behaviour closely enough
   * for this module's purposes. */
  emitSnapshot(snapshot: WorldSnapshot): void;
  setPreferences(patch: Partial<Preferences>): void;
}

const DEFAULT_PREFERENCES: Preferences = { register: 'panel', language: 'en', reducedMotion: false, muted: false };

export function createFakeRendererContext(initial: Partial<Preferences> = {}): FakeRendererContextControls {
  let snapshot: WorldSnapshot | null = null;
  let preferences: Preferences = { ...DEFAULT_PREFERENCES, ...initial };
  const snapshotListeners = new Set<(snapshot: WorldSnapshot) => void>();
  const preferencesListeners = new Set<(preferences: Preferences) => void>();

  const context: RendererContext = {
    snapshot: () => snapshot,
    subscribe: (listener) => {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    send: (): Promise<CommandResult> => Promise.resolve({ accepted: true }),
    provenance: (): Promise<ProvenanceNode> => Promise.reject(new Error('fakeRendererContext: provenance not implemented')),
    t: (key: string) => key,
    announce: () => {},
    preferences: () => preferences,
    setPreferences: (patch: Partial<Preferences>) => {
      preferences = { ...preferences, ...patch };
      for (const listener of preferencesListeners) listener(preferences);
    },
    onPreferences: (listener: (preferences: Preferences) => void): Disposable => {
      preferencesListeners.add(listener);
      return () => {
        preferencesListeners.delete(listener);
      };
    },
    reveal: () => {},
    registerRevealHandler: () => () => {},
    registerCommands: (_entries: readonly PaletteEntry[]) => () => {},
    paletteEntries: () => [],
  };

  return {
    context,
    emitSnapshot(next: WorldSnapshot) {
      snapshot = next;
      for (const listener of snapshotListeners) listener(next);
    },
    setPreferences(patch: Partial<Preferences>) {
      context.setPreferences(patch);
    },
  };
}

// Only referenced for its `Command`/`RevealTarget` import — kept so this file type-checks
// against the full `RendererContext` shape without an `any` anywhere in this module.
export type { Command, RevealTarget };

type FakeGestureListener = (event?: Event) => void;

interface FakeGestureRegistration {
  /** The original listener a caller passed in — compared by reference in
   * `removeEventListener`, exactly like a real `EventTarget`. */
  readonly original: EventListenerOrEventListenerObject;
  readonly call: FakeGestureListener;
  readonly once: boolean;
}

/** Implements only the two `EventTarget` methods `GestureTarget` (`index.ts`) declares,
 * plus a `dispatch` a test calls directly to simulate a real user gesture — there is no
 * real DOM event loop under Vitest's plain Node environment to fire one for real.
 * Honours `{ once: true }`, since `index.ts` relies on it to avoid resuming the audio
 * context more than once per registered listener. */
export class FakeGestureTarget implements GestureTarget {
  readonly #registrations = new Map<string, FakeGestureRegistration[]>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (!listener) return;
    const once = typeof options === 'object' && options !== null && options.once === true;
    const list = this.#registrations.get(type) ?? [];
    list.push({ original: listener, call: toPlainListener(listener), once });
    this.#registrations.set(type, list);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const list = this.#registrations.get(type);
    if (!list) return;
    this.#registrations.set(
      type,
      list.filter((registration) => registration.original !== listener),
    );
  }

  listenerCount(type: string): number {
    return this.#registrations.get(type)?.length ?? 0;
  }

  dispatch(type: string): void {
    const list = this.#registrations.get(type) ?? [];
    for (const registration of list) registration.call();
    const remaining = list.filter((registration) => !registration.once);
    this.#registrations.set(type, remaining);
  }
}

function toPlainListener(listener: EventListenerOrEventListenerObject): FakeGestureListener {
  return (event) => {
    if (typeof listener === 'function') listener(event as Event);
    else listener.handleEvent(event as Event);
  };
}
