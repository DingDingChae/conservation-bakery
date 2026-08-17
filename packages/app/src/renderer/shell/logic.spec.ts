import { describe, expect, it } from 'vitest';

import type { AlarmSnapshot, MachineSnapshot } from '../../shared/ipc.js';
import {
  aggregateAlarms,
  formatSimulatedClock,
  isInfrastructureFailureMessage,
  parseWholeGramsToMicrograms,
  screenEquals,
  screenForRevealTarget,
  screenNavId,
  speedCatalogueKey,
  SPEED_OPTIONS,
} from './logic.js';

function alarm(partial: Partial<AlarmSnapshot>): AlarmSnapshot {
  return {
    id: 'a',
    label: 'Alarm',
    state: 'normal',
    priority: 5,
    firstOut: false,
    raisedAtTick: 0,
    ...partial,
  };
}

function machine(id: string, alarms: readonly AlarmSnapshot[]): MachineSnapshot {
  return {
    id,
    label: id,
    mode: 'AUTO',
    commissioned: true,
    running: true,
    runHours: 0,
    serviceDueInHours: 100,
    tags: [],
    alarms,
  };
}

describe('screenForRevealTarget', () => {
  it('routes a machine, tag or alarm target to that machine screen', () => {
    expect(screenForRevealTarget({ kind: 'machine', machineId: 'mixer' })).toEqual({
      kind: 'machine',
      machineId: 'mixer',
    });
    expect(screenForRevealTarget({ kind: 'tag', machineId: 'mixer', tagId: 'mix-speed-rpm' })).toEqual({
      kind: 'machine',
      machineId: 'mixer',
    });
    expect(screenForRevealTarget({ kind: 'alarm', machineId: 'oven', alarmId: 'over-temp' })).toEqual({
      kind: 'machine',
      machineId: 'oven',
    });
  });

  it('routes a lot target to the ancestry screen', () => {
    expect(screenForRevealTarget({ kind: 'lot', lotId: 'lot-1' })).toEqual({ kind: 'provenance-tree' });
  });

  it('routes a panel target by its known panel id', () => {
    expect(screenForRevealTarget({ kind: 'panel', panelId: 'settings' })).toEqual({ kind: 'settings' });
    expect(screenForRevealTarget({ kind: 'panel', panelId: 'provenance-tree' })).toEqual({ kind: 'provenance-tree' });
    expect(screenForRevealTarget({ kind: 'panel', panelId: 'machine:oven' })).toEqual({
      kind: 'machine',
      machineId: 'oven',
    });
  });

  it('returns null for a panel target this shell does not route (e.g. the always-visible balance panel)', () => {
    expect(screenForRevealTarget({ kind: 'panel', panelId: 'balance' })).toBeNull();
  });
});

describe('screenEquals / screenNavId', () => {
  it('treats two machine screens for the same id as equal, and different ids as not', () => {
    expect(screenEquals({ kind: 'machine', machineId: 'oven' }, { kind: 'machine', machineId: 'oven' })).toBe(true);
    expect(screenEquals({ kind: 'machine', machineId: 'oven' }, { kind: 'machine', machineId: 'mixer' })).toBe(false);
    expect(screenEquals({ kind: 'settings' }, { kind: 'provenance-tree' })).toBe(false);
    expect(screenEquals({ kind: 'settings' }, { kind: 'settings' })).toBe(true);
  });

  it('builds a stable, distinct id per screen', () => {
    expect(screenNavId({ kind: 'machine', machineId: 'oven' })).toBe('machine:oven');
    expect(screenNavId({ kind: 'settings' })).toBe('settings');
    expect(screenNavId({ kind: 'provenance-tree' })).toBe('provenance-tree');
  });
});

