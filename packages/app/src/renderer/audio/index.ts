/**
 * Diegetic, informative plant sound, synthesised entirely with the Web Audio API — no
 * audio files, no new npm package (CLAUDE.md's "no new npm packages" applies here like
 * everywhere else; `graph.ts`'s `createBrowserAudioContext` reaches the browser's own
 * built-in `AudioContext`, nothing more). This is the module's public entry point:
 * `mountPlantAudio` wires a real (or, in a test, fake) `AudioContext` to the running
 * `RendererContext`, exactly like every other panel this renderer mounts (`context.ts`'s
 * own "the renderer observes, it never owns" — this module never sends a `Command` and
 * never invents simulation state, it only listens).
 *
 * `params.ts` is the honest core of the contract this whole module keeps: "sound must
 * carry information, not atmosphere" — a mixer's motor pitch sags and darkens with its
 * own real load tag, a burner roars harder the further its own real temperature sits
 * below its own real setpoint, and a latching alarm horn is gated by nothing but the
 * real `AlarmState` the faceplate's own annunciator tile already shows. `cues.ts`
 * declares, per cue, the exact visual element already carrying the same information —
 * "audio is never the only channel for anything" — and `cues.spec.ts` checks that
 * declaration against what `engine.ts` can actually build.
 *
 * Two safety properties this module is required to hold, both load-bearing enough to
 * name here as well as where they are implemented:
 *
 * - **Never sounds before a real user gesture.** The `AudioContext` this module builds
 *   is explicitly suspended immediately after construction (most browsers already start
 *   one suspended under their own autoplay policy; this does not rely on that), and is
 *   `resume()`d only from a real `pointerdown`/`keydown` listener registered on
 *   `gestureTarget` — never proactively, and never from a snapshot or a timer.
 * - **Never throws just because Web Audio is unavailable.** `graph.ts`'s
 *   `createBrowserAudioContext` already never throws; the `try`/`catch` around engine
 *   construction below is the second layer, so a browser or test window with no audio
 *   subsystem at all still runs the whole rest of the product — "a build that cannot
 *   make sound must still run" (this task's brief).
 */

import type { WorldSnapshot } from '../../shared/ipc.js';
import type { Disposable, RendererContext } from '../context.js';
import { PlantAudioEngine } from './engine.js';
import { createBrowserAudioContext, type AudioContextLike } from './graph.js';

/** The two events a real user gesture reaches this module through — a pointer press or
 * a keypress, the same minimal set browsers themselves require before honouring
 * `AudioContext.resume()` under their autoplay policy. */
const GESTURE_EVENT_TYPES = ['pointerdown', 'keydown'] as const;

/** Only the two `EventTarget` methods this module actually calls — `window` satisfies
 * this structurally with no adapter, and a test can hand it a minimal fake instead. */
export type GestureTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface MountPlantAudioOptions {
  /** Defaults to `graph.ts`'s `createBrowserAudioContext`. Overridable so a test can
   * inject a minimal in-memory fake instead of a real browser `AudioContext`. */
  readonly createAudioContext?: () => AudioContextLike | null;
  /** Defaults to `window` when one exists. Overridable for the same reason. */
  readonly gestureTarget?: GestureTarget;
}

/**
 * Mounts the plant audio engine against `context` and returns a `Disposable` that tears
 * it down — the same shape every other mounted piece of this renderer returns
 * (`context.ts`'s `Panel`), even though this one owns no DOM subtree of its own.
 */
export function mountPlantAudio(context: RendererContext, options: MountPlantAudioOptions = {}): Disposable {
  const createAudioContext = options.createAudioContext ?? createBrowserAudioContext;
  const gestureTarget = options.gestureTarget ?? (typeof window === 'undefined' ? undefined : window);

  let audioContext: AudioContextLike | null = null;
  let engine: PlantAudioEngine | null = null;

  try {
    audioContext = createAudioContext();
    if (audioContext) {
      if (audioContext.state !== 'suspended') void audioContext.suspend();
      engine = new PlantAudioEngine(audioContext);
      engine.setMuted(context.preferences().muted);
    }
  } catch {
    // Web Audio is present but broken in this window (a real `AudioContext` can throw
    // during construction or on the very first node it is asked to create). Leaving
    // `engine` `null` here routes every call below through the same no-op path a
    // missing `AudioContext` already takes.
    audioContext = null;
    engine = null;
  }

  function resumeOnGesture(): void {
    void audioContext?.resume();
  }
  if (audioContext && gestureTarget) {
    for (const type of GESTURE_EVENT_TYPES) {
      gestureTarget.addEventListener(type, resumeOnGesture, { once: true });
    }
  }

  function applySnapshot(snapshot: WorldSnapshot): void {
    engine?.update(snapshot, { reducedMotion: context.preferences().reducedMotion });
  }

  const unsubscribeSnapshot = context.subscribe(applySnapshot);
  const initialSnapshot = context.snapshot();
  if (initialSnapshot) applySnapshot(initialSnapshot);

  const unsubscribePreferences = context.onPreferences((preferences) => {
    engine?.setMuted(preferences.muted);
  });

  return () => {
    unsubscribeSnapshot();
    unsubscribePreferences();
    if (audioContext && gestureTarget) {
      for (const type of GESTURE_EVENT_TYPES) gestureTarget.removeEventListener(type, resumeOnGesture);
    }
    engine?.dispose();
    void audioContext?.close?.();
  };
}
