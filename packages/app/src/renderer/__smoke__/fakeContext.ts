/**
 * A realistic, in-memory `RendererContext` for the mount smoke test.
 *
 * Every member of `context.ts`'s `RendererContext` is implemented for real — not
 * stubbed to `() => {}` — because a stub that never calls back is exactly what would
 * let a mount-time crash inside a `subscribe`/`onPreferences` callback slip past a
 * shallower test. `t` is wired to the *real* `createTranslate` (`i18n/index.js`)
 * against the *real* four catalogues, which is what lets this test catch a
 * translation key that exists in code but in no catalogue: a fake translator that just
 * echoes its key back would never reproduce `⟦missing:…⟧`.
 *
 * `reveal`/`registerRevealHandler` and `registerCommands`/`paletteEntries` reproduce
 * `main.ts`'s own registries exactly (two-pass reveal, most-recently-registered first)
 * so a panel that depends on that exact contract behaves here the way it does in the
 * real app.
 */

import type { Command, CommandResult, ProvenanceNode, WorldSnapshot } from '../../shared/ipc.js';
import type { PaletteEntry, Preferences, RendererContext, RevealTarget } from '../context.js';
import { createTranslate } from '../i18n/index.js';

export interface FakeContextHandle {
  readonly context: RendererContext;
  /** Push a new snapshot to every `subscribe` listener, the way `main.ts`'s
   * `bakery.onSnapshot` does. Not needed by every test, but real panels (header, nav
   * rail, faceplate, balance) all register one. */
  readonly pushSnapshot: (snapshot: WorldSnapshot) => void;
  /** Every message passed to `announce`, in order — so a test can assert an alarm
   * transition or a refusal was actually spoken, not just drawn. */
  readonly announced: readonly { readonly message: string; readonly urgency: 'polite' | 'assertive' }[];
}

function findProvenanceNode(root: ProvenanceNode, lotId: string): ProvenanceNode | null {
  if (root.lotId === lotId) return root;
  for (const child of root.children) {
    const found = findProvenanceNode(child, lotId);
    if (found) return found;
  }
  return null;
}

export function createFakeContext(
  initialPreferences: Preferences,
  initialSnapshot: WorldSnapshot,
  provenanceTree: ProvenanceNode,
): FakeContextHandle {
  let currentSnapshot: WorldSnapshot | null = initialSnapshot;
  const snapshotListeners = new Set<(snapshot: WorldSnapshot) => void>();

  let currentPreferences: Preferences = initialPreferences;
  const preferenceListeners = new Set<(preferences: Preferences) => void>();

  const announced: { readonly message: string; readonly urgency: 'polite' | 'assertive' }[] = [];

  const t = createTranslate(() => currentPreferences);

  async function send(_command: Command): Promise<CommandResult> {
    // Every command is accepted — this fixture exists to prove the tree mounts and
    // reads, not to exercise refusal copy (`faceplate/logic.spec.ts` and friends
    // already cover refusal text formatting without a DOM).
    return { accepted: true };
  }

  async function provenance(lotId: string): Promise<ProvenanceNode> {
    const found = findProvenanceNode(provenanceTree, lotId);
    if (!found) throw new Error(`unknown lot ${lotId}`);
    return found;
  }

  // --- reveal(): the exact two-pass contract `main.ts` implements -----------------
  let revealHandlers: readonly ((target: RevealTarget) => boolean)[] = [];

  function registerRevealHandler(handler: (target: RevealTarget) => boolean): () => void {
    revealHandlers = [...revealHandlers, handler];
    return () => {
      revealHandlers = revealHandlers.filter((candidate) => candidate !== handler);
    };
  }

  function tryReveal(target: RevealTarget): boolean {
    for (let index = revealHandlers.length - 1; index >= 0; index -= 1) {
      if (revealHandlers[index]!(target)) return true;
    }
    return false;
  }

  function reveal(target: RevealTarget): void {
    if (!tryReveal(target)) tryReveal(target);
  }

  // --- palette-entry registry: the exact batch contract `main.ts` implements ------
  const paletteEntryBatches = new Set<readonly PaletteEntry[]>();

  function registerCommands(entries: readonly PaletteEntry[]): () => void {
    paletteEntryBatches.add(entries);
    return () => {
      paletteEntryBatches.delete(entries);
    };
  }

  function paletteEntries(): readonly PaletteEntry[] {
    return [...paletteEntryBatches].flat();
  }

  const context: RendererContext = {
    snapshot: () => currentSnapshot,
    subscribe: (listener) => {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    send,
    provenance,

    t,
    announce: (message, urgency = 'polite') => {
      announced.push({ message, urgency });
    },

    preferences: () => currentPreferences,
    setPreferences: (patch) => {
      currentPreferences = { ...currentPreferences, ...patch };
      for (const listener of preferenceListeners) listener(currentPreferences);
    },
    onPreferences: (listener) => {
      preferenceListeners.add(listener);
      return () => {
        preferenceListeners.delete(listener);
      };
    },

    reveal,
    registerRevealHandler,

    registerCommands,
    paletteEntries,
  };

  return {
    context,
    pushSnapshot: (snapshot) => {
      currentSnapshot = snapshot;
      for (const listener of snapshotListeners) listener(snapshot);
    },
    announced,
  };
}