describe('aggregateAlarms', () => {
  it('reports no worst alarm when every machine is all-normal', () => {
    const result = aggregateAlarms([machine('mixer', [alarm({ state: 'normal' })])]);
    expect(result.worst).toBeNull();
    expect(result.activeUnacknowledgedCount).toBe(0);
  });

  it('picks the first-out alarm over a higher-urgency non-first-out one', () => {
    const result = aggregateAlarms([
      machine('mixer', [
        alarm({ id: 'm1', state: 'active-unacknowledged', firstOut: false, priority: 1 }),
        alarm({ id: 'm2', state: 'active-acknowledged', firstOut: true, priority: 9 }),
      ]),
    ]);
    expect(result.worst?.id).toBe('m2');
  });

  it('counts active-unacknowledged, active-acknowledged and cleared across every machine', () => {
    const result = aggregateAlarms([
      machine('mixer', [alarm({ id: 'a', state: 'active-unacknowledged' }), alarm({ id: 'b', state: 'cleared' })]),
      machine('oven', [alarm({ id: 'c', state: 'active-acknowledged' }), alarm({ id: 'd', state: 'normal' })]),
    ]);
    expect(result.activeUnacknowledgedCount).toBe(1);
    expect(result.activeAcknowledgedCount).toBe(1);
    expect(result.clearedCount).toBe(1);
    expect(result.worst?.machineId).toBe('mixer');
    expect(result.worst?.id).toBe('a');
  });

  it('breaks a full tie by machine id then alarm id, for a stable order', () => {
    const result = aggregateAlarms([
      machine('oven', [alarm({ id: 'z', state: 'active-unacknowledged', priority: 1 })]),
      machine('mixer', [alarm({ id: 'a', state: 'active-unacknowledged', priority: 1 })]),
    ]);
    expect(result.worst?.machineId).toBe('mixer');
  });
});

describe('formatSimulatedClock', () => {
  it('renders HH:MM:SS in UTC from the snapshot ISO string', () => {
    expect(formatSimulatedClock('2026-01-05T06:00:12.000Z')).toBe('06:00:12');
    expect(formatSimulatedClock('2026-01-05T00:00:00.000Z')).toBe('00:00:00');
  });

  it('never throws on an unparsable string, and renders a visible placeholder instead', () => {
    expect(formatSimulatedClock('not-a-date')).toBe('--:--:--');
  });
});

describe('speedCatalogueKey / SPEED_OPTIONS', () => {
  it('covers every legal speed with its own key', () => {
    for (const speed of SPEED_OPTIONS) {
      expect(speedCatalogueKey(speed)).toMatch(/^speed\./);
    }
  });
});

describe('parseWholeGramsToMicrograms', () => {
  it('converts a whole-gram decimal string to exact micrograms', () => {
    expect(parseWholeGramsToMicrograms('1')).toBe(1_000_000n);
    expect(parseWholeGramsToMicrograms('0')).toBe(0n);
    expect(parseWholeGramsToMicrograms('2500')).toBe(2_500_000_000n);
  });

  it('rejects anything that is not a plain non-negative integer', () => {
    for (const bad of ['', '-1', '1.5', '1e3', 'abc', ' 1', '1 ', '+1']) {
      expect(parseWholeGramsToMicrograms(bad)).toBeNull();
    }
  });

  it('never rounds a large gram quantity through a float', () => {
    // Far past Number.MAX_SAFE_INTEGER once scaled to micrograms — a float path would
    // silently lose precision here.
    expect(parseWholeGramsToMicrograms('9007199254740993')).toBe(9_007_199_254_740_993_000_000n);
  });
});

describe('isInfrastructureFailureMessage', () => {
  it('matches the two literal phrases simulationHost.ts rejects with once the worker is gone', () => {
    expect(isInfrastructureFailureMessage('the simulation worker is not running')).toBe(true);
    expect(isInfrastructureFailureMessage('the simulation worker exited with code 1')).toBe(true);
    expect(isInfrastructureFailureMessage('the simulation worker exited with code null')).toBe(true);
  });

  it('does not match an ordinary business-level rejection from a live worker', () => {
    expect(isInfrastructureFailureMessage('unknown lot "not-a-real-lot"')).toBe(false);
    expect(isInfrastructureFailureMessage('unknown request kind "bogus"')).toBe(false);
    expect(isInfrastructureFailureMessage('')).toBe(false);
  });
});
