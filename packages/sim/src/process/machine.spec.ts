import { describe, expect, it } from 'vitest';
import { createSeededRng } from './failure.js';
import { Machine, type MachineDefinition } from './machine.js';

function definition(overrides: Partial<MachineDefinition> = {}): MachineDefinition {
  return {
    type: 'test-oven',
    maintenanceIntervalHours: 100,
    tags: [
      { name: 'chamber-temp', unit: 'C', kind: 'measurement', min: 0, max: 300, initial: 20 },
      { name: 'temp-setpoint', unit: 'C', kind: 'setpoint', min: 0, max: 250, initial: 180 },
    ],
    components: [{ kind: 'bearing', label: 'door bearing', wearRatePerHour: 0.01, dutyExponent: 1 }],
    ...overrides,
  };
}

describe('Machine mode transitions', () => {
  it('starts OFF and can move to MANUAL', () => {
    const machine = new Machine('oven-1', 'Deck Oven 1', definition());
    machine.commission();
    const result = machine.requestMode('MANUAL');
    expect(result.ok).toBe(true);
    expect(machine.mode).toBe('MANUAL');
  });

  it('refuses AUTO -> SERVICE as an illegal transition', () => {
    const machine = new Machine('oven-1', 'Deck Oven 1', definition());
    machine.commission();
    machine.requestMode('MANUAL');
    machine.requestMode('AUTO');
    const result = machine.requestMode('SERVICE');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/cannot go from AUTO to SERVICE/);
    }
    // The refused command must not have changed the mode.
    expect(machine.mode).toBe('AUTO');
  });

  it('allows the legal chain OFF -> MANUAL -> AUTO -> MANUAL -> OFF', () => {
    const machine = new Machine('oven-1', 'Deck Oven 1', definition());
    machine.commission();
    for (const mode of ['MANUAL', 'AUTO', 'MANUAL', 'OFF'] as const) {
      const result = machine.requestMode(mode);
      expect(result.ok).toBe(true);
      expect(machine.mode).toBe(mode);
    }
  });

  it('refuses to run before commissioning, and accepts once commissioned', () => {
    const machine = new Machine('oven-1', 'Deck Oven 1', definition());
    const before = machine.requestMode('MANUAL');
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.reason).toMatch(/not been commissioned/);
    expect(machine.mode).toBe('OFF');

    machine.commission();
    const after = machine.requestMode('MANUAL');
    expect(after.ok).toBe(true);
    expect(machine.mode).toBe('MANUAL');
  });

  it('allows SERVICE from OFF without commissioning', () => {
    const machine = new Machine('oven-1', 'Deck Oven 1', definition());
    const result = machine.requestMode('SERVICE');
    expect(result.ok).toBe(true);
  });
});

describe('Machine tags', () => {
  it('is data-driven: two machines from the same definition behave identically', () => {
    const def = definition();
    const a = new Machine('a', 'A', def);
    const b = new Machine('b', 'B', def);
    expect(a.tagNames()).toEqual(b.tagNames());
    expect(a.getTag('temp-setpoint')).toBe(b.getTag('temp-setpoint'));
  });

  it('clamps a setpoint to its engineering range', () => {
    const machine = new Machine('oven-1', 'Deck Oven 1', definition());
    expect(machine.setTag('temp-setpoint', 999)).toBe(250);
    expect(machine.getTag('temp-setpoint')).toBe(250);
    expect(machine.setTag('temp-setpoint', -50)).toBe(0);
  });

  it('throws for an unknown tag', () => {
    const machine = new Machine('oven-1', 'Deck Oven 1', definition());
    expect(() => machine.getTag('nope')).toThrow();
  });
});

describe('Machine run hours, wear and maintenance', () => {
  it('only accrues run hours while running', () => {
    const machine = new Machine('oven-1', 'Deck Oven 1', definition());
    machine.commission();
    const rng = createSeededRng(1);
    machine.advance(5, 1, rng); // OFF: no effect
    expect(machine.runHours).toBe(0);

    machine.requestMode('MANUAL');
    machine.advance(5, 1, rng);
    expect(machine.runHours).toBe(5);
    expect(machine.maintenanceDueInHours).toBe(95);
  });

  it('reproducibly wears and fails a component from a fixed seed', () => {
    // A slow wear rate keeps the component "at risk" (wear 0.8..1.0, where the RNG
    // has a real chance of an early failure) for hundreds of hours, so this test
    // actually exercises the random branch rather than only the deterministic
    // wear-reaches-1.0 bound.
    const slowWear = definition({
      components: [{ kind: 'bearing', label: 'door bearing', wearRatePerHour: 0.001, dutyExponent: 1 }],
    });
    const runSchedule = (seed: number) => {
      const machine = new Machine('oven-1', 'Deck Oven 1', slowWear);
      machine.commission();
      machine.requestMode('MANUAL');
      const rng = createSeededRng(seed);
      const events: number[] = [];
      for (let hour = 0; hour < 2000; hour += 1) {
        const fired = machine.advance(1, 1, rng);
        if (fired.length > 0) events.push(machine.runHours);
      }
      return events;
    };

    const first = runSchedule(42);
    const second = runSchedule(42);
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
  });

  it('maintenance resets the counter and wear', () => {
    const machine = new Machine('oven-1', 'Deck Oven 1', definition());
    machine.commission();
    machine.requestMode('MANUAL');
    const rng = createSeededRng(7);
    machine.advance(100, 1, rng);
    expect(machine.maintenanceDue).toBe(true);
    machine.performMaintenance();
    expect(machine.maintenanceDueInHours).toBe(100);
    expect(machine.maintenanceDue).toBe(false);
    for (const component of machine.components) {
      expect(component.wear).toBe(0);
      expect(component.failed).toBe(false);
    }
  });
});
