/**
 * The fault surface: what the window shows when it can no longer trust the world.
 *
 * `simulationHost.ts`'s own comment is explicit that a conservation failure "is not a
 * recoverable condition" and that the honest response is to "stop and say so rather
 * than keep drawing a factory whose books do not close." This module is that response
 * at the window level: an unmissable, permanent, `role="alert"` banner, plus disabling
 * the rest of the shell (`data-fault="true"` on the root — see `styles/shell.css`) so
 * a player cannot keep issuing commands into a world that has already stopped.
 *
 * ## Why this listens for command rejections and a snapshot heartbeat, not a `fault`
 * event
 *
 * `SimulationHost` (owned by `main/simulationHost.ts`, outside this task's path)
 * already emits a `'fault'` event with the real message — but `main/main.ts` (also
 * outside this task's path) never forwards it across `ipcMain`/`preload.cts`, and
 * `shared/ipc.ts`'s `RendererApi` has no channel for it at all. That is a gap in the
 * shared contract, not something this module can close without touching paths this
 * task does not own (see this task's final report). Two things the renderer *can*
 * observe without a new channel stand in for it:
 *
 *  1. `context.send()` rejecting. `SimulationHost#request` rejects every in-flight
 *     and every future request once the worker thread has exited — a rejection here is
 *     therefore a reliable, if generic, signal that the world is gone.
 *  2. The snapshot heartbeat. `sim-worker/worker.ts` publishes a snapshot roughly
 *     every 100ms *regardless of speed*, even while paused — see that file's own
 *     `PUBLISH_INTERVAL_MS` comment. A long silence after having received at least one
 *     snapshot means the worker's frame loop has stopped, which is exactly what a
 *     fault does (`worker.ts`'s own `fault()` helper calls `clearInterval`).
 */

import type { Announce, Translate } from '../context.js';
import { el } from '../kit/dom.js';

/**
 * The only two `RendererContext` members this module needs, taken directly rather than
 * the whole context — `main.ts` constructs the fault surface *before* the rest of
 * `RendererContext` exists (`context.send`/`context.provenance` need to be able to
 * report into it), so requiring the full interface here would be circular.
 */
export interface FaultSurfaceDeps {
  readonly t: Translate;
  readonly announce: Announce;
}

/** Generous relative to the ~100ms publish interval, so ordinary event-loop jitter (a
 * slow paint, a GC pause) never false-positives this into a fault the player did not
 * actually have. */
const HEARTBEAT_TIMEOUT_MS = 5000;
const HEARTBEAT_CHECK_INTERVAL_MS = 1000;

export interface FaultSurface {
  /** Mount the (initially hidden) banner and start watching for a fault. */
  readonly mount: (root: HTMLElement) => void;
  /** Report a fault directly — used by `main.ts`'s `context.send` wrapper the moment a
   * command rejects. Idempotent: the first report wins, since a fault is not something
   * a later, possibly-contradictory signal should ever soften. */
  readonly report: (message: string) => void;
  readonly isFaulted: () => boolean;
  readonly noteSnapshotReceived: () => void;
  readonly dispose: () => void;
}

export function createFaultSurface(context: FaultSurfaceDeps): FaultSurface {
  const overlay = el('div', {
    class: 'cb-shell-fault',
    attrs: { role: 'alert', 'aria-labelledby': 'shell-fault-title' },
  });
  const title = el('h2', { class: 'cb-shell-fault__title', attrs: { id: 'shell-fault-title' } });
  const body = el('p', { class: 'cb-shell-fault__body' });
  const detail = el('p', { class: 'cb-shell-fault__detail' });
  overlay.append(title, body, detail);
  overlay.hidden = true;

  let faulted = false;
  let lastSnapshotAtMs: number | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let hostRoot: HTMLElement | null = null;

  function applyCopy(): void {
    title.textContent = context.t('shell.fault.title');
    body.textContent = context.t('shell.fault.body');
  }

  function report(message: string): void {
    if (faulted) return;
    faulted = true;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    applyCopy();
    detail.textContent = message;
    overlay.hidden = false;
    hostRoot?.setAttribute('data-fault', 'true');
    context.announce(`${context.t('shell.fault.title')}: ${message}`, 'assertive');
  }

  // `Date.now()` below only times this renderer-local liveness watchdog — never
  // simulation state, never replayed, never fed back into the world — the same
  // category CLAUDE.md's determinism rule already allows for "a display-only clock":
  // compare `sim-worker/worker.ts`'s own `Date.now()` use for its publish cadence.
  function noteSnapshotReceived(): void {
    lastSnapshotAtMs = Date.now();
  }

  function checkHeartbeat(): void {
    if (faulted || lastSnapshotAtMs === null) return;
    if (Date.now() - lastSnapshotAtMs > HEARTBEAT_TIMEOUT_MS) {
      report(context.t('shell.fault.heartbeatLost'));
    }
  }

  return {
    mount: (root: HTMLElement) => {
      hostRoot = root.ownerDocument?.body ?? root;
      root.append(overlay);
      applyCopy();
      heartbeatTimer = setInterval(checkHeartbeat, HEARTBEAT_CHECK_INTERVAL_MS);
    },
    report,
    isFaulted: () => faulted,
    noteSnapshotReceived,
    dispose: () => {
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      overlay.remove();
    },
  };
}
