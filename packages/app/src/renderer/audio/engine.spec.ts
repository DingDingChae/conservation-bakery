import { describe, expect, it } from 'vitest';

import { PlantAudioEngine } from './engine.js';
import { OVEN_IGNITION_PEAK_GAIN, MIXER_MIN_HZ, MIXER_MAX_HZ } from './params.js';
import { FakeAudioContext, FakeAudioParam } from './testSupport/fakeAudioContext.js';
import { conveyorMachine, mixerMachine, ovenMachine, tag, wrapperMachine, worldSnapshot, alarm } from './testSupport/fixtures.js';

describe('PlantAudioEngine: construction', () => {
  it('builds its whole graph against a minimal fake with no automation methods at all', () => {
    const context = new FakeAudioContext({ automatedParams: false });
    expect(() => {
      const engine = new PlantAudioEngine(context);
      engine.update(worldSnapshot([mixerMachine(), ovenMachine({ running: false })]), { reducedMotion: false });
      engine.update(worldSnapshot([mixerMachine(), ovenMachine({ running: true })]), { reducedMotion: false });
      engine.dispose();
    }).not.toThrow();
  });

  it('connects its master gain to the destination', () => {
    const context = new FakeAudioContext();
    new PlantAudioEngine(context);
    const master = context.gains[0]!;
    expect(master.connections).toContain(context.destination);
  });

  it('starts every oscillator exactly once, never left un-started', () => {
    const context = new FakeAudioContext();
    new PlantAudioEngine(context);
    for (const osc of context.oscillators) expect(osc.startCalls).toBe(1);
  });
});

describe('PlantAudioEngine: muting', () => {
  it('genuinely silences the whole plant, independent of every other parameter', () => {
    const context = new FakeAudioContext();
    const engine = new PlantAudioEngine(context);
    const master = context.gains[0]!;
    expect(master.gain.value).toBe(1);

    engine.setMuted(true);
    expect(master.gain.value).toBe(0);
    expect(engine.muted).toBe(true);

    engine.update(worldSnapshot([mixerMachine({ running: true })]), { reducedMotion: false });
    expect(master.gain.value).toBe(0);

    engine.setMuted(false);
    expect(master.gain.value).toBe(1);
    expect(engine.muted).toBe(false);
  });
});

describe('PlantAudioEngine: mixer', () => {
  it('drives frequency and gain from the mixer machine’s own speed and load tags', () => {
    const context = new FakeAudioContext();
    const engine = new PlantAudioEngine(context);
    const baseline = { osc: context.oscillators.length, gain: context.gains.length, filter: context.filters.length };

    engine.update(
      worldSnapshot([
        mixerMachine({
          running: true,
          tags: [
            tag({ id: 'mix-speed-rpm', unit: 'rpm', value: 0, setpoint: 0, rangeLow: 0, rangeHigh: 200 }),
            tag({ id: 'batch-mass-kg', unit: 'kg', value: 0, rangeLow: 0, rangeHigh: 2_000 }),
          ],
        }),
      ]),
      { reducedMotion: false },
    );

    const osc = context.oscillators.slice(baseline.osc);
    const gains = context.gains.slice(baseline.gain);
    const filters = context.filters.slice(baseline.filter);
    expect(osc).toHaveLength(1);
    expect(gains).toHaveLength(1);
    expect(filters).toHaveLength(1);
    expect(osc[0]!.frequency.value).toBeCloseTo(MIXER_MIN_HZ);
    expect(gains[0]!.gain.value).toBeGreaterThan(0);

    // Same machine id, next tick: full speed and full load. No new nodes are created —
    // only the existing ones' parameters move.
    engine.update(
      worldSnapshot([
        mixerMachine({
          running: true,
          tags: [
            tag({ id: 'mix-speed-rpm', unit: 'rpm', value: 200, setpoint: 200, rangeLow: 0, rangeHigh: 200 }),
            tag({ id: 'batch-mass-kg', unit: 'kg', value: 2_000, rangeLow: 0, rangeHigh: 2_000 }),
          ],
        }),
      ]),
      { reducedMotion: false },
    );
    expect(context.oscillators.length).toBe(baseline.osc + 1);
    expect(osc[0]!.frequency.value).toBeGreaterThan(MIXER_MIN_HZ);
    expect(osc[0]!.frequency.value).toBeLessThan(MIXER_MAX_HZ); // sagged under full load
  });

  it('tears down a machine’s voice the instant it disappears from a later snapshot', () => {
    const context = new FakeAudioContext();
    const engine = new PlantAudioEngine(context);
    const baseline = context.oscillators.length;

    engine.update(worldSnapshot([mixerMachine()]), { reducedMotion: false });
    const osc = context.oscillators[baseline]!;
    expect(osc.stopCalls).toBe(0);

    engine.update(worldSnapshot([]), { reducedMotion: false });
    expect(osc.stopCalls).toBe(1);
    expect(osc.disconnectCalls).toBeGreaterThan(0);
  });
});

