/**
 * Faceplate: pure logic.
 *
 * Every function here is deterministic, has no DOM dependency, and takes plain data
 * in and plain data out — formatting, range validation, mode-transition legality and
 * alarm ordering, kept apart from `render.ts` specifically so it can be exercised by
 * `logic.spec.ts` without a DOM. See that file's header for why DOM rendering itself
 * is not under test in this environment.
 *
 * Refusal reasons are returned as small discriminated unions rather than pre-built
 * sentences, so `render.ts` can turn them into real, translatable copy through
 * `context.t` (see `renderer/i18n/catalogue.ts`'s `refusal.*` keys) instead of this
 * module hard-coding English prose that the Kid register could never see.
 *
 * Nothing here touches a conserved quantity (mass, energy, money) — `TagSnapshot`'s
 * `value`/`setpoint`/`rangeLow`/`rangeHigh` are engineering process values (a
 * temperature, a speed), declared as plain `number` in `shared/ipc.ts` itself, not an
 * `ExactString`. CONTRACT.md's "never parse a conserved quantity into a number for
 * display arithmetic" therefore does not apply to them; it is the ledger's own
 * `BalanceRow.residual` (owned by another task's panel) that must stay a string.
 */

import type { AlarmSnapshot, AlarmState, MachineMode } from '../../shared/ipc.js';

// ---------------------------------------------------------------------------
// Mode transitions.
// ---------------------------------------------------------------------------

export const MODE_ORDER: readonly MachineMode[] = ['OFF', 'MANUAL', 'AUTO', 'SERVICE'];

const RUNNING_MODES: ReadonlySet<MachineMode> = new Set<MachineMode>(['MANUAL', 'AUTO']);

/**
 * Mirrors `packages/sim/src/process/machine.ts`'s own `LEGAL_TRANSITIONS` table, so
 * the mode selector can grey out an illegal position before the player ever presses
 * it — CLAUDE.md's "illegal transitions visibly unavailable rather than silently
 * ignored." This is a client-side *prediction* only: `Machine.requestMode` in the
 * simulation worker remains the single source of truth, and `render.ts` still shows
 * and announces whatever reason a real refusal carries, in case this table and the
 * simulation's ever drift apart.
 */
const LEGAL_MODE_TRANSITIONS: Readonly<Record<MachineMode, readonly MachineMode[]>> = {
  OFF: ['MANUAL', 'SERVICE'],
  MANUAL: ['OFF', 'AUTO', 'SERVICE'],
  AUTO: ['OFF', 'MANUAL'],
  SERVICE: ['OFF'],
};

export type ModeRefusal =
  | { readonly kind: 'illegal-transition'; readonly from: MachineMode; readonly to: MachineMode }
  | { readonly kind: 'not-commissioned' };

/**
 * The reason `target` is not selectable right now, or `null` if it is (including
 * `target === current`, which is a no-op rather than a transition). `render.ts` maps
 * the `kind` discriminant onto `refusal.modeTransition` / `refusal.notCommissioned`
 * in `renderer/i18n/catalogue.ts` so the message is real, registered copy.
 */
export function modeTransitionRefusal(
  current: MachineMode,
  target: MachineMode,
  commissioned: boolean,
): ModeRefusal | null {
  if (target === current) return null;
  if (!LEGAL_MODE_TRANSITIONS[current].includes(target)) {
    return { kind: 'illegal-transition', from: current, to: target };
  }
  if (RUNNING_MODES.has(target) && !commissioned) {
    return { kind: 'not-commissioned' };
  }
  return null;
}

/** Whether the mode selector should let the player select `target` right now. */
export function isModeTransitionLegal(current: MachineMode, target: MachineMode, commissioned: boolean): boolean {
  return modeTransitionRefusal(current, target, commissioned) === null;
}

const MODE_CATALOGUE_KEY: Readonly<Record<MachineMode, string>> = {
  OFF: 'mode.off',
  MANUAL: 'mode.manual',
  AUTO: 'mode.auto',
  SERVICE: 'mode.service',
};

/** The shared catalogue key (`renderer/i18n/catalogue.ts`) for a mode's own name —
 * every panel that shows a mode uses the same word for it in the same register. */
export function modeCatalogueKey(mode: MachineMode): string {
  return MODE_CATALOGUE_KEY[mode];
}

// ---------------------------------------------------------------------------
// Numeric formatting. Plain engineering numbers only — see the module header.
// ---------------------------------------------------------------------------

