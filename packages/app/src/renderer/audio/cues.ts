/**
 * The registered contract for every sound this module can make.
 *
 * "Every audio cue MUST have a visual counterpart already present — audio is never the
 * only channel for anything" (this task's brief). This file is where that contract is
 * stated, per cue, in one place a test can check exhaustively (`cues.spec.ts`): every
 * entry names the exact panel and state that already shows the same information with no
 * sound at all. The `CUE_*` id constants below are the single source of truth for a
 * cue's own name — `cues.spec.ts` checks this list directly against the roles
 * `roles.ts`'s `classifyMachine` can produce plus the two whole-plant voices
 * `engine.ts` always builds, so the two cannot silently drift apart.
 */

export const CUE_MIXER_MOTOR = 'mixer.motor';
export const CUE_OVEN_BURNER = 'oven.burner';
export const CUE_EXTRACTOR_HUM = 'extractor.hum';
export const CUE_CONVEYOR_RHYTHM = 'conveyor.rhythm';
export const CUE_WRAPPER_CYCLE = 'wrapper.cycle';
export const CUE_ALARM_ANNUNCIATOR = 'alarm.annunciator';

export interface AudioCueDefinition {
  readonly id: string;
  /** What the cue conveys and how, in plain English — developer-facing documentation,
   * not player-facing copy, so it carries no i18n obligation under CLAUDE.md's "every
   * user-facing string" rule. */
  readonly summary: string;
  /** The real, already-rendered screen element carrying the same information with no
   * sound at all — a file, a component class or a catalogue key a reviewer can go look
   * at, never a vague "the UI already shows this". */
  readonly visualCounterpart: string;
}

export const AUDIO_CUES: readonly AudioCueDefinition[] = [
  {
    id: CUE_MIXER_MOTOR,
    summary:
      'A running mixer’s motor pitch tracks its speed tag; the pitch sags and the ' +
      'tone darkens as its load tag rises, so a struggling mixer is audible before any alarm trips.',
    visualCounterpart:
      'faceplate/render.ts’s cb-spv setpoint/process-value readout and bar marker for the ' +
      'mixer’s speed and load tags, plus its mode.running/mode.stopped run-info text.',
  },
  {
    id: CUE_OVEN_BURNER,
    summary:
      'A running oven’s flame bed roars harder the further its measured temperature sits ' +
      'below its own setpoint, and gives a short ignition transient the instant it starts running.',
    visualCounterpart:
      'faceplate/render.ts’s cb-spv readout, deviation status text ' +
      '(faceplate.tag.status.deviationLow/withinTolerance) for the oven’s temperature tag, ' +
      'and its mode selector/run-info flipping to running.',
  },
  {
    id: CUE_EXTRACTOR_HUM,
    summary:
      'A whole-plant ambient hum whose level tracks the real fraction of machines currently ' +
      'running across the snapshot, silent when nothing is.',
    visualCounterpart:
      'Every faceplate’s own mode.running/mode.stopped run-info text, summed across the ' +
      'machines a player can see on the nav rail.',
  },
  {
    id: CUE_CONVEYOR_RHYTHM,
    summary:
      'A running conveyor-role machine pulses in time with its own speed tag when it has one; ' +
      'otherwise the pulse still only plays while it is really running.',
    visualCounterpart:
      'faceplate/render.ts’s cb-spv readout for the machine’s speed tag (when present) and ' +
      'its mode.running/mode.stopped run-info text.',
  },
  {
    id: CUE_WRAPPER_CYCLE,
    summary:
      'A running wrapper-role machine pulses at a steady nominal cycle rate, gated strictly by ' +
      'whether it is really running.',
    visualCounterpart: 'faceplate/render.ts’s mode.running/mode.stopped run-info text.',
  },
  {
    id: CUE_ALARM_ANNUNCIATOR,
    summary:
      'A single plant-wide horn latches on the instant any alarm anywhere reaches ' +
      'active-unacknowledged, and stops the instant none remain in that state.',
    visualCounterpart:
      'faceplate/render.ts’s cb-annunciator-tile (icon ▲, alarm.state.activeUnacknowledged ' +
      'text) and the assertive alarm.announceRaised/announceAcknowledged live-region announcement.',
  },
];
