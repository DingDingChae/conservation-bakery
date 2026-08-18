/**
 * Classifies a `MachineSnapshot` into the plant role its diegetic sound depends on, and
 * a couple of small pure helpers for pulling a real value off one of its tags.
 *
 * Only two machines are actually wired into `sim-worker/machines.ts` today (`mixer-1`
 * and `oven-1` — see that module's own doc comment), but this classifies by matching
 * `id`/`label` against the vocabulary the rest of the codebase already uses for the
 * wider plant (`packages/sim/src/plant/equipment/*.ts`'s own machine `type` strings:
 * `spiral-mixer`, `deck-oven`, `flow-wrapper`, `spiral-cooler`, and so on), so a
 * conveyor, an extractor or a wrapper wired into the interactive world later is
 * sonified automatically, with no change here or in `engine.ts`.
 */

import type { MachineSnapshot, TagSnapshot } from '../../shared/ipc.js';

export type MachineRole = 'mixer' | 'oven' | 'extractor' | 'conveyor' | 'wrapper' | 'generic';

const ROLE_PATTERNS: readonly (readonly [MachineRole, RegExp])[] = [
  ['mixer', /mixer|mixing|whisk|beater|aerator/i],
  ['oven', /oven|burner|kiln|roaster/i],
  ['extractor', /extract|blower|fan|exhaust|vent/i],
  ['conveyor', /conveyor|belt|cooler|proofer|retarder/i],
  ['wrapper', /wrapper|pack|seal|label|palletis/i],
];

/**
 * The role a machine's id/label matches, checked in the fixed order above — a machine
 * whose name happens to match two patterns (none do today) takes the first, so this is
 * always a total, deterministic function of the same two fields the faceplate's own
 * title bar already shows.
 */
export function classifyMachine(machine: Pick<MachineSnapshot, 'id' | 'label'>): MachineRole {
  const haystack = `${machine.id} ${machine.label}`.toLowerCase();
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(haystack)) return role;
  }
  return 'generic';
}

/** The first tag on `machine` whose id or unit matches `pattern`, or `undefined` if
 * none does — used to find "the speed tag" or "the load tag" on a machine generically,
 * by real vocabulary (`rpm`, `speed`, `mass`) rather than a hard-coded tag id, so a
 * rename in `sim-worker/machines.ts` or a new machine definition in `packages/sim`
 * does not silently go unsonified. */
export function findTag(machine: MachineSnapshot, pattern: RegExp): TagSnapshot | undefined {
  return machine.tags.find((tag) => pattern.test(tag.id) || pattern.test(tag.unit));
}

/** Where `tag.value` currently sits within `[tag.rangeLow, tag.rangeHigh]`, as a
 * fraction clamped to `[0, 1]` — `0` for a missing tag or a degenerate (zero-or-negative)
 * range, never `NaN` or a value outside the audible mapping every caller applies it to. */
export function fractionOfRange(tag: TagSnapshot | undefined): number {
  if (!tag) return 0;
  const span = tag.rangeHigh - tag.rangeLow;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (tag.value - tag.rangeLow) / span));
}
