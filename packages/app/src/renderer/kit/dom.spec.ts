import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearChildren, el, mount, setClass, setClasses } from './dom.js';
import { FakeDocument, FakeElement } from './testSupport/fakeDom.js';

describe('el', () => {
  let doc: FakeDocument;

  beforeEach(() => {
    doc = new FakeDocument();
    vi.stubGlobal('document', doc);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates the requested tag', () => {
    const node = el('button') as unknown as FakeElement;
    expect(node.tagName).toBe('BUTTON');
  });

  it('adds a single class', () => {
    const node = el('div', { class: 'cb-panel' }) as unknown as FakeElement;
    expect(node.classList.contains('cb-panel')).toBe(true);
  });

  it('adds several classes and ignores falsy entries', () => {
    const node = el('div', { class: ['a', '', 'b'] }) as unknown as FakeElement;
    expect(node.classList.contains('a')).toBe(true);
    expect(node.classList.contains('b')).toBe(true);
  });

  it('sets attributes', () => {
    const node = el('input', { attrs: { role: 'status', 'aria-live': 'polite' } }) as unknown as FakeElement;
    expect(node.getAttribute('role')).toBe('status');
    expect(node.getAttribute('aria-live')).toBe('polite');
  });

  it('sets dataset entries', () => {
    const node = el('div', { dataset: { machineId: 'oven-1' } }) as unknown as FakeElement;
    expect(node.dataset.machineId).toBe('oven-1');
  });

  it('sets text content', () => {
    const node = el('span', { text: 'TOP HEAT SP' }) as unknown as FakeElement;
    expect(node.textContent).toBe('TOP HEAT SP');
  });

  it('appends children in order', () => {
    const childA = el('span', { text: 'a' });
    const childB = el('span', { text: 'b' });
    const node = el('div', { children: [childA, childB] }) as unknown as FakeElement;
    expect(node.children.map((c) => c.textContent)).toEqual(['a', 'b']);
  });

  it('leaves an empty spec producing a bare element', () => {
    const node = el('div') as unknown as FakeElement;
    expect(node.tagName).toBe('DIV');
    expect(node.textContent).toBe('');
  });
});

describe('setClass / setClasses', () => {
  it('adds when active is true and removes when false', () => {
    const node = new FakeElement('div');
    setClass(node as unknown as Element, 'on', true);
    expect(node.classList.contains('on')).toBe(true);
    setClass(node as unknown as Element, 'on', false);
    expect(node.classList.contains('on')).toBe(false);
  });

  it('applies a whole map in one call', () => {
    const node = new FakeElement('div');
    node.classList.add('stale');
    setClasses(node as unknown as Element, { on: true, stale: false, fresh: true });
    expect(node.classList.contains('on')).toBe(true);
    expect(node.classList.contains('stale')).toBe(false);
    expect(node.classList.contains('fresh')).toBe(true);
  });
});

describe('clearChildren', () => {
  it('removes every child but keeps the node', () => {
    const node = new FakeElement('div');
    node.append(new FakeElement('span'), new FakeElement('span'));
    expect(node.children).toHaveLength(2);
    clearChildren(node as unknown as Node);
    expect(node.children).toHaveLength(0);
  });

  it('is a no-op on a node with no children', () => {
    const node = new FakeElement('div');
    expect(() => clearChildren(node as unknown as Node)).not.toThrow();
  });
});

describe('mount', () => {
  it('replaces existing content with the given children', () => {
    const root = new FakeElement('div');
    root.append(new FakeElement('span'));
    const replacement = new FakeElement('p');
    mount(root as unknown as Element, replacement as unknown as Node);
    expect(root.children).toEqual([replacement]);
  });

  it('leaves the root empty when called with no children', () => {
    const root = new FakeElement('div');
    root.append(new FakeElement('span'));
    mount(root as unknown as Element);
    expect(root.children).toHaveLength(0);
  });
});
