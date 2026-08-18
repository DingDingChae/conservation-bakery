import { describe, expect, it } from 'vitest';

import {
  ALARM_ACTIVE_GAIN,
  ALARM_MAX_HZ,
  ALARM_MIN_HZ,
  ALARM_PULSE_DEPTH,
  CONVEYOR_MAX_PULSE_HZ,
  CONVEYOR_MIN_PULSE_HZ,
  CONVEYOR_PULSE_DEPTH,
  CONVEYOR_RUNNING_GAIN,
  EXTRACTOR_IDLE_GAIN,
  EXTRACTOR_LOAD_GAIN_BOOST,
  MIXER_FILTER_MAX_HZ,
  MIXER_FILTER_MIN_HZ,
  MIXER_MAX_HZ,
  MIXER_MIN_HZ,
  MIXER_RUNNING_GAIN,
  OVEN_FILTER_MAX_HZ,
  OVEN_FILTER_MIN_HZ,
  OVEN_IDLE_GAIN,
  OVEN_MAX_HZ,
  OVEN_MIN_HZ,
  OVEN_RAMP_GAIN_BOOST,
  WRAPPER_PULSE_DEPTH,
  WRAPPER_RUNNING_GAIN,
  annunciatorParams,
  conveyorAudioParams,
  extractorAudioParams,
  mixerAudioParams,
  ovenAudioParams,
  wrapperAudioParams,
} from './params.js';
import { alarm, conveyorMachine, mixerMachine, ovenMachine, wrapperMachine, worldSnapshot } from './testSupport/fixtures.js';

describe('mixerAudioParams', () => {
  it('sits at the bottom of the pitch range, unloaded, at zero speed', () => {
    const params = mixerAudioParams(
      mixerMachine({
        tags: [
          { id: 'mix-speed-rpm', label: '', unit: 'rpm', value: 0, setpoint: 0, rangeLow: 0, rangeHigh: 200 },
          { id: 'batch-mass-kg', label: '', unit: 'kg', value: 0, setpoint: null, rangeLow: 0, rangeHigh: 2_000 },
        ],
      }),
    );
    expect(params.frequencyHz).toBeCloseTo(MIXER_MIN_HZ);
    expect(params.filterCutoffHz).toBeCloseTo(MIXER_FILTER_MAX_HZ);
    expect(params.gain).toBe(MIXER_RUNNING_GAIN);
  });

  it('sags in pitch and darkens in tone at full speed and full load', () => {
    const params = mixerAudioParams(
      mixerMachine({
        tags: [
          { id: 'mix-speed-rpm', label: '', unit: 'rpm', value: 200, setpoint: 200, rangeLow: 0, rangeHigh: 200 },
          { id: 'batch-mass-kg', label: '', unit: 'kg', value: 2_000, setpoint: null, rangeLow: 0, rangeHigh: 2_000 },
        ],
      }),
    );
    // Full load sags the pitch below the unloaded top-speed frequency — audible strain.
    expect(params.frequencyHz).toBeLessThan(MIXER_MAX_HZ);
    expect(params.frequencyHz).toBeGreaterThan(MIXER_MIN_HZ);
    expect(params.filterCutoffHz).toBeCloseTo(MIXER_FILTER_MIN_HZ);
  });

  it('is silent when not running, regardless of speed or load', () => {
    const params = mixerAudioParams(mixerMachine({ running: false }));
    expect(params.gain).toBe(0);
  });

  it('does not throw and produces a finite, silent result for a mixer with no speed/load tags at all', () => {
    const params = mixerAudioParams(mixerMachine({ tags: [], running: true }));
    expect(Number.isFinite(params.frequencyHz)).toBe(true);
    expect(params.frequencyHz).toBeCloseTo(MIXER_MIN_HZ);
    expect(params.gain).toBe(MIXER_RUNNING_GAIN);
  });
});