export function formatEngineeringValue(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

export function formatRange(low: number, high: number, decimals = 1): string {
  return `${formatEngineeringValue(low, decimals)}–${formatEngineeringValue(high, decimals)}`;
}

/** Position, as a percentage of the tag's engineering range, for the setpoint/process
 * value readout's decorative bar marker — clamped so a value outside range (which the
 * simulation itself never produces, but a display glitch should never crash over)
 * still lands on the bar rather than off it. */
export function barMarkerPercent(value: number, rangeLow: number, rangeHigh: number): number {
  const span = rangeHigh - rangeLow;
  if (span <= 0) return 0;
  const percent = ((value - rangeLow) / span) * 100;
  return Math.min(100, Math.max(0, percent));
}

// ---------------------------------------------------------------------------
// Setpoint-vs-process-value status. Never colour alone — see design/README.md.
// ---------------------------------------------------------------------------

export type DeviationStatus = 'no-setpoint' | 'within-tolerance' | 'deviation-high' | 'deviation-low';

/** Tolerance band, either side of setpoint, as a fraction of the tag's own
 * engineering range — wide enough that ordinary control noise does not flap the
 * status word tick to tick, narrow enough that a real deviation still reads as one. */
const TOLERANCE_FRACTION_OF_RANGE = 0.02;

export function deviationStatus(
  value: number,
  setpoint: number | null,
  rangeLow: number,
  rangeHigh: number,
): DeviationStatus {
  if (setpoint === null) return 'no-setpoint';
  const tolerance = Math.max(0, rangeHigh - rangeLow) * TOLERANCE_FRACTION_OF_RANGE;
  const delta = value - setpoint;
  if (Math.abs(delta) <= tolerance) return 'within-tolerance';
  return delta > 0 ? 'deviation-high' : 'deviation-low';
}

// ---------------------------------------------------------------------------
// Numeric entry validation. Checked before a `setSetpoint` command is ever sent.
// ---------------------------------------------------------------------------

export type SetpointValidation =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly kind: 'empty' }
  | { readonly ok: false; readonly kind: 'not-a-number' }
  | { readonly ok: false; readonly kind: 'out-of-range'; readonly value: number; readonly low: number; readonly high: number };

