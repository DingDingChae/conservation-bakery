/**
 * Pure snapshot-to-sound mappings: every number `engine.ts` ever writes to a Web Audio
 * node comes from a function in this file, and every function in this file takes plain
 * `WorldSnapshot`/`MachineSnapshot` data in and plain numbers out — no `AudioContext`,
 * no DOM, exactly the split `faceplate/logic.ts` already draws for the same reason (see
 * that module's own doc comment): the mapping is what needs to be right and tested at
 * its extremes, and it can be, with no audio hardware anywhere near the test.
 *
 * "Sound must carry information, not atmosphere" (this task's brief) means every one of
 * these reads a real `TagSnapshot`/`AlarmSnapshot`/`running` field, never a constant that
 * only pretends to. Where a machine has not yet been wired with the tag a cue would
 * ideally key off (there is no `conveyor` or `wrapper` in `sim-worker/machines.ts` yet —
 * see `roles.ts`'s own doc comment), the affected parameter falls back to the one real
 * signal every machine always has — `running` — documented at each call site, rather
 * than inventing a fake reading.
 */

import type { AlarmSnapshot, MachineSnapshot, WorldSnapshot } from '../../shared/ipc.js';
import { findTag, fractionOfRange } from './roles.js';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Mixer motor: pitch and load.
// ---------------------------------------------------------------------------

/** Audible range for the motor's fundamental, Hz — low enough to read as a real motor's
 * hum, high enough not to disappear under everything else in the mix. */
export const MIXER_MIN_HZ = 45;
export const MIXER_MAX_HZ = 180;

/** How far the motor's own pitch sags at full load — a loaded induction motor's real
 * shaft speed does drop measurably under mechanical resistance, so a heavier bowl is
 * audibly straining before any alarm has to say so ("a player should be able to hear a
 * mixer struggling before the screen says so", this task's brief). */
export const MIXER_LOAD_SAG_FRACTION = 0.22;

/** The motor tone's low-pass cutoff darkens (more grind, less whine) as load rises. */
export const MIXER_FILTER_MIN_HZ = 500;
export const MIXER_FILTER_MAX_HZ = 3_200;

export const MIXER_RUNNING_GAIN = 0.22;

export interface MixerAudioParams {
  readonly frequencyHz: number;
  readonly filterCutoffHz: number;
  readonly gain: number;
}

/** `mix-speed-rpm` (`sim-worker/machines.ts`) drives pitch; `batch-mass-kg` drives load.
 * Found by real vocabulary (`roles.ts`'s `findTag`), not the literal tag id, so a rename
 * does not silently desonify the mixer. A mixer with neither tag still plays — at the
 * bottom of the pitch range, unloaded — rather than falling silent. */
export function mixerAudioParams(machine: MachineSnapshot): MixerAudioParams {
  const speedFraction = fractionOfRange(findTag(machine, /speed|rpm/i));
  const loadFraction = fractionOfRange(findTag(machine, /mass|load|batch/i));

  const baseFrequencyHz = MIXER_MIN_HZ + speedFraction * (MIXER_MAX_HZ - MIXER_MIN_HZ);
  const frequencyHz = baseFrequencyHz * (1 - loadFraction * MIXER_LOAD_SAG_FRACTION);
  const filterCutoffHz = MIXER_FILTER_MAX_HZ - loadFraction * (MIXER_FILTER_MAX_HZ - MIXER_FILTER_MIN_HZ);
  const gain = machine.running ? MIXER_RUNNING_GAIN : 0;

  return { frequencyHz, filterCutoffHz, gain };
}

// ---------------------------------------------------------------------------
// Oven burner: a running flame bed that roars harder while ramping to setpoint.
// ---------------------------------------------------------------------------

export const OVEN_MIN_HZ = 55;
export const OVEN_MAX_HZ = 95;
export const OVEN_DETUNE_CENTS = 9;

export const OVEN_FILTER_MIN_HZ = 900;
export const OVEN_FILTER_MAX_HZ = 4_000;

export const OVEN_IDLE_GAIN = 0.08;
export const OVEN_RAMP_GAIN_BOOST = 0.24;

/** A short, real ignition transient: gas ovens audibly "whoosh" up at light-off, then
 * settle to their running level — the visual counterpart is the same instant the
 * faceplate's `mode.running` text and mode selector flip, so the sound never carries
 * information the screen does not already show at the same tick. */
export const OVEN_IGNITION_PEAK_GAIN = 0.55;
export const OVEN_IGNITION_DECAY_SECONDS = 0.6;

