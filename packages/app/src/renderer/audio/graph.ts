/**
 * The minimal Web Audio surface this module needs, named as its own interfaces rather
 * than the real DOM `AudioContext`/`AudioNode`/`AudioParam` types.
 *
 * Two reasons: `engine.ts` must build and update its whole node graph in a test with no
 * real `AudioContext` at all (jsdom/happy-dom do not implement Web Audio), and the task
 * requires exactly that — "the audio graph builds without a real AudioContext (inject a
 * minimal fake)". Declaring the real DOM lib types as the parameter types would make
 * that fake responsible for satisfying a much larger surface than this module actually
 * calls. A real browser `AudioContext` still satisfies every interface here structurally
 * (TypeScript's usual duck typing), so `createBrowserAudioContext` below can hand one
 * straight to `engine.ts` with no adapter layer.
 *
 * `connect`'s destination is typed loosely (`AudioNodeLike | AudioParamLike`, return
 * `unknown`) rather than modelling the real, overloaded `AudioNode.connect` signature
 * exactly (`(node) => AudioNode` vs `(param) => void`) — this module never uses the
 * return value, and the real method's overload set is otherwise a poor match for a
 * single structural interface.
 */

/** An `AudioParam`-shaped target: `.value` is the only thing every cue in this module
 * reads or writes unconditionally. The three automation methods are declared optional
 * so a minimal test fake can implement only `.value` and still satisfy this type — see
 * `engine.ts`'s `scheduleEnvelope`, which checks for their presence before using them
 * and falls back to a plain assignment otherwise. */
export interface AudioParamLike {
  value: number;
  setValueAtTime?(value: number, startTime: number): unknown;
  linearRampToValueAtTime?(value: number, endTime: number): unknown;
  cancelScheduledValues?(startTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike | AudioParamLike): unknown;
  disconnect(): void;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  readonly detune: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export type AudioContextStateLike = 'suspended' | 'running' | 'closed';

export interface AudioContextLike {
  readonly state: AudioContextStateLike;
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close?(): Promise<void>;
}

/**
 * Constructs a real browser `AudioContext`, or `null` if Web Audio is unavailable in
 * this window (an older WebKit only exposes `webkitAudioContext`; a build running
 * somewhere with no audio subsystem at all exposes neither) or construction itself
 * throws for any other reason. Never throws — "a build that cannot make sound must
 * still run" is a hard requirement on this whole module, and this factory is the one
 * place a real, unpredictable browser API is invoked.
 */
export function createBrowserAudioContext(): AudioContextLike | null {
  try {
    const globalWithAudio = globalThis as {
      AudioContext?: new () => AudioContextLike;
      webkitAudioContext?: new () => AudioContextLike;
    };
    const Constructor = globalWithAudio.AudioContext ?? globalWithAudio.webkitAudioContext;
    if (!Constructor) return null;
    return new Constructor();
  } catch {
    return null;
  }
}