export function validateSetpointInput(raw: string, rangeLow: number, rangeHigh: number): SetpointValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, kind: 'empty' };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, kind: 'not-a-number' };
  }
  if (value < rangeLow || value > rangeHigh) {
    return { ok: false, kind: 'out-of-range', value, low: rangeLow, high: rangeHigh };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Alarms: ordering and the one action (if any) each state permits.
// ---------------------------------------------------------------------------

/** Most-urgent-first. An unacknowledged alarm demands attention before an
 * already-acknowledged one, which in turn outranks one merely awaiting reset. */
const ALARM_STATE_URGENCY: Readonly<Record<AlarmState, number>> = {
  'active-unacknowledged': 0,
  'active-acknowledged': 1,
  cleared: 2,
  normal: 3,
};

/**
 * Orders an annunciator strip: the first-out alarm leads (it is, by definition, the
 * one that started the cascade the operator most needs to see first), then by state
 * urgency, then by the alarm's own configured priority, then by id for a stable order
 * between two alarms that tie on everything else.
 */
export function orderAlarms(alarms: readonly AlarmSnapshot[]): readonly AlarmSnapshot[] {
  return [...alarms].sort((a, b) => {
    if (a.firstOut !== b.firstOut) return a.firstOut ? -1 : 1;
    const urgencyDelta = ALARM_STATE_URGENCY[a.state] - ALARM_STATE_URGENCY[b.state];
    if (urgencyDelta !== 0) return urgencyDelta;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });
}

export type AlarmAction = 'acknowledge' | 'reset';

/** The one command a given alarm state accepts right now, or `null` if none does —
 * `normal` and `active-acknowledged` are not actionable, only observable. */
export function availableAlarmAction(state: AlarmState): AlarmAction | null {
  if (state === 'active-unacknowledged') return 'acknowledge';
  if (state === 'cleared') return 'reset';
  return null;
}

const ALARM_STATE_CATALOGUE_KEY: Readonly<Record<AlarmState, string>> = {
  normal: 'alarm.state.normal',
  'active-unacknowledged': 'alarm.state.activeUnacknowledged',
  'active-acknowledged': 'alarm.state.activeAcknowledged',
  cleared: 'alarm.state.cleared',
};

/** The shared catalogue key (`renderer/i18n/catalogue.ts`) for an alarm state's own
 * name — the same word an annunciator tile anywhere in the product uses for it. */
export function alarmStateCatalogueKey(state: AlarmState): string {
  return ALARM_STATE_CATALOGUE_KEY[state];
}

export type AlarmTransitionAnnouncement = 'raised' | 'acknowledged' | 'cleared';

/**
 * What (if anything) should be announced to assistive technology when an alarm's
 * observed state changes from `previous` to `next` between two snapshots — covers a
 * transition the simulation makes on its own (a condition tripping or clearing), not
 * only one the player caused by pressing acknowledge/reset (which `render.ts`
 * announces directly from the command's own result). Returns `null` for a pair that
 * is not a real transition (including the first snapshot, where there is no
 * `previous`) or one this faceplate does not narrate (e.g. a step *within*
 * `active-unacknowledged` while the underlying condition flickers).
 */
export function alarmTransitionAnnouncement(
  previous: AlarmState | undefined,
  next: AlarmState,
): AlarmTransitionAnnouncement | null {
  if (previous === undefined || previous === next) return null;
  if (next === 'active-unacknowledged') return 'raised';
  if (next === 'active-acknowledged') return 'acknowledged';
  if (next === 'cleared') return 'cleared';
  return null;
}

// ---------------------------------------------------------------------------
// Trend history. `WorldSnapshot`/`MachineSnapshot` carry no history of their own
// (see shared/ipc.ts) — the faceplate accumulates a short rolling buffer itself from
// the snapshots it observes, purely as a derived display cache, never as state it
// owns: it is rebuilt from nothing every time a faceplate is (re)mounted.
// ---------------------------------------------------------------------------

export interface TrendSample {
  readonly tick: number;
  readonly value: number;
  readonly setpoint: number | null;
}

/** Appends one sample to a capped history, replacing rather than duplicating a
 * sample for a tick already at the end (a snapshot can, in principle, be delivered
 * more than once for the same tick without the world having advanced). */
export function pushTrendSample(
  history: readonly TrendSample[],
  sample: TrendSample,
  maxSamples: number,
): readonly TrendSample[] {
  if (maxSamples <= 0) return [];
  const last = history[history.length - 1];
  const base = last && last.tick === sample.tick ? history.slice(0, -1) : history;
  const appended = [...base, sample];
  return appended.length > maxSamples ? appended.slice(appended.length - maxSamples) : appended;
}

/** The vertical domain a trend chart should plot against: at least the tag's own
 * engineering range, widened to fit any sample that (in principle) fell outside it,
 * and never zero-height (a flat trace still needs a domain to sit inside). */
export function trendDomain(
  history: readonly TrendSample[],
  rangeLow: number,
  rangeHigh: number,
): { readonly low: number; readonly high: number } {
  let low = rangeLow;
  let high = rangeHigh;
  for (const sample of history) {
    const setpoint = sample.setpoint ?? sample.value;
    low = Math.min(low, sample.value, setpoint);
    high = Math.max(high, sample.value, setpoint);
  }
  if (low >= high) {
    low -= 1;
    high += 1;
  }
  return { low, high };
}

export interface TrendViewport {
  readonly width: number;
  readonly height: number;
  readonly topPadding: number;
  readonly bottomPadding: number;
}

export interface TrendPoint {
  readonly x: number;
  readonly y: number;
}

/** Maps a series of plain values onto SVG viewport coordinates, evenly spaced along
 * x. Kept apart from `scaleTrendSeries`'s callers so the geometry itself — not
 * anything about SVG or the DOM — is what `logic.spec.ts` checks. */
export function scaleTrendSeries(
  values: readonly number[],
  viewport: TrendViewport,
  domainLow: number,
  domainHigh: number,
): readonly TrendPoint[] {
  const span = domainHigh - domainLow;
  const plotHeight = viewport.height - viewport.topPadding - viewport.bottomPadding;
  const stepX = values.length > 1 ? viewport.width / (values.length - 1) : 0;
  return values.map((value, index) => {
    const fraction = span <= 0 ? 0.5 : Math.min(1, Math.max(0, (value - domainLow) / span));
    const y = viewport.height - viewport.bottomPadding - fraction * plotHeight;
    return { x: index * stepX, y };
  });
}

/** Renders a point list as an SVG `points` attribute value. */
export function pointsAttribute(points: readonly TrendPoint[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
}

// ---------------------------------------------------------------------------
// DOM id hygiene. HTML ids must be unique and must not contain whitespace; a
// simulation-assigned machine or tag id is otherwise free-form.
// ---------------------------------------------------------------------------

export function sanitizeDomId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-');
}
