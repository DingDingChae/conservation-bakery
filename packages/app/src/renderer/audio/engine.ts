/**
 * Builds and updates the real Web Audio graph from `WorldSnapshot` data, using only the
 * minimal surface `graph.ts` declares — so it builds and updates correctly against a
 * plain in-memory fake with no browser audio subsystem at all (`engine.spec.ts`), and
 * identically against a real `AudioContext` (`graph.ts`'s `createBrowserAudioContext`,
 * wired in by `index.ts`).
 *
 * Every oscillator here is created once, per cue, and `.start()`ed once — real Web Audio
 * throws if `start()` is called twice on the same node, and constantly tearing a node
 * down and rebuilding it to go from "silent" to "sounding" would both risk that and add
 * an audible click at every transition. Silence is a gain of `0`, never a stopped node;
 * `update()` only ever changes parameters on an already-running graph.
 *
 * All parameter *values* come from `params.ts` — this module contains no snapshot-to-
 * sound mapping logic of its own, only the plumbing that gets a `params.ts` number onto
 * a real (or fake) `AudioParam`.
 */

import type { MachineSnapshot, WorldSnapshot } from '../../shared/ipc.js';
import type {
  AudioContextLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from './graph.js';
import {
  EXTRACTOR_FILTER_HZ,
  EXTRACTOR_HUM_HZ,
  OVEN_DETUNE_CENTS,
  OVEN_IGNITION_DECAY_SECONDS,
  OVEN_IGNITION_PEAK_GAIN,
  annunciatorParams,
  conveyorAudioParams,
  extractorAudioParams,
  mixerAudioParams,
  ovenAudioParams,
  wrapperAudioParams,
  type PulseAudioParams,
} from './params.js';
import { classifyMachine, type MachineRole } from './roles.js';

export interface EnginePreferences {
  readonly reducedMotion: boolean;
}

/**
 * Sets `param.value` immediately, unless `peakValue`/`decaySeconds` are given and the
 * real automation methods (`setValueAtTime`/`linearRampToValueAtTime`) are present, in
 * which case it schedules a real transient: jump to `peakValue` now, then ramp linearly
 * to `settleValue` over `decaySeconds`. A minimal fake implementing only `.value` (this
 * task's own requirement — "inject a minimal fake") still gets a correct, if instant,
 * result rather than a thrown error.
 */
function scheduleEnvelope(
  context: AudioContextLike,
  param: AudioParamLike,
  settleValue: number,
  transient?: { readonly peakValue: number; readonly decaySeconds: number },
): void {
  if (!transient || !param.setValueAtTime || !param.linearRampToValueAtTime) {
    param.value = settleValue;
    return;
  }
  const now = context.currentTime;
  param.cancelScheduledValues?.(now);
  param.setValueAtTime(transient.peakValue, now);
  param.linearRampToValueAtTime(settleValue, now + transient.decaySeconds);
}

// ---------------------------------------------------------------------------
// Voice shapes. Each is a small, fixed node graph created once and reused for the life
// of the machine (or the life of the engine, for the two whole-plant voices).
// ---------------------------------------------------------------------------

interface ToneVoice {
  readonly osc: OscillatorNodeLike;
  readonly filter: BiquadFilterNodeLike;
  readonly gain: GainNodeLike;
  dispose(): void;
}

function createToneVoice(context: AudioContextLike, master: GainNodeLike, oscType: string): ToneVoice {
  const osc = context.createOscillator();
  osc.type = oscType;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  const gain = context.createGain();
  gain.gain.value = 0;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  osc.start();
  return {
    osc,
    filter,
    gain,
    dispose() {
      osc.stop();
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    },
  };
}

interface FlameVoice {
  readonly oscA: OscillatorNodeLike;
  readonly oscB: OscillatorNodeLike;
  readonly filter: BiquadFilterNodeLike;
  readonly gain: GainNodeLike;
  /** Tracks the previous `running` value across `update()` calls purely to detect the
   * false-to-true edge the ignition transient fires on — never read by anything outside
   * `applyOvenVoice`. */
  wasRunning: boolean;
  dispose(): void;
}

function createFlameVoice(context: AudioContextLike, master: GainNodeLike): FlameVoice {
  const oscA = context.createOscillator();
  oscA.type = 'sawtooth';
  const oscB = context.createOscillator();
  oscB.type = 'sawtooth';
  oscB.detune.value = OVEN_DETUNE_CENTS;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  const gain = context.createGain();
  gain.gain.value = 0;
  oscA.connect(filter);
  oscB.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  oscA.start();
  oscB.start();
  return {
    oscA,
    oscB,
    filter,
    gain,
    wasRunning: false,
    dispose() {
      oscA.stop();
      oscB.stop();
      oscA.disconnect();
      oscB.disconnect();
      filter.disconnect();
      gain.disconnect();
    },
  };
}

/** A tone that can pulse: `osc` through `filter` into `gain` (the audible center level),
 * with `lfo` connected through `lfoDepth` straight into `gain.gain` itself — real Web
 * Audio audio-rate parameter modulation, additive on top of `gain.gain.value`, which is
 * exactly "a tone that swells around its own center level at `lfo`'s own rate". Setting
 * `lfoDepth.gain.value` to `0` leaves the tone perfectly steady without silencing it —
 * `params.ts`'s `pulseDepthGain` does exactly that under reduced motion. Reused for the
 * conveyor, wrapper and alarm-annunciator cues; only the tone type and the parameters
 * `params.ts` computes differ between them. */
interface PulsingVoice {
  readonly osc: OscillatorNodeLike;
  readonly filter: BiquadFilterNodeLike;
  readonly gain: GainNodeLike;
  readonly lfo: OscillatorNodeLike;
  readonly lfoDepth: GainNodeLike;
  dispose(): void;
}

function createPulsingVoice(context: AudioContextLike, master: GainNodeLike, oscType: string): PulsingVoice {
  const osc = context.createOscillator();
  osc.type = oscType;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 4;
  const gain = context.createGain();
  gain.gain.value = 0;
  const lfo = context.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 1;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 0;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  lfo.connect(lfoDepth);
  lfoDepth.connect(gain.gain);
  osc.start();
  lfo.start();

  return {
    osc,
    filter,
    gain,
    lfo,
    lfoDepth,
    dispose() {
      osc.stop();
      lfo.stop();
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
      lfo.disconnect();
      lfoDepth.disconnect();
    },
  };
}

function applyPulsingVoice(voice: PulsingVoice, params: PulseAudioParams): void {
  voice.osc.frequency.value = params.toneHz;
  voice.lfo.frequency.value = params.pulseHz;
  voice.gain.gain.value = params.centerGain;
  voice.lfoDepth.gain.value = params.pulseDepthGain;
}

// ---------------------------------------------------------------------------
// Per-machine voice: dispatches on role. `extractor` and `generic` machines have no
// per-machine cue of their own — their only audible contribution is through the
// whole-plant extractor hum (`extractorAudioParams`), which already counts every
// running machine regardless of role.
// ---------------------------------------------------------------------------

type MachineVoice =
  | { readonly role: 'mixer'; readonly tone: ToneVoice; dispose(): void }
  | { readonly role: 'oven'; readonly flame: FlameVoice; dispose(): void }
  | { readonly role: 'conveyor'; readonly pulse: PulsingVoice; dispose(): void }
  | { readonly role: 'wrapper'; readonly pulse: PulsingVoice; dispose(): void }
  | { readonly role: 'extractor' | 'generic'; dispose(): void };

function createMachineVoice(context: AudioContextLike, master: GainNodeLike, role: MachineRole): MachineVoice {
  switch (role) {
    case 'mixer': {
      const tone = createToneVoice(context, master, 'sawtooth');
      return { role, tone, dispose: () => tone.dispose() };
    }
    case 'oven': {
      const flame = createFlameVoice(context, master);
      return { role, flame, dispose: () => flame.dispose() };
    }
    case 'conveyor': {
      const pulse = createPulsingVoice(context, master, 'square');
      return { role, pulse, dispose: () => pulse.dispose() };
    }
    case 'wrapper': {
      const pulse = createPulsingVoice(context, master, 'square');
      return { role, pulse, dispose: () => pulse.dispose() };
    }
    case 'extractor':
    case 'generic':
      return { role, dispose: () => {} };
  }
}

function applyMachineVoice(
  context: AudioContextLike,
  voice: MachineVoice,
  machine: MachineSnapshot,
  reducedMotion: boolean,
): void {
  switch (voice.role) {
    case 'mixer': {
      const params = mixerAudioParams(machine);
      voice.tone.osc.frequency.value = params.frequencyHz;
      voice.tone.filter.frequency.value = params.filterCutoffHz;
      voice.tone.gain.gain.value = params.gain;
      return;
    }
    case 'oven': {
      const params = ovenAudioParams(machine);
      voice.flame.oscA.frequency.value = params.frequencyHz;
      voice.flame.oscB.frequency.value = params.frequencyHz;
      voice.flame.filter.frequency.value = params.filterCutoffHz;
      const ignited = machine.running && !voice.flame.wasRunning;
      scheduleEnvelope(
        context,
        voice.flame.gain.gain,
        params.gain,
        ignited ? { peakValue: OVEN_IGNITION_PEAK_GAIN, decaySeconds: OVEN_IGNITION_DECAY_SECONDS } : undefined,
      );
      voice.flame.wasRunning = machine.running;
      return;
    }
    case 'conveyor':
      applyPulsingVoice(voice.pulse, conveyorAudioParams(machine, reducedMotion));
      return;
    case 'wrapper':
      applyPulsingVoice(voice.pulse, wrapperAudioParams(machine, reducedMotion));
      return;
    case 'extractor':
    case 'generic':
      return;
  }
}

// ---------------------------------------------------------------------------
// The engine itself.
// ---------------------------------------------------------------------------

export class PlantAudioEngine {
  readonly #context: AudioContextLike;
  readonly #master: GainNodeLike;
  readonly #extractor: ToneVoice;
  readonly #annunciator: PulsingVoice;
  readonly #machineVoices = new Map<string, MachineVoice>();
  #muted = false;

  constructor(context: AudioContextLike) {
    this.#context = context;
    this.#master = context.createGain();
    this.#master.gain.value = 1;
    this.#master.connect(context.destination);
    this.#extractor = createToneVoice(context, this.#master, 'sawtooth');
    this.#extractor.osc.frequency.value = EXTRACTOR_HUM_HZ;
    this.#extractor.filter.frequency.value = EXTRACTOR_FILTER_HZ;
    this.#annunciator = createPulsingVoice(context, this.#master, 'square');
  }

  /** Whether the whole plant is silenced — `RendererContext.preferences().muted`
   * (`context.ts`) reflected straight onto the master gain, independent of every other
   * parameter this engine tracks, so muting is total and immediate regardless of what
   * is currently sounding. */
  setMuted(muted: boolean): void {
    this.#muted = muted;
    this.#master.gain.value = muted ? 0 : 1;
  }

  get muted(): boolean {
    return this.#muted;
  }

  update(snapshot: WorldSnapshot, preferences: EnginePreferences): void {
    const extractor = extractorAudioParams(snapshot);
    this.#extractor.gain.gain.value = extractor.gain;

    const annunciator = annunciatorParams(snapshot, preferences.reducedMotion);
    applyPulsingVoice(this.#annunciator, annunciator);

    const seenIds = new Set<string>();
    for (const machine of snapshot.machines) {
      seenIds.add(machine.id);
      const role = classifyMachine(machine);
      let voice = this.#machineVoices.get(machine.id);
      if (!voice || voice.role !== role) {
        voice?.dispose();
        voice = createMachineVoice(this.#context, this.#master, role);
        this.#machineVoices.set(machine.id, voice);
      }
      applyMachineVoice(this.#context, voice, machine, preferences.reducedMotion);
    }

    // A machine id present in a previous snapshot but not this one (never happens with
    // the two fixed rigs `sim-worker/machines.ts` wires today, but this engine makes no
    // assumption that the machine list is fixed) has its voice torn down rather than
    // left sounding forever on stale parameters.
    for (const [id, voice] of this.#machineVoices) {
      if (seenIds.has(id)) continue;
      voice.dispose();
      this.#machineVoices.delete(id);
    }
  }

  dispose(): void {
    this.#extractor.dispose();
    this.#annunciator.dispose();
    for (const voice of this.#machineVoices.values()) voice.dispose();
    this.#machineVoices.clear();
    this.#master.disconnect();
  }
}
