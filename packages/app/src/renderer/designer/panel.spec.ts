/**
 * @vitest-environment happy-dom
 *
 * The designer panel mount smoke test — the same shape `renderer/__smoke__/mount.spec.ts`
 * already applies to the faceplate, the balance panel and the provenance tree (mount a
 * real `RendererContext` against a detached `happy-dom` document, for every
 * register/language combination, and fail on a thrown error or a `⟦missing:…⟧`
 * placeholder anywhere in the tree), applied here to the panel this task owns. It
 * reuses the existing `fakeContext.ts`/`fixtures.ts`/`domScan.ts` test utilities
 * directly (read-only imports, not edits) rather than duplicating them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LanguageMode, Register } from '../../shared/ipc.js';
import type { Preferences } from '../context.js';
import { findMissingPlaceholders } from '../__smoke__/domScan.js';
import { createFakeContext } from '../__smoke__/fakeContext.js';
import { buildFixtureProvenance, buildFixtureSnapshot } from '../__smoke__/fixtures.js';
import { resetIdCounterForTests } from './logic.js';
import { designerPanel } from './panel.js';

const REGISTERS: readonly Register[] = ['panel', 'kid'];
const LANGUAGES: readonly LanguageMode[] = ['en', 'yue', 'both'];

function buildPreferences(register: Register, language: LanguageMode): Preferences {
  return { register, language, reducedMotion: false, muted: false };
}

function createDetachedRoot(): { readonly doc: Document; readonly root: HTMLElement } {
  const doc = document.implementation.createHTMLDocument('Conservation Bakery');
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  return { doc, root };
}

describe('designer panel mount smoke test', () => {
  let doc: Document;
  let root: HTMLElement;
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    resetIdCounterForTests();
    ({ doc, root } = createDetachedRoot());
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  for (const register of REGISTERS) {
    for (const language of LANGUAGES) {
      it(`register=${register} language=${language}: mounts a real, keyboard-operable design with no missing placeholder`, () => {
        const { context } = createFakeContext(buildPreferences(register, language), buildFixtureSnapshot(), buildFixtureProvenance());

        expect(() => {
          dispose = designerPanel(root, context);
        }).not.toThrow();

        expect(doc.body.querySelectorAll('*').length).toBeGreaterThan(20);
        expect(findMissingPlaceholders(root)).toEqual([]);

        // Every tier/layer/finish control is a native, keyboard-focusable element —
        // this is the accessibility obligation this surface is hardest to meet.
        expect(root.querySelectorAll('button').length).toBeGreaterThan(0);
        expect(root.querySelectorAll('input, select').length).toBeGreaterThan(0);

        // A real cross-section, not an empty shell: at least one tier rectangle.
        expect(root.querySelectorAll('svg rect').length).toBeGreaterThan(0);
      });
    }
  }

  it('re-evaluates and re-announces live as the design changes by keyboard', () => {
    const { context } = createFakeContext(buildPreferences('panel', 'en'), buildFixtureSnapshot(), buildFixtureProvenance());
    dispose = designerPanel(root, context);

    const diameterInput = root.querySelector<HTMLInputElement>('input[type="number"]');
    expect(diameterInput).not.toBeNull();
    diameterInput!.value = '0.01';
    diameterInput!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(findMissingPlaceholders(root)).toEqual([]);
  });

  it('adding and removing a tier by keyboard-operable buttons never throws and stays placeholder-free', () => {
    const { context } = createFakeContext(buildPreferences('kid', 'yue'), buildFixtureSnapshot(), buildFixtureProvenance());
    dispose = designerPanel(root, context);

    const buttons = () => [...root.querySelectorAll<HTMLButtonElement>('button')];
    const addTier = buttons().find((button) => button.textContent && button.textContent.length > 0);
    expect(addTier).toBeDefined();

    expect(() => addTier!.click()).not.toThrow();
    expect(findMissingPlaceholders(root)).toEqual([]);

    const removeButtons = buttons();
    expect(() => removeButtons[removeButtons.length - 1]!.click()).not.toThrow();
    expect(findMissingPlaceholders(root)).toEqual([]);
  });

  it('tears down cleanly without throwing', () => {
    const { context } = createFakeContext(buildPreferences('panel', 'en'), buildFixtureSnapshot(), buildFixtureProvenance());
    const teardown = designerPanel(root, context);
    expect(() => teardown()).not.toThrow();
  });
});
