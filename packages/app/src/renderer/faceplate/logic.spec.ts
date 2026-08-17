import { describe, expect, it } from 'vitest';

import type { AlarmSnapshot } from '../../shared/ipc.js';
import {
  alarmStateCatalogueKey,
  alarmTransitionAnnouncement,
  availableAlarmAction,
  barMarkerPercent,
  deviationStatus,
  formatEngineeringValue,
  formatRange,
  isModeTransitionLegal,
  modeCatalogueKey,
  modeTransitionRefusal,
  MODE_ORDER,
  orderAlarms,
  pointsAttribute,
  pushTrendSample,
  sanitizeDomId,
  scaleTrendSeries,
  trendDomain,
  validateSetpointInput,
  type TrendSample,
} from './logic.js';

describe('mode transitions', () => {
  it('mirrors the simulation legal-transition table', () => {
    expect(isModeTransitionLegal('OFF', 'MANUAL', true)).toBe(true);
    expect(isModeTransitionLegal('OFF', 'SERVICE', true)).toBe(true);
    expect(isModeTransitionLegal('OFF', 'AUTO', true)).toBe(false);
    expect(isModeTransitionLegal('MANUAL', 'OFF', true)).toBe(true);
    expect(isModeTransitionLegal('MANUAL', 'AUTO', true)).toBe(true);
    expect(isModeTransitionLegal('MANUAL', 'SERVICE', true)).toBe(true);
    expect(isModeTransitionLegal('AUTO', 'MANUAL', true)).toBe(true);
    expect(isModeTransitionLegal('AUTO', 'SERVICE', true)).toBe(false);
    expect(isModeTransitionLegal('SERVICE', 'OFF', true)).toBe(true);
    expect(isModeTransitionLegal('SERVICE', 'MANUAL', true)).toBe(false);
  });

  it('treats staying in the current mode as legal, with no refusal', () => {
    for (const mode of MODE_ORDER) {
      expect(isModeTransitionLegal(mode, mode, true)).toBe(true);
      expect(modeTransitionRefusal(mode, mode, true)).toBeNull();
    }
  });

  it('refuses a running mode for an uncommissioned machine even if otherwise legal', () => {
    expect(isModeTransitionLegal('OFF', 'MANUAL', false)).toBe(false);
    expect(isModeTransitionLegal('OFF', 'SERVICE', false)).toBe(true); // SERVICE is not a running mode
  });

  it('reports a structured reason for an illegal transition', () => {
    expect(modeTransitionRefusal('AUTO', 'SERVICE', true)).toEqual({
      kind: 'illegal-transition',
      from: 'AUTO',
      to: 'SERVICE',
    });
  });

  it('reports a structured reason for an uncommissioned running-mode request', () => {
    expect(modeTransitionRefusal('OFF', 'MANUAL', false)).toEqual({ kind: 'not-commissioned' });
  });

  it('returns null for a legal transition', () => {
    expect(modeTransitionRefusal('OFF', 'MANUAL', true)).toBeNull();
  });

  it('maps every mode to its own catalogue key', () => {
    expect(modeCatalogueKey('OFF')).toBe('mode.off');
    expect(modeCatalogueKey('MANUAL')).toBe('mode.manual');
    expect(modeCatalogueKey('AUTO')).toBe('mode.auto');
    expect(modeCatalogueKey('SERVICE')).toBe('mode.service');
  });
});

describe('numeric formatting', () => {
  it('formats to one decimal by default', () => {
    expect(formatEngineeringValue(176)).toBe('176.0');
    expect(formatEngineeringValue(175.34)).toBe('175.3');
  });

  it('formats a range as low-en dash-high', () => {
    expect(formatRange(140, 220)).toBe('140.0–220.0');
  });

  it('clamps the bar marker into [0, 100] and handles a zero-span range', () => {
    expect(barMarkerPercent(180, 140, 220)).toBeCloseTo(50, 5);
    expect(barMarkerPercent(140, 140, 220)).toBeCloseTo(0, 5);
    expect(barMarkerPercent(220, 140, 220)).toBeCloseTo(100, 5);
    expect(barMarkerPercent(500, 140, 220)).toBe(100);
    expect(barMarkerPercent(-500, 140, 220)).toBe(0);
    expect(barMarkerPercent(100, 140, 140)).toBe(0);
  });
});

