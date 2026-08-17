/**
 * Control-room shell: pure logic.
 *
 * DOM-free functions the shell's mount code (`layout.ts`, `header.ts`, `navRail.ts`,
 * `settings.ts`) is built from — screen identity, reveal-target routing, alarm
 * aggregation across every machine for the header's single global annunciator, clock
 * formatting from the snapshot's own `simulatedTime` (never wall-clock time), and exact
 * decimal-gram-to-microgram parsing for the call-a-supplier form (CONTRACT.md: float
 * computes, integer stores — a delivery mass is parsed as digits, never through
 * `Number`). Kept apart from DOM-touching code the same way `faceplate/logic.ts` is,
 * so it is exercised by `logic.spec.ts` without a DOM.
 */

import type { AlarmSnapshot, AlarmState, MachineSnapshot, SpeedMultiplier } from '../../shared/ipc.js';
import type { RevealTarget } from '../context.js';

// ---------------------------------------------------------------------------
// Screen identity — which single thing the main area currently shows. Owned
// entirely by the shell; no panel needs to know this type exists.
// ---------------------------------------------------------------------------

export type ScreenId =
  | { readonly kind: 'machine'; readonly machineId: string }
  | { readonly kind: 'provenance-tree' }
  | { readonly kind: 'settings' };

export function screenEquals(a: ScreenId, b: ScreenId): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'machine' && b.kind === 'machine') return a.machineId === b.machineId;
  return true;
}

export function screenNavId(screen: ScreenId): string {
  return screen.kind === 'machine' ? `machine:${screen.machineId}` : screen.kind;
}

/**
 * Which screen a `reveal()` target belongs on, or `null` for a target this shell does
 * not route to a screen change at all (the balance panel is always visible, never a
 * screen — see `layout.ts`). A `'panel'` target whose `panelId` names a machine
 * (`machine:<id>`) is routed the same as a direct machine reveal, so a palette entry
 * for a specific tag or a plain "open this machine" entry both land the same place.
 */
