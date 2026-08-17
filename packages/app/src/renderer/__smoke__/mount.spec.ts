/**
 * @vitest-environment happy-dom
 *
 * The renderer mount smoke test.
 *
 * What shipped today (see this task's brief) was a build that typechecked clean and
 * had 820 green tests, yet the real Electron window was completely inert: a mount-time
 * `InvalidCharacterError` from `kit/dom.ts`'s `el()` took the whole tree down before a
 * single frame painted, and — orthogonally — 48 translation keys used by `t()` had no
 * catalogue entry at all, so what little *did* render was a screen full of literal
 * `⟦missing:…⟧` text. Neither class of failure trips a type error, and the existing
 * i18n test only diffs the four catalogues against each other, never against the code
 * that calls `t()` — so both reached a real player.
 *
 * This test mounts the *real* `mountShell` (`shell/layout.ts`) — not a piece of it —
 * into a detached `happy-dom` document, backed by a hand-built `RendererContext`
 * (`fakeContext.ts`) over a realistic `WorldSnapshot`/`ProvenanceNode` fixture
 * (`fixtures.ts`), for every register/language combination the shell supports. It
 * fails if the mount throws, and it fails if the mounted output contains a
 * `⟦missing:…⟧` marker anywhere — text or attribute (`domScan.ts`) — so a key missing
 * only from the Cantonese Kid catalogue fails the build exactly as loudly as one
 * missing from every catalogue.
 *
 * The faceplate (default main screen), the balance panel (always mounted) and the
 * provenance tree (reached via `context.reveal({ kind: 'lot', ... })`, exactly the way
 * the command palette reaches it in the real app) are all exercised here, because all
 * three are reachable through the shell this module owns.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FaultReport, LanguageMode, Register } from '../../shared/ipc.js';
import type { Preferences } from '../context.js';
import { createFaultSurface } from '../shell/fault.js';
import { mountShell } from '../shell/layout.js';
import { createFakeContext } from './fakeContext.js';
import { findMissingPlaceholders, flushAsyncWork } from './domScan.js';
import {
  buildFixtureProvenance,
  buildFixtureSnapshot,
  FIXTURE_ALARM_ID,
  FIXTURE_LOT_ID,
  FIXTURE_MACHINE_MIXER_ID,
  FIXTURE_MACHINE_OVEN_ID,
} from './fixtures.js';

const REGISTERS: readonly Register[] = ['panel', 'kid'];
const LANGUAGES: readonly LanguageMode[] = ['en', 'yue', 'both'];

function buildPreferences(register: Register, language: LanguageMode): Preferences {
  return { register, language, reducedMotion: false, muted: false };
}

/** A detached document — `document.implementation.createHTMLDocument`, per
 * `happy-dom`'s own `DOMImplementation` — rather than the environment's shared global
 * `document`, so each test's mount is provably isolated from every other test's. */
function createDetachedRoot(): { readonly doc: Document; readonly root: HTMLElement } {
  const doc = document.implementation.createHTMLDocument('Conservation Bakery');
  const root = doc.createElement('div');
  root.id = 'app';
  doc.body.appendChild(root);
  return { doc, root };
}

