import { describe, expect, it } from 'vitest';

import type { AlarmSnapshot } from '../../shared/ipc.js';
import type { Translate } from '../context.js';
import {
  alarmStateCatalogueKey,
  alarmTransitionAnnouncement,
  availableAlarmAction,
  barMarkerPercent,
  classifyRefusal,
  describeRefusal,
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
  unitCatalogueKey,
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

describe('unitCatalogueKey', () => {
  it('maps every raw unit symbol the simulation actually emits to a real catalogue key', () => {
    expect(unitCatalogueKey('C')).toBe('unit.celsius');
    expect(unitCatalogueKey('°C')).toBe('unit.celsius');
    expect(unitCatalogueKey('kg')).toBe('unit.kilogram');
    expect(unitCatalogueKey('g')).toBe('unit.gram');
    expect(unitCatalogueKey('h')).toBe('unit.hour');
    expect(unitCatalogueKey('min')).toBe('unit.minute');
    expect(unitCatalogueKey('s')).toBe('unit.second');
    expect(unitCatalogueKey('%')).toBe('unit.percent');
    expect(unitCatalogueKey('/h')).toBe('unit.perHour');
    expect(unitCatalogueKey('tick')).toBe('unit.tick');
  });

  it('returns null for a symbol the catalogue has no entry for, so the caller falls back to the raw text', () => {
    expect(unitCatalogueKey('rpm')).toBeNull();
    expect(unitCatalogueKey('fraction')).toBeNull();
    expect(unitCatalogueKey('')).toBeNull();
  });
});

describe('classifyRefusal', () => {
  it('recognises the exact "simulation is not running" sentence main.ts composes', () => {
    expect(classifyRefusal('The simulation is not running.')).toEqual({
      key: 'refusal.simulationNotRunning',
      values: {},
    });
  });

  it('recognises the alarm.ts acknowledge refusal, carrying the alarm id and its real state', () => {
    expect(classifyRefusal('alarm "door-interlock" is active-acknowledged, not active-unacknowledged')).toEqual({
      key: 'refusal.alarmNotUnacknowledged',
      values: { alarm: 'door-interlock', state: 'active-acknowledged' },
    });
  });

  it('recognises the alarm.ts reset refusal', () => {
    expect(classifyRefusal('alarm "door-interlock" is normal, not cleared')).toEqual({
      key: 'refusal.alarmNotCleared',
      values: { alarm: 'door-interlock', state: 'normal' },
    });
  });

  it('recognises the interlock.ts refusal shape', () => {
    expect(classifyRefusal('Door interlock refused: door is open (protects oven-1)')).toEqual({
      key: 'refusal.interlock',
      values: { machine: 'Door interlock', condition: 'door is open' },
    });
  });

  it('recognises the machine.ts illegal-transition refusal', () => {
    expect(classifyRefusal('"oven-1" cannot go from OFF to AUTO')).toEqual({
      key: 'refusal.modeTransition',
      values: { machine: 'oven-1', from: 'OFF', to: 'AUTO' },
    });
  });

  it('recognises the machine.ts not-commissioned refusal', () => {
    expect(classifyRefusal('"oven-1" has not been commissioned and cannot run')).toEqual({
      key: 'refusal.notCommissioned',
      values: { machine: 'oven-1' },
    });
  });

  it('falls back to refusal.generic, carrying the real text, for anything unrecognised', () => {
    expect(classifyRefusal('unknown machine "no-such-machine"')).toEqual({
      key: 'refusal.generic',
      values: { reason: 'unknown machine "no-such-machine"' },
    });
  });

  it('falls back to refusal.generic when a shape almost matches but the state/mode token is not real', () => {
    expect(classifyRefusal('alarm "x" is not-a-real-state, not active-unacknowledged')).toEqual({
      key: 'refusal.generic',
      values: { reason: 'alarm "x" is not-a-real-state, not active-unacknowledged' },
    });
    expect(classifyRefusal('"oven-1" cannot go from OFF to NOWHERE')).toEqual({
      key: 'refusal.generic',
      values: { reason: '"oven-1" cannot go from OFF to NOWHERE' },
    });
  });
});

describe('describeRefusal', () => {
  // A small stand-in catalogue, close enough to the real one (interpolation and all)
  // to prove `describeRefusal` composes real, translated copy — not the worker's raw
  // English — without pulling in the whole four-catalogue i18n module for a unit test.
  const fakeCatalogue: Readonly<Record<string, string>> = {
    'refusal.generic': 'Refused — {reason}',
    'refusal.simulationNotRunning': 'The simulation is not running',
    'refusal.alarmNotUnacknowledged': 'Alarm {alarm} is {state}, not ready to acknowledge',
    'refusal.alarmNotCleared': 'Alarm {alarm} is {state}, not ready to reset',
    'refusal.interlock': '{machine}: an interlock refused the command — {condition}',
    'refusal.modeTransition': '{machine} cannot switch from {from} to {to}',
    'refusal.notCommissioned': '{machine} has not been commissioned and cannot run',
    'alarm.state.activeAcknowledged': 'Active — acknowledged',
    'mode.off': 'OFF',
    'mode.auto': 'AUTO',
  };
  const fakeTranslate: Translate = (key, values) => {
    const template = fakeCatalogue[key] ?? key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = values[name];
      return value === undefined ? whole : String(value);
    });
  };

  it('shows refusal.generic with the real reason text for an undefined reason', () => {
    expect(describeRefusal(fakeTranslate, undefined)).toBe('Refused — ');
  });

  it('translates the alarm state, not the raw AlarmState token, into the sentence', () => {
    expect(describeRefusal(fakeTranslate, 'alarm "door-interlock" is active-acknowledged, not active-unacknowledged')).toBe(
      'Alarm door-interlock is Active — acknowledged, not ready to acknowledge',
    );
  });

  it('translates both mode names, not the raw MachineMode tokens, into the sentence', () => {
    expect(describeRefusal(fakeTranslate, '"oven-1" cannot go from OFF to AUTO')).toBe(
      'oven-1 cannot switch from OFF to AUTO',
    );
  });

  it('falls back to refusal.generic verbatim for an unrecognised reason', () => {
    expect(describeRefusal(fakeTranslate, 'unknown machine "no-such-machine"')).toBe(
      'Refused — unknown machine "no-such-machine"',
    );
  });
});