export function screenForRevealTarget(target: RevealTarget): ScreenId | null {
  switch (target.kind) {
    case 'machine':
    case 'tag':
    case 'alarm':
      return { kind: 'machine', machineId: target.machineId };
    case 'lot':
      return { kind: 'provenance-tree' };
    case 'panel':
      if (target.panelId === 'settings') return { kind: 'settings' };
      if (target.panelId === 'provenance-tree') return { kind: 'provenance-tree' };
      if (target.panelId.startsWith('machine:')) {
        return { kind: 'machine', machineId: target.panelId.slice('machine:'.length) };
      }
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Global alarm annunciator: one tile in the header standing for every alarm on
// every machine, so an operator on the Settings screen still sees a cascade.
// ---------------------------------------------------------------------------

export interface GlobalAlarm extends AlarmSnapshot {
  readonly machineId: string;
}

const ALARM_STATE_URGENCY: Readonly<Record<AlarmState, number>> = {
  'active-unacknowledged': 0,
  'active-acknowledged': 1,
  cleared: 2,
  normal: 3,
};

export interface AlarmAggregate {
  /** The single most urgent alarm across every machine, or `null` if every alarm on
   * every machine is `normal` (nothing has ever tripped). */
  readonly worst: GlobalAlarm | null;
  readonly activeUnacknowledgedCount: number;
  readonly activeAcknowledgedCount: number;
  readonly clearedCount: number;
}

/** Flattens every machine's alarms into one list, most-urgent-first — first-out leads,
 * then state urgency, then priority, then a stable tie-break on machine and alarm id.
 * Mirrors the ordering `faceplate/logic.ts`'s `orderAlarms` applies within one machine,
 * generalised across machines because the header has no single "first out" of its own. */
export function aggregateAlarms(machines: readonly MachineSnapshot[]): AlarmAggregate {
  const flattened: GlobalAlarm[] = machines.flatMap((machine) =>
    machine.alarms.map((alarm) => ({ ...alarm, machineId: machine.id })),
  );
  flattened.sort((a, b) => {
    if (a.firstOut !== b.firstOut) return a.firstOut ? -1 : 1;
    const urgencyDelta = ALARM_STATE_URGENCY[a.state] - ALARM_STATE_URGENCY[b.state];
    if (urgencyDelta !== 0) return urgencyDelta;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.machineId !== b.machineId) return a.machineId.localeCompare(b.machineId);
    return a.id.localeCompare(b.id);
  });

  let activeUnacknowledgedCount = 0;
  let activeAcknowledgedCount = 0;
  let clearedCount = 0;
  for (const alarm of flattened) {
    if (alarm.state === 'active-unacknowledged') activeUnacknowledgedCount += 1;
    else if (alarm.state === 'active-acknowledged') activeAcknowledgedCount += 1;
    else if (alarm.state === 'cleared') clearedCount += 1;
  }

  const worst = flattened.find((alarm) => alarm.state !== 'normal') ?? null;
  return { worst, activeUnacknowledgedCount, activeAcknowledgedCount, clearedCount };
}

// ---------------------------------------------------------------------------
// Clock. `simulatedTime` is an ISO string the snapshot itself carries (see
// `shared/ipc.ts`) — `new Date(iso)` here parses that string, it never reads the host
// clock, so this stays deterministic and replay-safe per CLAUDE.md.
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `HH:MM:SS`, UTC — fixed regardless of the host machine's local timezone, so the
 * same snapshot always reads the same clock face on any machine running the app. */
export function formatSimulatedClock(simulatedTimeIso: string): string {
  const date = new Date(simulatedTimeIso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

// ---------------------------------------------------------------------------
// Speed control.
// ---------------------------------------------------------------------------

export const SPEED_OPTIONS: readonly SpeedMultiplier[] = [0, 1, 5, 60];

const SPEED_CATALOGUE_KEY: Readonly<Record<SpeedMultiplier, string>> = {
  0: 'speed.pause',
  1: 'speed.x1',
  5: 'speed.x5',
  60: 'speed.x60',
};

export function speedCatalogueKey(speed: SpeedMultiplier): string {
  return SPEED_CATALOGUE_KEY[speed];
}

// ---------------------------------------------------------------------------
// Call-a-supplier mass entry. Whole grams only, by design: an integer decimal string
// converts to exact micrograms by multiplication alone, so this control can never be
// the place a fractional gram gets rounded through a `Number` — see CONTRACT.md's
// "float computes, integer stores".
// ---------------------------------------------------------------------------

const WHOLE_NUMBER_PATTERN = /^\d+$/;
const MICROGRAMS_PER_GRAM = 1_000_000n;

/** Parses a whole non-negative gram quantity typed by a player into exact micrograms,
 * or `null` for anything that is not a plain non-negative integer (including empty,
 * signed, decimal or non-digit input) — never `Number(raw)`, so there is no float in
 * this path at all. */
export function parseWholeGramsToMicrograms(raw: string): bigint | null {
  if (!WHOLE_NUMBER_PATTERN.test(raw)) return null;
  return BigInt(raw) * MICROGRAMS_PER_GRAM;
}

// ---------------------------------------------------------------------------
// Fault detection. See `shell/fault.ts`'s module doc comment for the full story: the
// shared contract has no dedicated fault channel from the main process to the
// renderer, so this distinguishes a real transport/worker failure from an ordinary
// business-level rejection (e.g. `context.provenance()` for an id that does not
// exist) by matching the exact, literal phrases `main/simulationHost.ts` uses for the
// two ways it rejects a request once the worker thread itself is gone — never for a
// rejection the worker sent back deliberately while still alive and running.
// ---------------------------------------------------------------------------

const WORKER_NOT_RUNNING_MESSAGE = 'the simulation worker is not running';
const WORKER_EXITED_MESSAGE_PREFIX = 'the simulation worker exited with code ';

export function isInfrastructureFailureMessage(message: string): boolean {
  return message === WORKER_NOT_RUNNING_MESSAGE || message.startsWith(WORKER_EXITED_MESSAGE_PREFIX);
}