describe('deviation status', () => {
  it('reports no-setpoint for a read-only tag', () => {
    expect(deviationStatus(150, null, 140, 220)).toBe('no-setpoint');
  });

  it('reports within tolerance inside the tolerance band and a direction outside it', () => {
    // range span 80, tolerance = 2% * 80 = 1.6
    expect(deviationStatus(176, 176, 140, 220)).toBe('within-tolerance');
    expect(deviationStatus(177.5, 176, 140, 220)).toBe('within-tolerance');
    expect(deviationStatus(178, 176, 140, 220)).toBe('deviation-high');
    expect(deviationStatus(174, 176, 140, 220)).toBe('deviation-low');
  });
});

describe('setpoint validation', () => {
  it('accepts a value inside the range, inclusive of the bounds', () => {
    expect(validateSetpointInput('176', 140, 220)).toEqual({ ok: true, value: 176 });
    expect(validateSetpointInput('140', 140, 220)).toEqual({ ok: true, value: 140 });
    expect(validateSetpointInput('220', 140, 220)).toEqual({ ok: true, value: 220 });
  });

  it('rejects empty and non-numeric input with the right kind', () => {
    expect(validateSetpointInput('', 140, 220)).toEqual({ ok: false, kind: 'empty' });
    expect(validateSetpointInput('   ', 140, 220)).toEqual({ ok: false, kind: 'empty' });
    expect(validateSetpointInput('abc', 140, 220)).toEqual({ ok: false, kind: 'not-a-number' });
  });

  it('rejects out-of-range input, carrying the parsed value and the range', () => {
    expect(validateSetpointInput('139.9', 140, 220)).toEqual({
      ok: false,
      kind: 'out-of-range',
      value: 139.9,
      low: 140,
      high: 220,
    });
    expect(validateSetpointInput('220.1', 140, 220)).toEqual({
      ok: false,
      kind: 'out-of-range',
      value: 220.1,
      low: 140,
      high: 220,
    });
  });
});

function alarm(overrides: Partial<AlarmSnapshot> & Pick<AlarmSnapshot, 'id' | 'state'>): AlarmSnapshot {
  return {
    label: overrides.id,
    priority: 5,
    firstOut: false,
    raisedAtTick: 0,
    ...overrides,
  };
}

