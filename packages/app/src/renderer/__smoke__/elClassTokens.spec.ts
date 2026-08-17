/**
 * @vitest-environment happy-dom
 *
 * A focused regression test for the crash that took the whole window down: `kit/
 * dom.ts`'s `el()` used to call `classList.add()` with one space-separated string
 * (`'cb-annunciator-tile cb-shell-header__annunciator'`, the ordinary way to write a
 * multi-class spec) — real Chromium's `DOMTokenList.add` throws
 * `InvalidCharacterError` on a token containing a space, and that exception at mount
 * time took the entire renderer tree down with it (see this task's brief and
 * `kit/dom.ts`'s own comment on `el()`, which already fixed the split).
 *
 * `happy-dom`'s `DOMTokenList.add` does not reproduce that throw — it silently
 * tokenizes a multi-word argument itself, so calling it with the *raw*, un-split
 * string still leaves `classList.contains('cb-annunciator-tile')` `true` here even
 * though real Chromium would have already crashed. Asserting on the resulting
 * `classList` state alone would therefore pass whether or not the regression came
 * back. This test instead asserts on the *call itself* — that `el()` never hands
 * `classList.add` a token containing whitespace — which is the one thing that stays
 * true regardless of how lenient a given `DOMTokenList` implementation happens to be.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { el } from '../kit/dom.js';

describe('el() class tokens', () => {
  let addSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const probeClassList = document.createElement('div').classList;
    addSpy = vi.spyOn(Object.getPrototypeOf(probeClassList) as { add: (...tokens: string[]) => void }, 'add');
  });

  afterEach(() => {
    addSpy.mockRestore();
  });

  it('never passes classList.add a token containing whitespace', () => {
    const node = el('div', {
      class: 'cb-annunciator-tile cb-shell-header__annunciator',
    });

    const calls = addSpy.mock.calls as readonly (readonly unknown[])[];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      for (const token of call) {
        expect(typeof token).toBe('string');
        expect(token as string).not.toMatch(/\s/);
      }
    }

    // The real DOM contract still holds: both classes really did get applied.
    expect(node.classList.contains('cb-annunciator-tile')).toBe(true);
    expect(node.classList.contains('cb-shell-header__annunciator')).toBe(true);
  });

  it('splits an array of multi-word class strings the same way', () => {
    const node = el('div', { class: ['a b', '', 'c d e'] });
    for (const className of ['a', 'b', 'c', 'd', 'e']) {
      expect(node.classList.contains(className)).toBe(true);
    }
  });

  it('does not throw when mounting a real annunciator-shaped element (the reported crash)', () => {
    expect(() =>
      el('button', {
        class: 'cb-annunciator-tile cb-shell-header__annunciator',
        attrs: { type: 'button' },
      }),
    ).not.toThrow();
  });
});