describe('ovenAudioParams', () => {
  it('idles quietly right at setpoint', () => {
    const params = ovenAudioParams(
      ovenMachine({
        tags: [
          { id: 'bake-temp-setpoint-c', label: '', unit: 'C', value: 180, setpoint: 180, rangeLow: 20, rangeHigh: 260 },
          { id: 'bake-temp-c', label: '', unit: 'C', value: 180, setpoint: null, rangeLow: 0, rangeHigh: 300 },
        ],
      }),
    );
    expect(params.deficitFraction).toBeCloseTo(0);
    expect(params.gain).toBeCloseTo(OVEN_IDLE_GAIN);
    expect(params.frequencyHz).toBeCloseTo(OVEN_MIN_HZ);
    expect(params.filterCutoffHz).toBeCloseTo(OVEN_FILTER_MIN_HZ);
  });

  it('roars harder the further below setpoint it is running', () => {
    const params = ovenAudioParams(
      ovenMachine({
        tags: [
          { id: 'bake-temp-setpoint-c', label: '', unit: 'C', value: 260, setpoint: 260, rangeLow: 20, rangeHigh: 260 },
          { id: 'bake-temp-c', label: '', unit: 'C', value: -40, setpoint: null, rangeLow: 0, rangeHigh: 300 },
        ],
      }),
    );
    expect(params.deficitFraction).toBeCloseTo(1);
    expect(params.gain).toBeCloseTo(OVEN_IDLE_GAIN + OVEN_RAMP_GAIN_BOOST);
    expect(params.frequencyHz).toBeCloseTo(OVEN_MAX_HZ);
    expect(params.filterCutoffHz).toBeCloseTo(OVEN_FILTER_MAX_HZ);
  });

  it('is silent when not running, even mid-ramp', () => {
    const params = ovenAudioParams(ovenMachine({ running: false }));
    expect(params.gain).toBe(0);
  });
});

describe('extractorAudioParams', () => {
  it('is silent with no machines at all', () => {
    expect(extractorAudioParams(worldSnapshot([])).gain).toBe(0);
  });

  it('is silent with every machine stopped', () => {
    const snapshot = worldSnapshot([mixerMachine({ running: false }), ovenMachine({ running: false })]);
    expect(extractorAudioParams(snapshot).gain).toBe(0);
  });

  it('scales up as more of the plant is running', () => {
    const halfRunning = extractorAudioParams(worldSnapshot([mixerMachine({ running: true }), ovenMachine({ running: false })]));
    const allRunning = extractorAudioParams(worldSnapshot([mixerMachine({ running: true }), ovenMachine({ running: true })]));
    expect(halfRunning.gain).toBeCloseTo(EXTRACTOR_IDLE_GAIN + 0.5 * EXTRACTOR_LOAD_GAIN_BOOST);
    expect(allRunning.gain).toBeCloseTo(EXTRACTOR_IDLE_GAIN + EXTRACTOR_LOAD_GAIN_BOOST);
    expect(allRunning.gain).toBeGreaterThan(halfRunning.gain);
  });
});

describe('conveyorAudioParams', () => {
  it('ties its pulse rate to a real speed tag when the machine has one', () => {
    const slow = conveyorAudioParams(conveyorMachine({ tags: [{ id: 'line-speed-m-min', label: '', unit: 'm/min', value: 0, setpoint: null, rangeLow: 0, rangeHigh: 12 }] }), false);
    const fast = conveyorAudioParams(conveyorMachine({ tags: [{ id: 'line-speed-m-min', label: '', unit: 'm/min', value: 12, setpoint: null, rangeLow: 0, rangeHigh: 12 }] }), false);
    expect(slow.pulseHz).toBeCloseTo(CONVEYOR_MIN_PULSE_HZ);
    expect(fast.pulseHz).toBeCloseTo(CONVEYOR_MAX_PULSE_HZ);
    expect(slow.centerGain).toBe(CONVEYOR_RUNNING_GAIN);
  });

  it('is silent when not running, regardless of its speed tag', () => {
    const params = conveyorAudioParams(conveyorMachine({ running: false }), false);
    expect(params.centerGain).toBe(0);
    expect(params.pulseDepthGain).toBe(0);
  });

  it('never pulses under reduced motion, but stays audible', () => {
    const params = conveyorAudioParams(conveyorMachine({ running: true }), true);
    expect(params.pulseDepthGain).toBe(0);
    expect(params.centerGain).toBeGreaterThan(0);
  });

  it('pulses when running and motion is not reduced', () => {
    const params = conveyorAudioParams(conveyorMachine({ running: true }), false);
    expect(params.pulseDepthGain).toBe(CONVEYOR_PULSE_DEPTH);
  });
});