describe('alarm ordering', () => {
  it('puts the first-out alarm first regardless of its own state', () => {
    const alarms = [
      alarm({ id: 'b', state: 'active-unacknowledged', priority: 1 }),
      alarm({ id: 'a', state: 'cleared', priority: 9, firstOut: true }),
    ];
    expect(orderAlarms(alarms).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('otherwise orders by state urgency, then priority, then id', () => {
    const alarms = [
      alarm({ id: 'normal-1', state: 'normal' }),
      alarm({ id: 'cleared-1', state: 'cleared' }),
      alarm({ id: 'ack-1', state: 'active-acknowledged' }),
      alarm({ id: 'unack-b', state: 'active-unacknowledged', priority: 2 }),
      alarm({ id: 'unack-a', state: 'active-unacknowledged', priority: 1 }),
    ];
    expect(orderAlarms(alarms).map((a) => a.id)).toEqual([
      'unack-a',
      'unack-b',
      'ack-1',
      'cleared-1',
      'normal-1',
    ]);
  });

  it('does not mutate the input array', () => {
    const alarms = [alarm({ id: 'x', state: 'normal' })];
    const ordered = orderAlarms(alarms);
    expect(ordered).not.toBe(alarms);
  });
});

describe('alarm actions', () => {
  it('permits exactly one action for the two actionable states, none for the others', () => {
    expect(availableAlarmAction('active-unacknowledged')).toBe('acknowledge');
    expect(availableAlarmAction('cleared')).toBe('reset');
    expect(availableAlarmAction('active-acknowledged')).toBeNull();
    expect(availableAlarmAction('normal')).toBeNull();
  });

  it('maps every alarm state to its own catalogue key', () => {
    expect(alarmStateCatalogueKey('normal')).toBe('alarm.state.normal');
    expect(alarmStateCatalogueKey('active-unacknowledged')).toBe('alarm.state.activeUnacknowledged');
    expect(alarmStateCatalogueKey('active-acknowledged')).toBe('alarm.state.activeAcknowledged');
    expect(alarmStateCatalogueKey('cleared')).toBe('alarm.state.cleared');
  });
});

describe('alarm transition announcements', () => {
  it('announces nothing on the first observation or a non-change', () => {
    expect(alarmTransitionAnnouncement(undefined, 'normal')).toBeNull();
    expect(alarmTransitionAnnouncement('normal', 'normal')).toBeNull();
  });

  it('announces raised, acknowledged and cleared transitions', () => {
    expect(alarmTransitionAnnouncement('normal', 'active-unacknowledged')).toBe('raised');
    expect(alarmTransitionAnnouncement('active-unacknowledged', 'active-acknowledged')).toBe('acknowledged');
    expect(alarmTransitionAnnouncement('active-acknowledged', 'cleared')).toBe('cleared');
  });

  it('announces nothing for the reset-to-normal transition (silent, expected)', () => {
    expect(alarmTransitionAnnouncement('cleared', 'normal')).toBeNull();
  });
});

describe('trend history buffer', () => {
  const sample = (tick: number, value: number, setpoint: number | null = null): TrendSample => ({
    tick,
    value,
    setpoint,
  });

  it('appends and caps at maxSamples, dropping the oldest', () => {
    let history: readonly TrendSample[] = [];
    for (let tick = 0; tick < 5; tick += 1) {
      history = pushTrendSample(history, sample(tick, tick), 3);
    }
    expect(history.map((s) => s.tick)).toEqual([2, 3, 4]);
  });

  it('replaces rather than duplicates a sample for a repeated tick', () => {
    let history: readonly TrendSample[] = [];
    history = pushTrendSample(history, sample(0, 10), 5);
    history = pushTrendSample(history, sample(0, 20), 5);
    expect(history).toEqual([sample(0, 20)]);
  });

  it('returns an empty buffer for a non-positive cap', () => {
    expect(pushTrendSample([], sample(0, 1), 0)).toEqual([]);
  });
});

describe('trend domain', () => {
  it('defaults to the tag range when every sample sits inside it', () => {
    const history: TrendSample[] = [
      { tick: 0, value: 150, setpoint: 176 },
      { tick: 1, value: 178, setpoint: 176 },
    ];
    expect(trendDomain(history, 140, 220)).toEqual({ low: 140, high: 220 });
  });

  it('widens to fit an out-of-range sample', () => {
    const history: TrendSample[] = [{ tick: 0, value: 230, setpoint: null }];
    expect(trendDomain(history, 140, 220)).toEqual({ low: 140, high: 230 });
  });

  it('never collapses to a zero-height domain', () => {
    expect(trendDomain([], 100, 100)).toEqual({ low: 99, high: 101 });
  });
});

describe('trend geometry', () => {
  const viewport = { width: 100, height: 50, topPadding: 0, bottomPadding: 0 };

  it('maps the domain minimum to the bottom and maximum to the top', () => {
    const points = scaleTrendSeries([0, 10], viewport, 0, 10);
    expect(points[0]).toEqual({ x: 0, y: 50 });
    expect(points[1]).toEqual({ x: 100, y: 0 });
  });

  it('spaces points evenly along x and centres a single point', () => {
    const one = scaleTrendSeries([5], viewport, 0, 10);
    expect(one).toEqual([{ x: 0, y: 25 }]);

    const three = scaleTrendSeries([0, 0, 0], viewport, 0, 10);
    expect(three.map((p) => p.x)).toEqual([0, 50, 100]);
  });

  it('formats a points attribute to one decimal place, space-separated', () => {
    expect(pointsAttribute([{ x: 0, y: 50 }, { x: 100, y: 0 }])).toBe('0.0,50.0 100.0,0.0');
  });
});

describe('sanitizeDomId', () => {
  it('leaves an already-safe id untouched', () => {
    expect(sanitizeDomId('mill-1')).toBe('mill-1');
  });

  it('replaces anything not alphanumeric, underscore or hyphen', () => {
    expect(sanitizeDomId('mill 1:zone/2')).toBe('mill-1-zone-2');
  });
});
