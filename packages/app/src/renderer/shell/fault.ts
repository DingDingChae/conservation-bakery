/**
 * The fault surface: what the window shows when it can no longer trust the world, and
 * the transport notice: what it shows when it has merely stopped *hearing* from the
 * world for a little while.
 *
 * These are deliberately two different, differently-shaped things — see
 * `shared/ipc.ts`'s own `FaultKind` doc comment for why conflating them is a real
 * failure mode this product already shipped once: a window that had only stopped
 * *hearing* from the simulation (a slow frame, a GC pause, a loaded machine) told the
 * player the world's books had stopped balancing. That is the worst possible failure of
 * honesty in a product whose entire claim is that its books close, so this module now
 * keeps the two clearly apart:
 *
 *  - The **fault overlay** (`.cb-shell-fault`): an unmissable, permanent, `role="alert"`
 *    banner, plus disabling the rest of the shell (`data-fault="true"` on the root — see
 *    `styles/shell.css`) so a player cannot keep issuing commands into a world that has
 *    already stopped. `report()` is idempotent and *never* un-latches: once the world is
 *    not trustworthy, no later, possibly-contradictory signal should ever soften that.
 *    Only a real `FaultReport` of `kind: 'conservation'` (see below), or a confirmed
 *    infrastructure failure (a rejected command/provenance request — see
 *    `shell/logic.ts`'s `isInfrastructureFailureMessage`), may ever reach `report()`.
 *  - The **transport notice** (`.cb-shell-transport`): a small, non-blocking, polite
 *    `role="status"` indicator that says the window is not currently receiving updates.
 *    It never latches, never disables anything, never takes focus, and clears itself
 *    the instant a snapshot arrives (`noteSnapshotReceived`). It is exactly what the
 *    heartbeat timeout used to feed into `report()` — see the git history of this file
 *    for the false positive this replaced.
 *
 * ## Real faults: `RendererApi.onFault`
 *
 * `main/main.ts` forwards `SimulationHost`'s `'fault'` event over `IPC.faultPush`, and
 * `main/preload.cts` exposes it as `window.bakery.onFault`. This module reaches that
 * bridge directly — the same way `renderer/main.ts` reaches `window.bakery` for
 * snapshots and commands — rather than through `RendererContext`, which does not carry
 * it yet (a gap in the shared contract this task does not own the fix for). Per
 * `shared/ipc.ts`'s own `FaultKind` doc comment, only `kind: 'conservation'` may ever
 * reach `report()` from this channel: that is the one kind whose message is guaranteed
 * to be about the ledger, not about the transport. A `kind: 'worker'` report is real and
 * serious, but is not routed to this specific "books stopped balancing" surface by this
 * module — the existing infrastructure-failure path (a rejected `context.send()`, see
 * `shell/logic.ts`) already reaches `report()` for a worker that has gone away, with its
 * own, non-conservation-specific detail text.
 *
 * ## The detail line must never render empty
 *
 * `report(message)`'s `message` is whatever the caller happened to have on hand — an
 * `Error#message` crossing `ipcMain`/`preload.cts`, or a real `FaultReport.message`.
 * Either can end up empty in practice: Electron rethrows a rejection in the main process
 * as a plain `Error`, and `new Error()` with no argument has `message === ''`, which
 * survives the `error instanceof Error ? error.message : String(error)` fallback in
 * `main.ts`'s `send()` wrapper untouched. An empty `detail.textContent` is
 * indistinguishable, at a glance and to a screen reader, from a real CSS bug: a real red
 * box with real padding and simply nothing legible inside it. Since the detail line is
 * the one *actionable* diagnostic this surface carries, it falls back to a translated
 * placeholder rather than ever rendering blank — see `applyDetail` below.
 *
 * A later investigation (this task) rebuilt the app and re-rendered `report()`'s output
 * in a real Chromium/Electron window, through the *actual* compiled `shell.css` cascade
 * (all fourteen linked stylesheets, not just this one), for a real message, the
 * empty-message fallback, and the real heartbeat/conservation-length copy, in the dark
 * colour scheme — `getComputedStyle` on `.cb-shell-fault__detail` showed the expected
 * `background-color` (`--cb-color-safety-red`), the expected, contrasting `color`
 * (`--cb-color-on-safety`), and a non-empty text node in every case; nothing reproduced
 * a blank box against the current source. `styles/faultDetail.spec.ts` now pins the one
 * thing a jsdom-based test genuinely cannot see — that `color` and `background` are
 * declared, non-empty, and never resolve to the same custom-property token for this
 * selector in `shell.css` — as a static regression guard `happy-dom` cannot provide
 * (jsdom/happy-dom have no CSS cascade or paint at all, so `fault.spec.ts` below cannot
 * catch a real stylesheet regression by itself). `shell.css` also now redeclares
 * `color`/`background` directly on `.cb-shell-fault__detail`'s own rule, redundant with
 * the shared block today, so the two can never silently drift apart in a future edit
 * without a rule still setting both right there.
 */