export interface OvenAudioParams {
  readonly frequencyHz: number;
  readonly filterCutoffHz: number;
  readonly gain: number;
  /** `0` at or above setpoint, rising toward `1` the further the measured temperature
   * sits below its own setpoint — exposed separately from `gain` so a caller (the
   * ignition-transient trigger in `engine.ts`) can read the steady-state level a
   * transient should decay into without recomputing it. */
  readonly deficitFraction: number;
}

/**
 * Finds the oven's temperature *measurement* tag (`setpoint === null`, per
 * `shared/ipc.ts`'s own `TagSnapshot` doc comment) and its paired *setpoint* tag among
 * any tag whose id matches `/temp/i` — `sim-worker/machines.ts` names them
 * `bake-temp-c` and `bake-temp-setpoint-c` today, but this reads the shape, not the
 * literal ids. A measurement tag with no paired setpoint (or vice versa) still produces
 * a valid, silent-deficit result rather than throwing.
 */
export function ovenAudioParams(machine: MachineSnapshot): OvenAudioParams {
  const temperatureTags = machine.tags.filter((tag) => /temp/i.test(tag.id));
  const measurementTag = temperatureTags.find((tag) => tag.setpoint === null);
  const setpointTag = temperatureTags.find((tag) => tag.setpoint !== null);

  const currentC = measurementTag?.value ?? setpointTag?.value ?? 0;
  const targetC = setpointTag?.value ?? currentC;
  const range = measurementTag ?? setpointTag;
  const span = range ? range.rangeHigh - range.rangeLow : 0;

  const deficitFraction = span > 0 ? clamp01((targetC - currentC) / span) : 0;
  const frequencyHz = OVEN_MIN_HZ + deficitFraction * (OVEN_MAX_HZ - OVEN_MIN_HZ);
  const filterCutoffHz = OVEN_FILTER_MIN_HZ + deficitFraction * (OVEN_FILTER_MAX_HZ - OVEN_FILTER_MIN_HZ);
  const gain = machine.running ? OVEN_IDLE_GAIN + deficitFraction * OVEN_RAMP_GAIN_BOOST : 0;

  return { frequencyHz, filterCutoffHz, gain, deficitFraction };
}

// ---------------------------------------------------------------------------
// Extractor: a whole-plant ambient hum, tied to how much of the plant is running.
// ---------------------------------------------------------------------------

export const EXTRACTOR_HUM_HZ = 120;
export const EXTRACTOR_FILTER_HZ = 1_800;
export const EXTRACTOR_IDLE_GAIN = 0.05;
export const EXTRACTOR_LOAD_GAIN_BOOST = 0.09;

export interface ExtractorAudioParams {
  readonly gain: number;
}

/** Real kitchen/plant extraction responds to how much of the room is actually cooking,
 * not to any one machine — modelled here as the fraction of *all* machines in the
 * snapshot that are `running`, so the extractor gets audibly busier as more of the
 * plant lights up, and silent with nothing running at all. */
export function extractorAudioParams(snapshot: WorldSnapshot): ExtractorAudioParams {
  if (snapshot.machines.length === 0) return { gain: 0 };
  const runningCount = snapshot.machines.filter((machine) => machine.running).length;
  if (runningCount === 0) return { gain: 0 };
  const runningFraction = runningCount / snapshot.machines.length;
  return { gain: EXTRACTOR_IDLE_GAIN + runningFraction * EXTRACTOR_LOAD_GAIN_BOOST };
}

// ---------------------------------------------------------------------------
// Conveyor / wrapper / alarm annunciator: a shared "tone that pulses" shape.
// `engine.ts`'s pulsing voice reuses one node graph for all three; a `pulseDepthGain`
// of `0` (always the case under reduced motion — see each function below) leaves the
// tone perfectly steady rather than silent, so the cue is still audible, only unpulsed.
// ---------------------------------------------------------------------------

export interface PulseAudioParams {
  readonly toneHz: number;
  readonly pulseHz: number;
  readonly centerGain: number;
  readonly pulseDepthGain: number;
}

export const CONVEYOR_TONE_HZ = 260;
export const CONVEYOR_MIN_PULSE_HZ = 1.2;
export const CONVEYOR_MAX_PULSE_HZ = 5;
export const CONVEYOR_RUNNING_GAIN = 0.1;
export const CONVEYOR_PULSE_DEPTH = 0.09;

/**
 * No conveyor is wired into the interactive world yet (see `roles.ts`'s own doc
 * comment), so this cannot yet key off a real line-speed tag for most machines it might
 * one day classify — `roles.ts`'s `findTag(/speed|rate|line/i)` is tried first and used
 * whenever a future conveyor does carry one; failing that, the rhythm still only plays
 * at all while `machine.running` is real (never a bare timer), just at one fixed nominal
 * rate rather than one that varies with a speed this snapshot does not carry.
 */
