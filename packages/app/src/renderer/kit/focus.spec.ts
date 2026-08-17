import { describe, expect, it } from 'vitest';

import { focusVisibly, isFocusableElement, trapFocus } from './focus.js';
import { FakeDocument, FakeElement, FakeEvent } from './testSupport/fakeDom.js';

describe('isFocusableElement', () => {
  it('accepts a plain button', () => {
    expect(isFocusableElement(new FakeElement('button') as unknown as Element)).toBe(true);
  });

  it('rejects a disabled button', () => {
    const node = new FakeElement('button');
    node.setAttribute('disabled', '');
    expect(isFocusableElement(node as unknown as Element)).toBe(false);
  });

  it('rejects a hidden element', () => {
    const node = new FakeElement('input');
    node.setAttribute('hidden', '');
    expect(isFocusableElement(node as unknown as Element)).toBe(false);
  });

  it('rejects aria-hidden="true"', () => {
    const node = new FakeElement('button');
    node.setAttribute('aria-hidden', 'true');
    expect(isFocusableElement(node as unknown as Element)).toBe(false);
  });

  it('rejects an anchor with no href', () => {
    const node = new FakeElement('a');
    expect(isFocusableElement(node as unknown as Element)).toBe(false);
  });

  it('accepts an anchor with an href', () => {
    const node = new FakeElement('a');
    node.setAttribute('href', '#panel');
    expect(isFocusableElement(node as unknown as Element)).toBe(true);
  });

  it('rejects a div with no tabindex', () => {
    expect(isFocusableElement(new FakeElement('div') as unknown as Element)).toBe(false);
  });

  it('accepts a div with tabindex="0"', () => {
    const node = new FakeElement('div');
    node.setAttribute('tabindex', '0');
    expect(isFocusableElement(node as unknown as Element)).toBe(true);
  });

  it('rejects an element with tabindex="-1"', () => {
    const node = new FakeElement('div');
    node.setAttribute('tabindex', '-1');
    expect(isFocusableElement(node as unknown as Element)).toBe(false);
  });
});

/** Build container > [btnA, disabledBtn, btnB] inside `doc`, and return the pieces. */
function buildTrapFixture(doc: FakeDocument) {
  const outside = doc.createElement('button');
  outside.focus();

  const container = doc.createElement('div');
  const btnA = doc.createElement('button');
  const disabledBtn = doc.createElement('button');
  disabledBtn.setAttribute('disabled', '');
  const btnB = doc.createElement('button');
  container.append(btnA, disabledBtn, btnB);

  return { outside, container, btnA, disabledBtn, btnB };
}

function tab(container: FakeElement, shiftKey = false): void {
  container.dispatchEvent(new FakeEvent('keydown', { key: 'Tab', shiftKey }));
}

describe('trapFocus', () => {
  it('focuses the first focusable descendant on creation', () => {
    const doc = new FakeDocument();
    const { container, btnA } = buildTrapFixture(doc);

    trapFocus(container as unknown as HTMLElement);

    expect(doc.activeElement).toBe(btnA);
  });

  it('skips disabled elements when choosing the initial focus and when cycling', () => {
    const doc = new FakeDocument();
    const { container, btnA, btnB } = buildTrapFixture(doc);
    trapFocus(container as unknown as HTMLElement);

    doc.activeElement = btnA;
    tab(container); // btnA is not last (btnB is, disabled is skipped) — no wrap yet.
    expect(doc.activeElement).toBe(btnA);

    doc.activeElement = btnB;
    tab(container); // btnB is last focusable — wraps to the first.
    expect(doc.activeElement).toBe(btnA);
  });

  it('wraps Tab from the last focusable element to the first', () => {
    const doc = new FakeDocument();
    const { container, btnA, btnB } = buildTrapFixture(doc);
    trapFocus(container as unknown as HTMLElement);
    doc.activeElement = btnB;

    tab(container);

    expect(doc.activeElement).toBe(btnA);
  });

  it('wraps Shift+Tab from the first focusable element to the last', () => {
    const doc = new FakeDocument();
    const { container, btnA, btnB } = buildTrapFixture(doc);
    trapFocus(container as unknown as HTMLElement);
    doc.activeElement = btnA;

    tab(container, true);

    expect(doc.activeElement).toBe(btnB);
  });

  it('does nothing when Tab is pressed away from a boundary', () => {
    const doc = new FakeDocument();
    const container = doc.createElement('div');
    const btnA = doc.createElement('button');
    const btnB = doc.createElement('button');
    const btnC = doc.createElement('button');
    container.append(btnA, btnB, btnC);
    trapFocus(container as unknown as HTMLElement);
    doc.activeElement = btnB;

    tab(container);

    // The middle of the trap is left to the browser's own Tab order; the trap only
    // intervenes at the boundaries, so `btnB` (an untouched value) proves nothing fired.
    expect(doc.activeElement).toBe(btnB);
  });

  it('falls back to focusing the container itself when nothing inside is focusable', () => {
    const doc = new FakeDocument();
    const container = doc.createElement('div');
    const disabledOnly = doc.createElement('button');
    disabledOnly.setAttribute('disabled', '');
    container.append(disabledOnly);

    trapFocus(container as unknown as HTMLElement);

    expect(doc.activeElement).toBe(container);
  });

  it('restores focus to whatever was focused before the trap, by default, on dispose', () => {
    const doc = new FakeDocument();
    const { outside, container } = buildTrapFixture(doc);

    const dispose = trapFocus(container as unknown as HTMLElement);
    expect(doc.activeElement).not.toBe(outside);

    dispose();

    expect(doc.activeElement).toBe(outside);
  });

  it('restores focus to an explicit restoreFocusTo element instead', () => {
    const doc = new FakeDocument();
    const { container } = buildTrapFixture(doc);
    const explicitTarget = doc.createElement('button');

    const dispose = trapFocus(container as unknown as HTMLElement, {
      restoreFocusTo: explicitTarget as unknown as HTMLElement,
    });
    dispose();

    expect(doc.activeElement).toBe(explicitTarget);
  });

  it('does not restore focus when restoreFocusTo is explicitly null', () => {
    const doc = new FakeDocument();
    const { container, btnA } = buildTrapFixture(doc);

    const dispose = trapFocus(container as unknown as HTMLElement, { restoreFocusTo: null });
    dispose();

    // Focus stays wherever it was left inside the trap (the initial focus target),
    // rather than jumping anywhere.
    expect(doc.activeElement).toBe(btnA);
  });

  it('honours an explicit initialFocus target', () => {
    const doc = new FakeDocument();
    const { container, btnB } = buildTrapFixture(doc);

    trapFocus(container as unknown as HTMLElement, { initialFocus: btnB as unknown as HTMLElement });

    expect(doc.activeElement).toBe(btnB);
  });

  it('stops listening for Tab after dispose', () => {
    const doc = new FakeDocument();
    const { outside, container, btnB } = buildTrapFixture(doc);
    const dispose = trapFocus(container as unknown as HTMLElement);
    doc.activeElement = btnB;

    dispose();
    tab(container);

    // The listener was removed, so the boundary-wrap logic must not have fired again —
    // focus is exactly whatever dispose() left it as (restored to the pre-trap focus),
    // not wrapped back to the first element in the trap.
    expect(doc.activeElement).toBe(outside);
  });
});

describe('focusVisibly', () => {
  it('focuses the element and scrolls it into view', () => {
    const node = new FakeElement('button', new FakeDocument());

    focusVisibly(node as unknown as HTMLElement);

    expect(node.focusCalls).toBe(1);
    expect(node.scrollIntoViewCalls).toBe(1);
  });
});
