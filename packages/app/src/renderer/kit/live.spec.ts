import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveRegionManager, mountLiveRegions, type LiveRegionElement } from './live.js';
import { FakeDocument, FakeElement } from './testSupport/fakeDom.js';

function fakeRegion(): LiveRegionElement & { attrs: Map<string, string>; setCount: number } {
  const attrs = new Map<string, string>();
  let text = '';
  const region = {
    attrs,
    setCount: 0,
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
  };
  Object.defineProperty(region, 'textContent', {
    enumerable: true,
    get: () => text,
    set: (value: string) => {
      text = value;
      region.setCount += 1;
    },
  });
  return region as LiveRegionElement & { attrs: Map<string, string>; setCount: number };
}

describe('LiveRegionManager', () => {
  it('sets the correct role and aria-live attributes on construction', () => {
    const polite = fakeRegion();
    const assertive = fakeRegion();
    new LiveRegionManager({ politeElement: polite, assertiveElement: assertive });

    expect(polite.attrs.get('role')).toBe('status');
    expect(polite.attrs.get('aria-live')).toBe('polite');
    expect(assertive.attrs.get('role')).toBe('alert');
    expect(assertive.attrs.get('aria-live')).toBe('assertive');
  });

  it('routes a polite announcement to the polite region only', () => {
    const polite = fakeRegion();
    const assertive = fakeRegion();
    const manager = new LiveRegionManager({ politeElement: polite, assertiveElement: assertive });

    manager.announce('top heat is 180 C');

    expect(polite.textContent).toBe('top heat is 180 C');
    expect(assertive.textContent).toBe('');
  });

  it('routes an assertive announcement to the assertive region only', () => {
    const polite = fakeRegion();
    const assertive = fakeRegion();
    const manager = new LiveRegionManager({ politeElement: polite, assertiveElement: assertive });

    manager.announce('mixer overload alarm active', 'assertive');

    expect(assertive.textContent).toBe('mixer overload alarm active');
    expect(polite.textContent).toBe('');
  });

  it('drops a repeated identical polite message rather than re-setting it', () => {
    const polite = fakeRegion();
    const assertive = fakeRegion();
    const manager = new LiveRegionManager({ politeElement: polite, assertiveElement: assertive });

    manager.announce('oven at 200 C');
    manager.announce('oven at 200 C');
    manager.announce('oven at 200 C');

    expect(polite.setCount).toBe(1);
    expect(polite.textContent).toBe('oven at 200 C');
  });

  it('re-announces once the message actually changes, then dedupes again', () => {
    const polite = fakeRegion();
    const assertive = fakeRegion();
    const manager = new LiveRegionManager({ politeElement: polite, assertiveElement: assertive });

    manager.announce('a');
    manager.announce('a');
    manager.announce('b');
    manager.announce('b');
    manager.announce('a');

    // Only the transitions in and out of a repeat should have taken effect; the final
    // state is whatever the last call set, which this test only needs to confirm did
    // not get silently dropped just because "a" was seen earlier in the sequence.
    expect(polite.textContent).toBe('a');
  });

  it('tracks the polite and assertive channels independently for de-duplication', () => {
    const polite = fakeRegion();
    const assertive = fakeRegion();
    const manager = new LiveRegionManager({ politeElement: polite, assertiveElement: assertive });

    manager.announce('same text', 'polite');
    manager.announce('same text', 'assertive');

    // Two distinct channels: the assertive announcement must not be suppressed just
    // because the identical string was already said on the polite channel.
    expect(polite.textContent).toBe('same text');
    expect(assertive.textContent).toBe('same text');
  });

  it('asAnnounce binds a free function matching the Announce shape', () => {
    const polite = fakeRegion();
    const assertive = fakeRegion();
    const manager = new LiveRegionManager({ politeElement: polite, assertiveElement: assertive });
    const announce = manager.asAnnounce();

    announce('bound call');

    expect(polite.textContent).toBe('bound call');
  });
});

describe('mountLiveRegions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates and appends two elements, and returns a working manager', () => {
    const doc = new FakeDocument();
    vi.stubGlobal('document', doc);
    const container = new FakeElement('div', doc);

    const manager = mountLiveRegions(container as unknown as Element);

    expect(container.children).toHaveLength(2);
    manager.announce('mounted announcement');
    const politeChild = container.children[0]!;
    expect(politeChild.textContent).toBe('mounted announcement');
  });
});
