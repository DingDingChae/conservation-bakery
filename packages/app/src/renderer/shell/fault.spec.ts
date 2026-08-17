/**
 * @vitest-environment happy-dom
 *
 * `createFaultSurface`'s own regression test for the empty-detail-box report: the
 * detail line — the one actionable diagnostic on this surface — must never render as
 * a real, correctly-coloured, correctly-sized box with nothing legible inside it (see
 * `fault.ts`'s own module doc comment, and `captures/app/`), and the surface must be
 * reachable by keyboard/screen-reader focus the moment a fault latches, not only by an
 * assertive live-region announcement.
 *
 * Also covers the two things this file's module doc comment calls the whole point of
 * the surface: only a real `kind: 'conservation'` `FaultReport` arriving over
 * `window.bakery.onFault` may ever latch the permanent overlay, and a heartbeat gap —
 * however long — never does, producing only the small, self-clearing transport notice
 * instead.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FaultReport } from '../../shared/ipc.js';
import { createFaultSurface, type FaultSurfaceDeps } from './fault.js';

function fakeDeps(): FaultSurfaceDeps & { readonly announced: { message: string; urgency?: string }[] } {
  const announced: { message: string; urgency?: string }[] = [];
  return {
    t: (key) => `t:${key}`,
    announce: (message, urgency) => {
      announced.push({ message, urgency });
    },
    announced,
  };
}

interface FakeBakeryHandle {
  readonly bakery: { readonly onFault: (listener: (fault: FaultReport) => void) => () => void };
  /** Fire a `FaultReport` at whichever listener `fault.ts` most recently registered —
   * a stand-in for a real `sim:fault:push` IPC message arriving. */
  readonly emit: (fault: FaultReport) => void;
  readonly isUnsubscribed: () => boolean;
}

/** A stand-in for `window.bakery` — just enough of `RendererApi` for this file: a
 * real `preload.cts` bridge exposes far more, but `fault.ts` only ever reaches for
 * `onFault` (see that module's own doc comment for why it reaches `window.bakery`
 * directly rather than through `RendererContext`). */
function fakeBakery(): FakeBakeryHandle {
  let listener: ((fault: FaultReport) => void) | null = null;
  let unsubscribed = false;
  return {
    bakery: {
      onFault: (l) => {
        listener = l;
        return () => {
          unsubscribed = true;
        };
      },
    },
    emit: (fault) => listener?.(fault),
    isUnsubscribed: () => unsubscribed,
  };
}

/** `Window.bakery` is declared `readonly` (see `fault.ts`'s own `declare global`) so a
 * real caller can never reassign it — a test still needs to install and remove the
 * fake bridge around each case that uses one, hence the cast. */
function installBakery(bakery: FakeBakeryHandle['bakery']): void {
  (window as unknown as { bakery?: unknown }).bakery = bakery;
}

function uninstallBakery(): void {
  delete (window as unknown as { bakery?: unknown }).bakery;
}

