/**
 * The renderer's entry point: constructs the real `RendererContext` (`context.ts`)
 * backed by `window.bakery` (the preload bridge, `main/preload.cts`), the i18n
 * catalogue, and the kit's preference store and live-region manager, then mounts the
 * control room shell (`shell/layout.ts`). Loaded by `index.html` as
 * `<script type="module" src="./main.js">` — see that file for the token/component
 * stylesheets it loads alongside this script, and this package's `tsconfig.json` /
 * `scripts/copy-renderer-assets.mjs` for how a plain `tsc --build` (no bundler) ends up
 * producing something `index.html` can load at all.
 *
 * Nothing in this module computes simulation state. Every write here is either a
 * `RendererApi` call the preload bridge exposes, or a purely local concern (the reveal
 * registry, the palette-entry registry, the fault watchdog) that exists only to satisfy
 * `RendererContext`'s shape — see `context.ts`'s own doc comment: "the renderer
 * observes, it never owns."
 */

import type {
  Command,
  CommandResult,
  ProvenanceNode,
  RendererApi,
  WorldSnapshot,
} from '../shared/ipc.js';
import type { PaletteEntry, Preferences, RendererContext, RevealTarget } from './context.js';
import { createTranslate } from './i18n/index.js';
import { mountLiveRegions } from './kit/live.js';
import { PreferenceStore } from './kit/prefs.js';
import { createFaultSurface } from './shell/fault.js';
import { isInfrastructureFailureMessage } from './shell/logic.js';
import { mountShell } from './shell/layout.js';

declare global {
  interface Window {
    /** Exposed by `main/preload.cts` via `contextBridge.exposeInMainWorld('bakery', ...)`.
     * Absent only if the preload script itself failed to run — handled below. */
    readonly bakery?: RendererApi;
  }
}

/**
 * Reflects `Preferences` onto `<html>`, where `packages/design`'s tokens and this
 * package's own `styles/shell.css` read it: `data-mode="kid"` is the Kid mode token
 * overlay (`packages/design/tokens/kid.css`, scoped exactly that way per that
 * package's README); `data-reduced-motion` backs `shell.css`'s blanket
 * animation/transition kill switch; `lang` keeps the document's own declared language
 * honest for assistive technology when a single concrete language is active (`'both'`
 * leaves the page-level `lang` as English, since `translate()`'s `'both'` output is
 * itself bilingual text within one node — see `i18n/catalogue.ts`'s module comment).
 */
function applyDocumentPreferences(preferences: Preferences): void {
  const root = document.documentElement;
  if (preferences.register === 'kid') root.dataset.mode = 'kid';
  else delete root.dataset.mode;
  root.dataset.reducedMotion = String(preferences.reducedMotion);
  root.lang = preferences.language === 'yue' ? 'zh-yue' : 'en';
}

function main(): void {
  const appRoot = document.getElementById('app');
  if (!appRoot) throw new Error('index.html is missing its #app mount point');

  const preferenceStore = new PreferenceStore();
  applyDocumentPreferences(preferenceStore.preferences());
  preferenceStore.onPreferences(applyDocumentPreferences);

  const liveRegions = mountLiveRegions(document.body);
  const t = createTranslate(preferenceStore.preferences);
  const announce = liveRegions.asAnnounce();

  const faultSurface = createFaultSurface({ t, announce });
  faultSurface.mount(document.body);

  if (!window.bakery) {
    faultSurface.report(t('shell.fault.noBridge'));
    return;
  }
  // A `const` alias, checked once here, rather than `window.bakery` at every call
  // site below: TypeScript cannot carry the narrowing from the guard above into a
  // `function` declaration's body (only into arrow functions defined inline), so this
  // is what actually gives `bakery` its non-optional type inside `send`/`provenance`.
  const bakery: RendererApi = window.bakery;

  // --- Snapshot cache and subscribers ---------------------------------------------
  let latestSnapshot: WorldSnapshot | null = null;
  const snapshotListeners = new Set<(snapshot: WorldSnapshot) => void>();

  bakery.onSnapshot((snapshot) => {
    latestSnapshot = snapshot;
    faultSurface.noteSnapshotReceived();
    for (const listener of snapshotListeners) listener(snapshot);
  });
  // Seed the cache immediately, so the first paint has real data rather than waiting
  // for the worker's first ~100ms publish tick to round-trip through IPC.
  void bakery.getSnapshot().then((snapshot) => {
    if (latestSnapshot === null) {
      latestSnapshot = snapshot;
      faultSurface.noteSnapshotReceived();
      for (const listener of snapshotListeners) listener(snapshot);
    }
  });

  // --- Commands and provenance: see `shell/fault.ts`'s module doc comment for why a
  // rejection here — not a `CommandResult.accepted === false` refusal, which is the
  // ordinary, expected way a command is turned down — is what stands in for the fault
  // channel `shared/ipc.ts` does not yet carry. ------------------------------------
  async function send(command: Command): Promise<CommandResult> {
    try {
      return await bakery.send(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      faultSurface.report(message);
      return { accepted: false, reason: message };
    }
  }

  async function provenance(lotId: string): Promise<ProvenanceNode> {
    try {
      return await bakery.getProvenance(lotId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A business-level rejection (an unknown lot id) is not a fault — it is
      // rethrown for the caller (`provenance/tree.ts`) to show as its own status
      // message, exactly as it already does. Only a real transport/worker failure
      // also latches the window-wide fault surface.
      if (isInfrastructureFailureMessage(message)) faultSurface.report(message);
      throw error;
    }
  }

  // --- Reveal registry: most-recently-registered handler tried first, and a second
  // full pass after the first one fails — see `shell/layout.ts`'s module doc comment
  // for why a screen switch and focusing the specific target are two separate steps.
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

  // --- Palette-entry registry: any number of independently-disposable batches -----
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
    snapshot: () => latestSnapshot,
    subscribe: (listener) => {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    send,
    provenance,

    t,
    announce,

    preferences: preferenceStore.preferences,
    setPreferences: preferenceStore.setPreferences,
    onPreferences: preferenceStore.onPreferences,

    reveal,
    registerRevealHandler,

    registerCommands,
    paletteEntries,
  };

  mountShell(appRoot, context);
}

main();
