/**
 * A minimal, hand-written Web Audio stand-in for this module's own tests — the audio
 * equivalent of `kit/testSupport/fakeDom.ts`'s doc comment: there is no real
 * `AudioContext` under Vitest's Node environment (nor in `happy-dom`, which does not
 * implement Web Audio either), and this task requires the engine to build its whole
 * graph against exactly this kind of minimal fake, not a real one. Implements only
 * `graph.ts`'s `AudioContextLike` surface, nothing more. Production code never imports
 * this file; only `*.spec.ts` files do.
 */

import type {
  AudioContextLike,
  AudioContextStateLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from '../graph.js';

export class FakeAudioParam implements AudioParamLike {
  value: number;
  /** Every automation call this param has received, in order — lets a test assert an
   * ignition transient scheduled a real ramp rather than only checking the final value. */
  readonly calls: (
    | { readonly kind: 'setValueAtTime'; readonly value: number; readonly time: number }
    | { readonly kind: 'linearRampToValueAtTime'; readonly value: number; readonly time: number }
    | { readonly kind: 'cancelScheduledValues'; readonly time: number }
  )[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.value = value;
    this.calls.push({ kind: 'setValueAtTime', value, time: startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.value = value;
    this.calls.push({ kind: 'linearRampToValueAtTime', value, time: endTime });
  }

  cancelScheduledValues(startTime: number): void {
    this.calls.push({ kind: 'cancelScheduledValues', time: startTime });
  }
}

/** An `AudioParamLike` with no automation methods at all — the "minimal fake" the task
 * brief specifically asks the engine to build against, so `scheduleEnvelope`
 * (`engine.ts`) is exercised on its plain-assignment fallback path too. */
export class BareAudioParam implements AudioParamLike {
  value: number;
  constructor(initial = 0) {
    this.value = initial;
  }
}

abstract class FakeAudioNode implements AudioNodeLike {
  readonly connections: (AudioNodeLike | AudioParamLike)[] = [];
  disconnectCalls = 0;

  connect(destination: AudioNodeLike | AudioParamLike): unknown {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.connections.length = 0;
  }
}

export class FakeOscillatorNode extends FakeAudioNode implements OscillatorNodeLike {
  type = 'sine';
  readonly frequency: AudioParamLike;
  readonly detune: AudioParamLike;
  startCalls = 0;
  stopCalls = 0;

  constructor(paramFactory: (initial?: number) => AudioParamLike) {
    super();
    this.frequency = paramFactory(440);
    this.detune = paramFactory(0);
  }

  start(): void {
    this.startCalls += 1;
  }

  stop(): void {
    this.stopCalls += 1;
  }
}

export class FakeGainNode extends FakeAudioNode implements GainNodeLike {
  readonly gain: AudioParamLike;
  constructor(paramFactory: (initial?: number) => AudioParamLike) {
    super();
    this.gain = paramFactory(1);
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode implements BiquadFilterNodeLike {
  type = 'lowpass';
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
  constructor(paramFactory: (initial?: number) => AudioParamLike) {
    super();
    this.frequency = paramFactory(350);
    this.Q = paramFactory(1);
  }
}

export interface FakeAudioContextOptions {
  /** Whether the fake's own `AudioParam`s support automation (`setValueAtTime` etc.) —
   * `false` produces `BareAudioParam`s, exercising `engine.ts`'s fallback path. Defaults
   * to `true` (the more common, more capable fake). */
  readonly automatedParams?: boolean;
}

export class FakeAudioContext implements AudioContextLike {
  state: AudioContextStateLike = 'suspended';
  currentTime = 0;
  readonly destination: AudioNodeLike = new (class extends FakeAudioNode {})();
  readonly oscillators: FakeOscillatorNode[] = [];
  readonly gains: FakeGainNode[] = [];
  readonly filters: FakeBiquadFilterNode[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;

  readonly #paramFactory: (initial?: number) => AudioParamLike;

  constructor(options: FakeAudioContextOptions = {}) {
    this.#paramFactory = options.automatedParams === false ? (v) => new BareAudioParam(v) : (v) => new FakeAudioParam(v);
  }

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode(this.#paramFactory);
    this.oscillators.push(node);
    return node;
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode(this.#paramFactory);
    this.gains.push(node);
    return node;
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    const node = new FakeBiquadFilterNode(this.#paramFactory);
    this.filters.push(node);
    return node;
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
  }
}