export function conveyorAudioParams(machine: MachineSnapshot, reducedMotion: boolean): PulseAudioParams {
  const speedTag = findTag(machine, /speed|rate|line/i);
  const speedFraction = speedTag ? fractionOfRange(speedTag) : machine.running ? 0.5 : 0;
  const pulseHz = CONVEYOR_MIN_PULSE_HZ + speedFraction * (CONVEYOR_MAX_PULSE_HZ - CONVEYOR_MIN_PULSE_HZ);
  const centerGain = machine.running ? CONVEYOR_RUNNING_GAIN : 0;
  const pulseDepthGain = reducedMotion || !machine.running ? 0 : CONVEYOR_PULSE_DEPTH;
  return { toneHz: CONVEYOR_TONE_HZ, pulseHz, centerGain, pulseDepthGain };
}

export const WRAPPER_TONE_HZ = 640;
/** The wrapper's own nominal cycle rate — no cycle-count or line-speed tag exists on any
 * machine wired today (see `roles.ts`'s own doc comment), so unlike the conveyor above
 * there is no real per-cycle value yet to vary this with; only *whether it plays at
 * all* is real (`machine.running`), which is the one signal every machine, wired or
 * not, always carries. */
export const WRAPPER_CYCLE_HZ = 2;
export const WRAPPER_RUNNING_GAIN = 0.08;
export const WRAPPER_PULSE_DEPTH = 0.07;

export function wrapperAudioParams(machine: MachineSnapshot, reducedMotion: boolean): PulseAudioParams {
  const centerGain = machine.running ? WRAPPER_RUNNING_GAIN : 0;
  const pulseDepthGain = reducedMotion || !machine.running ? 0 : WRAPPER_PULSE_DEPTH;
  return { toneHz: WRAPPER_TONE_HZ, pulseHz: WRAPPER_CYCLE_HZ, centerGain, pulseDepthGain };
}

// ---------------------------------------------------------------------------
// Alarm annunciator: latches on with the first unacknowledged alarm, silences the
// instant none remain — never a per-alarm sound, one shared plant-wide horn, exactly
// like a real annunciator panel.
// ---------------------------------------------------------------------------

export const ALARM_MIN_HZ = 660;
export const ALARM_MAX_HZ = 990;
/** How many descending priority steps span the full pitch range above — priority `1`
 * (`sim-worker/machines.ts`'s oven `over-temp`, the most urgent alarm wired today) sits
 * at `ALARM_MAX_HZ`; anything `ALARM_PRIORITY_SPAN` steps or further below it floors out
 * at `ALARM_MIN_HZ` rather than continuing to fall. */
export const ALARM_PRIORITY_SPAN = 4;
export const ALARM_ACTIVE_GAIN = 0.16;
export const ALARM_PULSE_HZ = 3.2;
export const ALARM_PULSE_DEPTH = 0.14;

export interface AnnunciatorAudioParams extends PulseAudioParams {
  /** Whether the horn should be audible at all this tick — kept alongside the tone
   * parameters rather than inferred from `centerGain > 0`, so `engine.ts` and any test
   * can check "should this alarm sound" without reconstructing that from a float. */
  readonly active: boolean;
}

function allAlarms(snapshot: WorldSnapshot): readonly AlarmSnapshot[] {
  return snapshot.machines.flatMap((machine) => machine.alarms);
}

/**
 * "A latching annunciator that sounds when an alarm trips and stops when acknowledged"
 * (this task's brief) is exactly `AlarmState`'s own `active-unacknowledged` state
 * (`shared/ipc.ts`) — the horn is `active` for as long as at least one alarm, on any
 * machine, sits in that state, and stops the instant every alarm has moved past it
 * (acknowledged, cleared, or never tripped), matching the faceplate annunciator tile's
 * own icon and state text exactly, tick for tick.
 */
export function annunciatorParams(snapshot: WorldSnapshot, reducedMotion: boolean): AnnunciatorAudioParams {
  const unacknowledged = allAlarms(snapshot).filter((alarm) => alarm.state === 'active-unacknowledged');
  const active = unacknowledged.length > 0;
  const highestPriority = active ? Math.min(...unacknowledged.map((alarm) => alarm.priority)) : null;

  const priorityFraction =
    highestPriority === null ? 0 : clamp01(1 - (highestPriority - 1) / ALARM_PRIORITY_SPAN);
  const toneHz = ALARM_MIN_HZ + priorityFraction * (ALARM_MAX_HZ - ALARM_MIN_HZ);

  return {
    active,
    toneHz,
    pulseHz: ALARM_PULSE_HZ,
    centerGain: active ? ALARM_ACTIVE_GAIN : 0,
    pulseDepthGain: active && !reducedMotion ? ALARM_PULSE_DEPTH : 0,
  };
}