describe('PlantAudioEngine: oven ignition transient', () => {
  it('schedules a real peak-then-decay envelope the instant the oven starts running', () => {
    const context = new FakeAudioContext();
    const engine = new PlantAudioEngine(context);
    const baseline = context.gains.length;

    engine.update(worldSnapshot([ovenMachine({ running: false })]), { reducedMotion: false });
    const flameGain = context.gains[baseline]!;
    expect(flameGain.gain.value).toBe(0);
    expect((flameGain.gain as FakeAudioParam).calls).toHaveLength(0);

    engine.update(worldSnapshot([ovenMachine({ running: true })]), { reducedMotion: false });
    const calls = (flameGain.gain as FakeAudioParam).calls;
    expect(calls.some((call) => call.kind === 'setValueAtTime' && call.value === OVEN_IGNITION_PEAK_GAIN)).toBe(true);
    expect(calls.some((call) => call.kind === 'linearRampToValueAtTime')).toBe(true);

    // Running continuously on the next tick is not a fresh ignition — no new transient.
    const callsAfterIgnition = calls.length;
    engine.update(worldSnapshot([ovenMachine({ running: true })]), { reducedMotion: false });
    expect((flameGain.gain as FakeAudioParam).calls.length).toBe(callsAfterIgnition);
  });

  it('falls back to a plain assignment against a minimal fake with no automation methods', () => {
    const context = new FakeAudioContext({ automatedParams: false });
    const engine = new PlantAudioEngine(context);
    expect(() => {
      engine.update(worldSnapshot([ovenMachine({ running: false })]), { reducedMotion: false });
      engine.update(worldSnapshot([ovenMachine({ running: true })]), { reducedMotion: false });
    }).not.toThrow();
  });
});

describe('PlantAudioEngine: reduced motion', () => {
  it('leaves a conveyor’s tone steady (no pulse depth) under reduced motion, still audible', () => {
    const context = new FakeAudioContext();
    const engine = new PlantAudioEngine(context);
    const baseline = context.gains.length;

    engine.update(worldSnapshot([conveyorMachine({ running: true })]), { reducedMotion: false });
    const [centerGain, lfoDepthGain] = context.gains.slice(baseline);
    expect(lfoDepthGain!.gain.value).toBeGreaterThan(0);

    engine.update(worldSnapshot([conveyorMachine({ running: true })]), { reducedMotion: true });
    expect(lfoDepthGain!.gain.value).toBe(0);
    expect(centerGain!.gain.value).toBeGreaterThan(0);
  });

  it('applies the same reduced-motion contract to the wrapper cycle cue', () => {
    const context = new FakeAudioContext();
    const engine = new PlantAudioEngine(context);
    const baseline = context.gains.length;

    engine.update(worldSnapshot([wrapperMachine({ running: true })]), { reducedMotion: true });
    const [centerGain, lfoDepthGain] = context.gains.slice(baseline);
    expect(centerGain!.gain.value).toBeGreaterThan(0);
    expect(lfoDepthGain!.gain.value).toBe(0);
  });
});

describe('PlantAudioEngine: alarm annunciator', () => {
  it('latches on for an unacknowledged alarm and stops the instant it is acknowledged', () => {
    const context = new FakeAudioContext();
    const engine = new PlantAudioEngine(context);
    // The annunciator voice is created once, in the constructor, ahead of any machine —
    // its gain is always context.gains[2] given the fixed construction order
    // (master, extractor gain, annunciator gain, annunciator lfoDepth).
    const annunciatorGain = context.gains[2]!;

    engine.update(worldSnapshot([mixerMachine()]), { reducedMotion: false });
    expect(annunciatorGain.gain.value).toBe(0);

    engine.update(
      worldSnapshot([ovenMachine({ alarms: [alarm({ id: 'over-temp', state: 'active-unacknowledged', priority: 1 })] })]),
      { reducedMotion: false },
    );
    expect(annunciatorGain.gain.value).toBeGreaterThan(0);

    engine.update(
      worldSnapshot([ovenMachine({ alarms: [alarm({ id: 'over-temp', state: 'active-acknowledged', priority: 1 })] })]),
      { reducedMotion: false },
    );
    expect(annunciatorGain.gain.value).toBe(0);
  });
});

describe('PlantAudioEngine: extractor ambient hum', () => {
  it('scales with the real fraction of the whole plant that is running', () => {
    const context = new FakeAudioContext();
    const engine = new PlantAudioEngine(context);
    const extractorGain = context.gains[1]!; // master, then extractor gain, per construction order

    engine.update(worldSnapshot([mixerMachine({ running: false }), ovenMachine({ running: false })]), {
      reducedMotion: false,
    });
    expect(extractorGain.gain.value).toBe(0);

    engine.update(worldSnapshot([mixerMachine({ running: true }), ovenMachine({ running: true })]), {
      reducedMotion: false,
    });
    expect(extractorGain.gain.value).toBeGreaterThan(0);
  });
});

describe('PlantAudioEngine: dispose', () => {
  it('stops and disconnects every node it ever created', () => {
    const context = new FakeAudioContext();
    const engine = new PlantAudioEngine(context);
    engine.update(worldSnapshot([mixerMachine(), ovenMachine(), conveyorMachine(), wrapperMachine()]), {
      reducedMotion: false,
    });

    engine.dispose();

    for (const osc of context.oscillators) expect(osc.stopCalls).toBe(1);
    for (const gain of context.gains) expect(gain.disconnectCalls).toBeGreaterThan(0);
    for (const filter of context.filters) expect(filter.disconnectCalls).toBeGreaterThan(0);
  });
});
