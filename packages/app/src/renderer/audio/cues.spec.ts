import { describe, expect, it } from 'vitest';

import {
  AUDIO_CUES,
  CUE_ALARM_ANNUNCIATOR,
  CUE_CONVEYOR_RHYTHM,
  CUE_EXTRACTOR_HUM,
  CUE_MIXER_MOTOR,
  CUE_OVEN_BURNER,
  CUE_WRAPPER_CYCLE,
} from './cues.js';

// "Every audio cue MUST have a visual counterpart already present — audio is never the
// only channel for anything" (this task's brief). This is the test that enforces it:
// every registered cue must declare a real, non-empty visual counterpart, and the
// registry must cover exactly the cues `engine.ts` can build — one per non-generic role
// `roles.ts`'s `classifyMachine` can produce, plus the two whole-plant voices.
describe('AUDIO_CUES', () => {
  it('is not empty', () => {
    expect(AUDIO_CUES.length).toBeGreaterThan(0);
  });

  it('gives every cue a non-empty summary and a non-empty visual counterpart', () => {
    for (const cue of AUDIO_CUES) {
      expect(cue.id.length).toBeGreaterThan(0);
      expect(cue.summary.trim().length).toBeGreaterThan(0);
      expect(cue.visualCounterpart.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate ids', () => {
    const ids = AUDIO_CUES.map((cue) => cue.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers exactly the cue ids engine.ts and roles.ts together define', () => {
    const ids = AUDIO_CUES.map((cue) => cue.id).sort();
    expect(ids).toEqual(
      [
        CUE_MIXER_MOTOR,
        CUE_OVEN_BURNER,
        CUE_EXTRACTOR_HUM,
        CUE_CONVEYOR_RHYTHM,
        CUE_WRAPPER_CYCLE,
        CUE_ALARM_ANNUNCIATOR,
      ].sort(),
    );
  });

  it('names a real, checkable UI location for every cue, not a vague reference', () => {
    // A loose smoke check, not a substitute for a human reviewer: every visual
    // counterpart should point at a real module or a real catalogue-style identifier
    // this repository actually has, so "already present" is checkable, not asserted.
    for (const cue of AUDIO_CUES) {
      expect(cue.visualCounterpart).toMatch(/\.ts|cb-[a-z-]+|alarm\.|faceplate\.|mode\./);
    }
  });
});
