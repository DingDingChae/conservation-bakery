import { describe, expect, it } from 'vitest';
import { Alarm, AlarmGroup, type AlarmDefinition } from './alarm.js';

function def(overrides: Partial<AlarmDefinition> = {}): AlarmDefinition {
  return { id: 'high-temp', label: 'High Temperature', priority: 1, latching: true, ...overrides };
}

describe('Alarm state machine (latching)', () => {
  it('walks the full chain: normal -> active-unacknowledged -> active-acknowledged -> cleared -> normal', () => {
    const alarm = new Alarm(def());
    expect(alarm.state).toBe('normal');

    alarm.evaluate(true, 1);
    expect(alarm.state).toBe('active-unacknowledged');
    expect(alarm.trippedAtTick).toBe(1);

    const ackResult = alarm.acknowledge();
    expect(ackResult.ok).toBe(true);
    expect(alarm.state).toBe('active-acknowledged');

    alarm.evaluate(false, 5); // condition returns to normal range
    expect(alarm.state).toBe('cleared');

    const resetResult = alarm.reset();
    expect(resetResult.ok).toBe(true);
    expect(alarm.state).toBe('normal');
    expect(alarm.trippedAtTick).toBeUndefined();
  });

  it('a latching alarm stays cleared until explicitly reset', () => {
    const alarm = new Alarm(def());
    alarm.evaluate(true, 1);
    alarm.acknowledge();
    alarm.evaluate(false, 2);
    expect(alarm.state).toBe('cleared');
    // Tripping the condition again while cleared does not skip the required reset.
    alarm.evaluate(true, 3);
    expect(alarm.state).toBe('cleared');
    const reset = alarm.reset();
    expect(reset.ok).toBe(true);
    expect(alarm.state).toBe('normal');
  });

  it('remains active-unacknowledged if the condition clears before acknowledgement', () => {
    const alarm = new Alarm(def());
    alarm.evaluate(true, 1);
    alarm.evaluate(false, 2); // condition gone, but nobody has acknowledged yet
    expect(alarm.state).toBe('active-unacknowledged');
    alarm.acknowledge();
    // Latching, and condition already gone: acknowledging goes straight to cleared.
    expect(alarm.state).toBe('cleared');
  });

  it('refuses acknowledge when not active-unacknowledged', () => {
    const alarm = new Alarm(def());
    const result = alarm.acknowledge();
    expect(result.ok).toBe(false);
  });

  it('refuses reset when not cleared', () => {
    const alarm = new Alarm(def());
    const result = alarm.reset();
    expect(result.ok).toBe(false);
  });
});

describe('Alarm state machine (non-latching)', () => {
  it('returns to normal on its own once acknowledged and the condition has gone', () => {
    const alarm = new Alarm(def({ latching: false }));
    alarm.evaluate(true, 1);
    alarm.acknowledge();
    expect(alarm.state).toBe('active-acknowledged');
    alarm.evaluate(false, 2);
    expect(alarm.state).toBe('normal');
  });
});

describe('Alarm priority', () => {
  it('carries the priority from its definition', () => {
    const alarm = new Alarm(def({ priority: 3 }));
    expect(alarm.priority).toBe(3);
  });
});

describe('AlarmGroup first-out', () => {
  it('flags only the first alarm to trip within a burst', () => {
    const b = new Alarm(def({ id: 'b', latching: true }));
    const a = new Alarm(def({ id: 'a', latching: true }));
    const group = new AlarmGroup([a, b]);

    group.evaluate(new Map([['b', true]]), 10);
    expect(group.firstOutId).toBe('b');
    expect(b.isFirstOut).toBe(true);
    expect(a.isFirstOut).toBe(false);

    group.evaluate(new Map([['b', true], ['a', true]]), 11);
    expect(group.firstOutId).toBe('b'); // a tripped later, is not first-out
    expect(a.isFirstOut).toBe(false);
    expect(b.isFirstOut).toBe(true);
  });

  it('clears the first-out record once every alarm in the group is back to normal', () => {
    const a = new Alarm(def({ id: 'a', latching: false }));
    const b = new Alarm(def({ id: 'b', latching: false }));
    const group = new AlarmGroup([a, b]);

    group.evaluate(new Map([['a', true]]), 1);
    expect(group.firstOutId).toBe('a');

    group.evaluate(new Map([['a', true]]), 2); // acknowledge below, then clear
    a.acknowledge();
    group.evaluate(new Map([['a', false]]), 3);
    expect(a.state).toBe('normal');
    expect(group.firstOutId).toBeUndefined();

    // A fresh burst can now designate a new first-out alarm.
    group.evaluate(new Map([['b', true]]), 4);
    expect(group.firstOutId).toBe('b');
  });
});