describe('mountShell smoke test', () => {
  let doc: Document;
  let root: HTMLElement;
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  for (const register of REGISTERS) {
    for (const language of LANGUAGES) {
      describe(`register=${register} language=${language}`, () => {
        beforeEach(() => {
          ({ doc, root } = createDetachedRoot());
        });

        it('mounts without throwing and produces real, readable content', () => {
          const { context } = createFakeContext(
            buildPreferences(register, language),
            buildFixtureSnapshot(),
            buildFixtureProvenance(),
          );

          expect(() => {
            dispose = mountShell(root, context);
          }).not.toThrow();

          // Real content, not an empty shell: the nav rail lists both machine labels
          // verbatim (they are not translated, per `faceplate/render.ts`'s own doc
          // comment), and there are more than a handful of elements in the tree.
          const bodyText = doc.body.textContent ?? '';
          expect(bodyText).toContain('Deck Oven 1');
          expect(bodyText).toContain('Spiral Mixer 1');
          expect(doc.body.querySelectorAll('*').length).toBeGreaterThan(30);

          expect(findMissingPlaceholders(doc.body)).toEqual([]);
        });

        it('mounts the faceplate, the balance panel and the provenance tree with no missing placeholder anywhere', async () => {
          const { context } = createFakeContext(
            buildPreferences(register, language),
            buildFixtureSnapshot(),
            buildFixtureProvenance(),
          );
          dispose = mountShell(root, context);

          // --- Faceplate: the default main screen (first machine in the snapshot) ---
          expect(doc.querySelector('.cb-panel-frame')).not.toBeNull();
          expect(findMissingPlaceholders(root)).toEqual([]);

          // --- Balance panel: always mounted in the aside slot ------------------------
          const balanceSection = doc.querySelector('.cb-provenance-balance');
          expect(balanceSection).not.toBeNull();
          expect(balanceSection?.textContent).toContain('wheat-flour-white');
          expect(findMissingPlaceholders(root)).toEqual([]);

          // --- Provenance tree: reached the same way the command palette reaches it —
          // through `context.reveal`, never by importing the panel directly. ----------
          context.reveal({ kind: 'lot', lotId: FIXTURE_LOT_ID });
          await flushAsyncWork();
          const treeItems = doc.querySelectorAll('[role="treeitem"]');
          expect(treeItems.length).toBeGreaterThan(0);
          expect(doc.body.textContent).toContain('Bread Loaf Lot 0001');
          expect(findMissingPlaceholders(doc.body)).toEqual([]);

          // --- Settings, reached the same way ------------------------------------------
          context.reveal({ kind: 'panel', panelId: 'settings' });
          expect(doc.querySelector('.cb-shell-settings')).not.toBeNull();
          expect(findMissingPlaceholders(doc.body)).toEqual([]);

          // --- Back to a specific machine's alarm and a tag on the other machine ------
          context.reveal({ kind: 'alarm', machineId: FIXTURE_MACHINE_OVEN_ID, alarmId: FIXTURE_ALARM_ID });
          expect(findMissingPlaceholders(doc.body)).toEqual([]);

          context.reveal({ kind: 'tag', machineId: FIXTURE_MACHINE_MIXER_ID, tagId: 'bowl-speed' });
          expect(findMissingPlaceholders(doc.body)).toEqual([]);

          // The global annunciator reflects the fixture's one active-unacknowledged
          // alarm — real state, not a placeholder, reaching the header from the
          // machine three screens away.
          const annunciator = doc.querySelector('.cb-shell-header__annunciator');
          expect(annunciator?.getAttribute('data-state')).toBe('active-unacknowledged');
        });

        it('tears down cleanly without throwing', () => {
          const { context } = createFakeContext(
            buildPreferences(register, language),
            buildFixtureSnapshot(),
            buildFixtureProvenance(),
          );
          const teardown = mountShell(root, context);
          expect(() => teardown()).not.toThrow();
          expect(root.querySelector('.cb-shell')).toBeNull();
        });
      });
    }
  }

  /**
   * The fault surface, mounted alongside the real shell the same way `renderer/main.ts`
   * assembles them (`main.ts` owns that wiring; not this task's path — see
   * `shell/layout.ts`'s own doc comment for why the shell never mounts it itself). This
   * is the closest this smoke test can get to the real app's assembled DOM tree, and it
   * is what proves the two false-positive shapes this task exists to fix: a heartbeat
   * gap never produces the "books stopped balancing" overlay, and only a real
   * `kind: 'conservation'` `FaultReport` does.
   */
  describe('fault surface, mounted the way main.ts assembles it', () => {
    afterEach(() => {
      delete (window as unknown as { bakery?: unknown }).bakery;
      vi.useRealTimers();
    });

    it('a heartbeat gap never shows the conservation overlay, and a real conservation fault does', () => {
      vi.useFakeTimers();
      let faultListener: ((fault: FaultReport) => void) | null = null;
      (window as unknown as { bakery: { onFault: (l: (fault: FaultReport) => void) => () => void } }).bakery = {
        onFault: (listener) => {
          faultListener = listener;
          return () => {
            faultListener = null;
          };
        },
      };

      const { context } = createFakeContext(
        buildPreferences('panel', 'en'),
        buildFixtureSnapshot(),
        buildFixtureProvenance(),
      );
      const faultSurface = createFaultSurface({ t: context.t, announce: context.announce });
      faultSurface.mount(root);
      const disposeShell = mountShell(root, context);

      // A long silence — nothing pushes a snapshot into the surface at all here — must
      // never latch the permanent overlay, only the small transport notice.
      faultSurface.noteSnapshotReceived();
      vi.advanceTimersByTime(80_000);
      expect(root.querySelector('.cb-shell-fault')?.hasAttribute('hidden')).toBe(true);
      expect(root.querySelector('.cb-shell-transport')?.hasAttribute('hidden')).toBe(false);
      expect(findMissingPlaceholders(root)).toEqual([]);

      // A real conservation fault, delivered the real way (`window.bakery.onFault`),
      // does latch the overlay — with real, non-empty, non-placeholder detail text.
      expect(faultListener).not.toBeNull();
      faultListener?.({ kind: 'conservation', message: 'el:C residual 5', tick: 3 });

      const overlay = root.querySelector('.cb-shell-fault');
      expect(overlay?.hasAttribute('hidden')).toBe(false);
      const detail = root.querySelector('.cb-shell-fault__detail');
      expect(detail?.textContent).toBe('el:C residual 5');
      expect(findMissingPlaceholders(root)).toEqual([]);

      disposeShell();
      faultSurface.dispose();
    });
  });
});