describe('createFaultSurface', () => {
  afterEach(() => {
    uninstallBakery();
    vi.useRealTimers();
  });

  it('never renders an empty detail line for an empty message', () => {
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const root = document.createElement('div');
    surface.mount(root);

    surface.report('');

    const detail = root.querySelector('.cb-shell-fault__detail');
    expect(detail?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('never renders an empty detail line for a whitespace-only message', () => {
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const root = document.createElement('div');
    surface.mount(root);

    surface.report('   \n\t  ');

    const detail = root.querySelector('.cb-shell-fault__detail');
    expect(detail?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('shows a real message verbatim', () => {
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const root = document.createElement('div');
    surface.mount(root);

    surface.report('the simulation worker is not running');

    const detail = root.querySelector('.cb-shell-fault__detail');
    expect(detail?.textContent).toBe('the simulation worker is not running');
  });

  it('is a role="alert" region, keyboard-focusable, and takes focus on report', () => {
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const root = document.createElement('div');
    document.body.appendChild(root);
    surface.mount(root);

    const overlay = root.querySelector('.cb-shell-fault');
    expect(overlay?.getAttribute('role')).toBe('alert');
    expect(overlay?.getAttribute('tabindex')).toBe('-1');

    surface.report('the simulation worker is not running');

    expect(document.activeElement).toBe(overlay);
    document.body.removeChild(root);
  });

  it('announces assertively using the same non-empty text it renders', () => {
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const root = document.createElement('div');
    surface.mount(root);

    surface.report('');

    expect(deps.announced).toHaveLength(1);
    expect(deps.announced[0]?.urgency).toBe('assertive');
    expect(deps.announced[0]?.message).not.toMatch(/:\s*$/);
  });

  it('is idempotent: a second report never overwrites the first, including with an empty one', () => {
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const root = document.createElement('div');
    surface.mount(root);

    surface.report('the simulation worker is not running');
    surface.report('');

    const detail = root.querySelector('.cb-shell-fault__detail');
    expect(detail?.textContent).toBe('the simulation worker is not running');
  });

  it('a heartbeat gap, however long, never latches the conservation surface', () => {
    vi.useFakeTimers();
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const root = document.createElement('div');
    surface.mount(root);

    surface.noteSnapshotReceived();
    // Ten times the current threshold — not just past it, so this is never a fragile
    // off-by-one against `fault.ts`'s own `HEARTBEAT_TIMEOUT_MS`, and stays true no
    // matter how that constant is retuned in the future.
    vi.advanceTimersByTime(80_000);

    expect(surface.isFaulted()).toBe(false);
    const overlay = root.querySelector('.cb-shell-fault');
    expect(overlay?.hasAttribute('hidden')).toBe(true);
    expect(surface.isTransportNoticeVisible()).toBe(true);
    const notice = root.querySelector('.cb-shell-transport');
    expect(notice?.hasAttribute('hidden')).toBe(false);
    expect(notice?.getAttribute('role')).toBe('status');
  });

  it('the transport notice clears itself the instant a snapshot arrives', () => {
    vi.useFakeTimers();
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const root = document.createElement('div');
    surface.mount(root);

    surface.noteSnapshotReceived();
    vi.advanceTimersByTime(80_000);
    expect(surface.isTransportNoticeVisible()).toBe(true);

    surface.noteSnapshotReceived();

    expect(surface.isTransportNoticeVisible()).toBe(false);
    const notice = root.querySelector('.cb-shell-transport');
    expect(notice?.hasAttribute('hidden')).toBe(true);
    expect(surface.isFaulted()).toBe(false);
  });

  it('a real conservation FaultReport over window.bakery.onFault latches the surface', () => {
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const bridge = fakeBakery();
    installBakery(bridge.bakery);
    const root = document.createElement('div');
    surface.mount(root);

    bridge.emit({ kind: 'conservation', message: "the world's books have stopped balancing", tick: 42 });

    expect(surface.isFaulted()).toBe(true);
    const overlay = root.querySelector('.cb-shell-fault');
    expect(overlay?.hasAttribute('hidden')).toBe(false);
    const detail = root.querySelector('.cb-shell-fault__detail');
    expect(detail?.textContent).toBe("the world's books have stopped balancing");
  });

  it('a worker FaultReport over window.bakery.onFault never latches this surface', () => {
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const bridge = fakeBakery();
    installBakery(bridge.bakery);
    const root = document.createElement('div');
    surface.mount(root);

    bridge.emit({ kind: 'worker', message: 'the simulation worker exited with code 1', tick: 42 });

    expect(surface.isFaulted()).toBe(false);
    const overlay = root.querySelector('.cb-shell-fault');
    expect(overlay?.hasAttribute('hidden')).toBe(true);
  });

  it('unsubscribes from window.bakery.onFault on dispose', () => {
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const bridge = fakeBakery();
    installBakery(bridge.bakery);
    const root = document.createElement('div');
    surface.mount(root);

    surface.dispose();

    expect(bridge.isUnsubscribed()).toBe(true);
  });

  it('the mounted detail line always carries real, non-empty text once faulted', () => {
    const deps = fakeDeps();
    const surface = createFaultSurface(deps);
    const bridge = fakeBakery();
    installBakery(bridge.bakery);
    const root = document.createElement('div');
    surface.mount(root);

    bridge.emit({ kind: 'conservation', message: 'el:C residual 5', tick: 1 });

    const detail = root.querySelector('.cb-shell-fault__detail');
    expect(detail).not.toBeNull();
    expect(detail?.textContent?.trim().length).toBeGreaterThan(0);
  });
});
