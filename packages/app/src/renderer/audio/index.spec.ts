import { describe, expect, it } from 'vitest';

import { mountPlantAudio } from './index.js';
import { FakeAudioContext } from './testSupport/fakeAudioContext.js';
import { createFakeRendererContext, FakeGestureTarget } from './testSupport/fakeRendererContext.js';
import { mixerMachine, worldSnapshot } from './testSupport/fixtures.js';

describe('mountPlantAudio: Web Audio unavailable', () => {
  it('does not throw when there is no AudioContext to create at all', () => {
    const { context, emitSnapshot } = createFakeRendererContext();
    const gestureTarget = new FakeGestureTarget();

    expect(() => {
      const dispose = mountPlantAudio(context, { createAudioContext: () => null, gestureTarget });
      emitSnapshot(worldSnapshot([mixerMachine()]));
      gestureTarget.dispatch('pointerdown');
      dispose();
    }).not.toThrow();
  });

  it('does not throw when constructing the AudioContext itself throws', () => {
    const { context, emitSnapshot } = createFakeRendererContext();
    const gestureTarget = new FakeGestureTarget();

    expect(() => {
      const dispose = mountPlantAudio(context, {
        createAudioContext: () => {
          throw new Error('no audio subsystem in this window');
        },
        gestureTarget,
      });
      emitSnapshot(worldSnapshot([mixerMachine()]));
      dispose();
    }).not.toThrow();
  });
});

describe('mountPlantAudio: starts suspended until a real gesture', () => {
  it('explicitly suspends a context that was not already suspended', () => {
    const audioContext = new FakeAudioContext();
    audioContext.state = 'running';
    const { context } = createFakeRendererContext();
    const gestureTarget = new FakeGestureTarget();

    mountPlantAudio(context, { createAudioContext: () => audioContext, gestureTarget });

    expect(audioContext.suspendCalls).toBe(1);
  });

  it('does not call suspend on a context that already reports suspended', () => {
    const audioContext = new FakeAudioContext();
    expect(audioContext.state).toBe('suspended');
    const { context } = createFakeRendererContext();
    const gestureTarget = new FakeGestureTarget();

    mountPlantAudio(context, { createAudioContext: () => audioContext, gestureTarget });

    expect(audioContext.suspendCalls).toBe(0);
  });

  it('resumes only after a real pointerdown or keydown, never on its own', () => {
    const audioContext = new FakeAudioContext();
    const { context } = createFakeRendererContext();
    const gestureTarget = new FakeGestureTarget();

    mountPlantAudio(context, { createAudioContext: () => audioContext, gestureTarget });
    expect(audioContext.resumeCalls).toBe(0);

    gestureTarget.dispatch('pointerdown');
    expect(audioContext.resumeCalls).toBe(1);
  });

  it('stops listening for a gesture once disposed', () => {
    const audioContext = new FakeAudioContext();
    const { context } = createFakeRendererContext();
    const gestureTarget = new FakeGestureTarget();

    const dispose = mountPlantAudio(context, { createAudioContext: () => audioContext, gestureTarget });
    dispose();
    gestureTarget.dispatch('pointerdown');
    gestureTarget.dispatch('keydown');

    expect(audioContext.resumeCalls).toBe(0);
    expect(audioContext.closeCalls).toBe(1);
  });
});

describe('mountPlantAudio: preferences', () => {
  it('applies the muted preference immediately, before any snapshot ever arrives', () => {
    const audioContext = new FakeAudioContext();
    const { context } = createFakeRendererContext({ muted: true });

    mountPlantAudio(context, { createAudioContext: () => audioContext, gestureTarget: new FakeGestureTarget() });

    expect(audioContext.gains[0]!.gain.value).toBe(0);
  });

  it('reflects a later change to the muted preference onto the engine', () => {
    const audioContext = new FakeAudioContext();
    const { context, setPreferences } = createFakeRendererContext({ muted: false });

    mountPlantAudio(context, { createAudioContext: () => audioContext, gestureTarget: new FakeGestureTarget() });
    expect(audioContext.gains[0]!.gain.value).toBe(1);

    setPreferences({ muted: true });
    expect(audioContext.gains[0]!.gain.value).toBe(0);
  });
});

describe('mountPlantAudio: snapshots', () => {
  it('feeds an already-current snapshot to the engine immediately at mount time', () => {
    const audioContext = new FakeAudioContext();
    const { context, emitSnapshot } = createFakeRendererContext();
    emitSnapshot(worldSnapshot([mixerMachine({ running: true })]));
    const baselineOsc = audioContext.oscillators.length;

    mountPlantAudio(context, { createAudioContext: () => audioContext, gestureTarget: new FakeGestureTarget() });

    expect(audioContext.oscillators.length).toBeGreaterThan(baselineOsc);
  });

  it('keeps the engine updated as later snapshots arrive', () => {
    const audioContext = new FakeAudioContext();
    const { context, emitSnapshot } = createFakeRendererContext();

    mountPlantAudio(context, { createAudioContext: () => audioContext, gestureTarget: new FakeGestureTarget() });
    const baselineOsc = audioContext.oscillators.length;

    emitSnapshot(worldSnapshot([mixerMachine({ running: true })]));
    expect(audioContext.oscillators.length).toBeGreaterThan(baselineOsc);
  });

  it('stops applying snapshots once disposed', () => {
    const audioContext = new FakeAudioContext();
    const { context, emitSnapshot } = createFakeRendererContext();

    const dispose = mountPlantAudio(context, { createAudioContext: () => audioContext, gestureTarget: new FakeGestureTarget() });
    dispose();
    const afterDispose = audioContext.oscillators.length;

    expect(() => emitSnapshot(worldSnapshot([mixerMachine({ running: true })]))).not.toThrow();
    expect(audioContext.oscillators.length).toBe(afterDispose);
  });
});