describe('wrapperAudioParams', () => {
  it('is silent when not running', () => {
    const params = wrapperAudioParams(wrapperMachine({ running: false }), false);
    expect(params.centerGain).toBe(0);
    expect(params.pulseDepthGain).toBe(0);
  });

  it('pulses at its nominal cycle rate while running, unless motion is reduced', () => {
    const normal = wrapperAudioParams(wrapperMachine({ running: true }), false);
    const reduced = wrapperAudioParams(wrapperMachine({ running: true }), true);
    expect(normal.centerGain).toBe(WRAPPER_RUNNING_GAIN);
    expect(normal.pulseDepthGain).toBe(WRAPPER_PULSE_DEPTH);
    expect(reduced.pulseDepthGain).toBe(0);
    expect(reduced.centerGain).toBe(WRAPPER_RUNNING_GAIN);
  });
});

describe('annunciatorParams', () => {
  it('is inactive and silent with no alarms at all', () => {
    const params = annunciatorParams(worldSnapshot([mixerMachine()]), false);
    expect(params.active).toBe(false);
    expect(params.centerGain).toBe(0);
    expect(params.pulseDepthGain).toBe(0);
  });

  it('is inactive when every alarm is acknowledged, cleared, or normal', () => {
    const snapshot = worldSnapshot([
      mixerMachine({
        alarms: [
          alarm({ id: 'a', state: 'active-acknowledged' }),
          alarm({ id: 'b', state: 'cleared' }),
          alarm({ id: 'c', state: 'normal' }),
        ],
      }),
    ]);
    expect(annunciatorParams(snapshot, false).active).toBe(false);
  });

  it('latches on the instant any alarm anywhere is active-unacknowledged', () => {
    const snapshot = worldSnapshot([ovenMachine({ alarms: [alarm({ id: 'over-temp', state: 'active-unacknowledged', priority: 1 })] })]);
    const params = annunciatorParams(snapshot, false);
    expect(params.active).toBe(true);
    expect(params.centerGain).toBe(ALARM_ACTIVE_GAIN);
    expect(params.pulseDepthGain).toBe(ALARM_PULSE_DEPTH);
  });

  it('pitches the most urgent (lowest-priority-number) unacknowledged alarm the highest', () => {
    const urgent = annunciatorParams(
      worldSnapshot([mixerMachine({ alarms: [alarm({ id: 'a', state: 'active-unacknowledged', priority: 1 })] })]),
      false,
    );
    const mild = annunciatorParams(
      worldSnapshot([mixerMachine({ alarms: [alarm({ id: 'a', state: 'active-unacknowledged', priority: 5 })] })]),
      false,
    );
    expect(urgent.toneHz).toBeCloseTo(ALARM_MAX_HZ);
    expect(mild.toneHz).toBeCloseTo(ALARM_MIN_HZ);
    expect(urgent.toneHz).toBeGreaterThan(mild.toneHz);
  });

  it('never pulses under reduced motion, even while latched active', () => {
    const snapshot = worldSnapshot([mixerMachine({ alarms: [alarm({ id: 'a', state: 'active-unacknowledged', priority: 1 })] })]);
    const params = annunciatorParams(snapshot, true);
    expect(params.active).toBe(true);
    expect(params.centerGain).toBe(ALARM_ACTIVE_GAIN);
    expect(params.pulseDepthGain).toBe(0);
  });

  it('stops the instant acknowledging clears the last unacknowledged alarm', () => {
    const raised = worldSnapshot([ovenMachine({ alarms: [alarm({ id: 'over-temp', state: 'active-unacknowledged', priority: 1 })] })]);
    const acknowledged = worldSnapshot([ovenMachine({ alarms: [alarm({ id: 'over-temp', state: 'active-acknowledged', priority: 1 })] })]);
    expect(annunciatorParams(raised, false).active).toBe(true);
    expect(annunciatorParams(acknowledged, false).active).toBe(false);
  });
});