import type { Announce, Translate } from '../context.js';
import type { FaultReport, RendererApi } from '../../shared/ipc.js';
import { el } from '../kit/dom.js';

declare global {
  interface Window {
    /** Exposed by `main/preload.cts`. See `renderer/main.ts`'s own identical
     * declaration — duplicated here because this module reaches the bridge directly
     * (see the module doc comment) rather than through `RendererContext`, which does
     * not carry `onFault` yet. Absent only if the preload script itself failed to run. */
    readonly bakery?: RendererApi;
  }
}

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

/**
 * How long a gap since the last snapshot before the transport notice appears.
 *
 * The worker publishes roughly ten snapshots a second — `PUBLISH_INTERVAL_MS = 100` in
 * `sim-worker/worker.ts` — regardless of speed, even while paused. Eight seconds is
 * therefore around eighty consecutive missed publishes: far more than a slow paint or a
 * GC pause on a loaded machine could plausibly explain (this was raised from an earlier
 * 5000ms specifically because a busy real machine was seen to cross that shorter bound
 * on an otherwise perfectly healthy run), while still being short enough that a player
 * who really has lost the simulation finds out within single-digit seconds rather than
 * staring at a frozen clock indefinitely. Crossing it is a hiccup worth a quiet,
 * self-clearing note, never a "the world is broken" verdict — see the module doc
 * comment for why that distinction is the whole point of this file.
 */
const HEARTBEAT_TIMEOUT_MS = 8000;
const HEARTBEAT_CHECK_INTERVAL_MS = 1000;

export interface FaultSurface {
  /** Mount the (initially hidden) banner and transport notice, and start watching for
   * both a heartbeat gap and a real fault report. */
  readonly mount: (root: HTMLElement) => void;
  /** Report a real, unrecoverable fault — used by `main.ts`'s `context.send` wrapper
   * the moment a command rejects, and by this module's own `window.bakery.onFault`
   * subscription for a real `kind: 'conservation'` report. Idempotent: the first report
   * wins, since a fault is not something a later, possibly-contradictory signal should
   * ever soften. */
  readonly report: (message: string) => void;
  readonly isFaulted: () => boolean;
  /** Whether the non-latching transport notice is currently showing. Exposed for
   * tests; nothing in this module needs to read it back. */
  readonly isTransportNoticeVisible: () => boolean;
  readonly noteSnapshotReceived: () => void;
  readonly dispose: () => void;
}

export function createFaultSurface(context: FaultSurfaceDeps): FaultSurface {
  const overlay = el('div', {
    class: 'cb-shell-fault',
    // `tabindex="-1"` makes the overlay itself a valid, if unusual, focus target: not
    // in the normal Tab order, but reachable via `.focus()` the instant a fault
    // latches, so a keyboard or screen-reader user lands directly on the alert rather
    // than only hearing it announced (see `report`, below) — the assertive live
    // announcement and the focus move are deliberately both present, since a screen
    // reader user who was mid-navigation elsewhere gets the announcement either way,
    // while a sighted keyboard user with no screen reader running only gets the
    // second.
    attrs: { role: 'alert', 'aria-labelledby': 'shell-fault-title', tabindex: '-1' },
  });
  const title = el('h2', { class: 'cb-shell-fault__title', attrs: { id: 'shell-fault-title' } });
  const body = el('p', { class: 'cb-shell-fault__body', attrs: { id: 'shell-fault-body' } });
  const detail = el('p', { class: 'cb-shell-fault__detail', attrs: { id: 'shell-fault-detail' } });
  overlay.setAttribute('aria-describedby', 'shell-fault-body shell-fault-detail');
  overlay.append(title, body, detail);
  overlay.hidden = true;

  // The transport notice: `role="status"` (an implicit polite, atomic live region) is
  // the deliberate opposite of the overlay's `role="alert"` above — this is routine
  // information a screen reader user should hear once, calmly, not an interruption.
  // No `tabindex`, no `.focus()` anywhere in this module: it must never steal focus or
  // block interaction, per this module's own doc comment.
  const transportNotice = el('p', {
    class: 'cb-shell-transport',
    attrs: { role: 'status' },
  });
  transportNotice.hidden = true;

  let faulted = false;
  let transportNoticeVisible = false;
  let lastSnapshotAtMs: number | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeFault: (() => void) | null = null;
  let hostRoot: HTMLElement | null = null;

  function applyCopy(): void {
    title.textContent = context.t('shell.fault.title');
    body.textContent = context.t('shell.fault.body');
  }

  /** The one actionable diagnostic this surface carries must never be a box with
   * nothing legible in it — see the module doc comment's "the detail line must never
   * render empty". `message.trim()` also catches a message that is present but
   * whitespace-only, which would otherwise look identical to genuinely empty. Returns
   * the text actually shown, so `report` can announce exactly that (not the possibly
   * empty original `message`). */
  function applyDetail(message: string): string {
    const shown = message.trim().length > 0 ? message : context.t('shell.fault.detailUnavailable');
    detail.textContent = shown;
    return shown;
  }

  function report(message: string): void {
    if (faulted) return;
    faulted = true;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    // A real fault supersedes the transport notice entirely — the overlay below
    // already says everything the notice would have, and disables the rest of the
    // shell besides, so there is nothing left for the smaller notice to add.
    hideTransportNotice();
    applyCopy();
    const shownDetail = applyDetail(message);
    overlay.hidden = false;
    hostRoot?.setAttribute('data-fault', 'true');
    // Move focus to the alert itself, in addition to the assertive announcement below
    // — see the module doc comment on `tabindex="-1"` above for why both matter.
    overlay.focus();
    context.announce(`${context.t('shell.fault.title')}: ${shownDetail}`, 'assertive');
  }

  /** The only thing that may ever call `report()` from `window.bakery.onFault` — see
   * the module doc comment for why `kind: 'worker'` is deliberately excluded here. */
  function handleFaultReport(fault: FaultReport): void {
    if (fault.kind !== 'conservation') return;
    report(fault.message);
  }

  function showTransportNotice(): void {
    if (faulted || transportNoticeVisible) return;
    transportNoticeVisible = true;
    transportNotice.textContent = context.t('shell.fault.heartbeatLost');
    transportNotice.hidden = false;
  }

  function hideTransportNotice(): void {
    if (!transportNoticeVisible) return;
    transportNoticeVisible = false;
    transportNotice.hidden = true;
  }

  // `Date.now()` below only times this renderer-local liveness watchdog — never
  // simulation state, never replayed, never fed back into the world — the same
  // category CLAUDE.md's determinism rule already allows for "a display-only clock":
  // compare `sim-worker/worker.ts`'s own `Date.now()` use for its publish cadence.
  function noteSnapshotReceived(): void {
    lastSnapshotAtMs = Date.now();
    // Self-clears the instant a snapshot arrives, not merely the next time the
    // interval below happens to tick — a real snapshot is unambiguous proof the
    // transport is alive again right now.
    hideTransportNotice();
  }

  function checkHeartbeat(): void {
    if (faulted || lastSnapshotAtMs === null) return;
    if (Date.now() - lastSnapshotAtMs > HEARTBEAT_TIMEOUT_MS) {
      showTransportNotice();
    }
  }

  return {
    mount: (root: HTMLElement) => {
      hostRoot = root.ownerDocument?.body ?? root;
      root.append(overlay, transportNotice);
      // Deliberately not populated here. `report()` applies the copy at the moment a
      // real fault arrives, so filling in "the world's books have stopped balancing"
      // at mount would put that sentence in the document of a perfectly healthy world,
      // waiting to be read by anything that walks the DOM.
      heartbeatTimer = setInterval(checkHeartbeat, HEARTBEAT_CHECK_INTERVAL_MS);
      // See the module doc comment: reaches `window.bakery` directly, the same way
      // `renderer/main.ts` does, because `RendererContext` does not carry `onFault`.
      // Absent (`undefined`) whenever there is no bridge at all, or in a test that
      // never sets `window.bakery` — either way, real faults simply do not arrive on
      // this channel, which is correct: `main.ts`'s own `!window.bakery` guard already
      // reports `shell.fault.noBridge` through the ordinary `report()` path in that
      // case.
      unsubscribeFault = window.bakery?.onFault(handleFaultReport) ?? null;
    },
    report,
    isFaulted: () => faulted,
    isTransportNoticeVisible: () => transportNoticeVisible,
    noteSnapshotReceived,
    dispose: () => {
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      unsubscribeFault?.();
      overlay.remove();
      transportNotice.remove();
    },
  };
}
