/**
 * Small `WorldSnapshot`/`MachineSnapshot` builders shared by this module's tests, named
 * for the real `sim-worker/machines.ts` vocabulary (`mix-speed-rpm`, `batch-mass-kg`,
 * `bake-temp-c`, `bake-temp-setpoint-c`) so `params.spec.ts` and `engine.spec.ts` are
 * both exercising the shape the real wired plant actually produces today, plus a couple
 * of synthetic roles (`conveyor`, `wrapper`) that `roles.ts`'s own doc comment explains
 * are not wired into the interactive world yet.
 */

import type { AlarmSnapshot, AlarmState, MachineSnapshot, TagSnapshot, WorldSnapshot } from '../../../shared/ipc.js';

export function tag(overrides: Partial<TagSnapshot> & Pick<TagSnapshot, 'id'>): TagSnapshot {
  return {
    label: overrides.id,
    unit: '',
    value: 0,
    setpoint: null,
    rangeLow: 0,
    rangeHigh: 100,
    ...overrides,
  };
}

export function alarm(overrides: Partial<AlarmSnapshot> & Pick<AlarmSnapshot, 'id'>): AlarmSnapshot {
  return {
    label: overrides.id,
    state: 'normal' as AlarmState,
    priority: 3,
    firstOut: false,
    raisedAtTick: 0,
    ...overrides,
  };
}

export function machine(overrides: Partial<MachineSnapshot> & Pick<MachineSnapshot, 'id'>): MachineSnapshot {
  return {
    label: overrides.id,
    mode: 'AUTO',
    commissioned: true,
    running: true,
    runHours: 0,
    serviceDueInHours: 999,
    tags: [],
    alarms: [],
    ...overrides,
  };
}

export function mixerMachine(overrides: Partial<MachineSnapshot> = {}): MachineSnapshot {
  return machine({
    id: 'mixer-1',
    label: 'Mixing bowl',
    tags: [
      tag({ id: 'mix-speed-rpm', unit: 'rpm', setpoint: 60, value: 60, rangeLow: 0, rangeHigh: 200 }),
      tag({ id: 'batch-mass-kg', unit: 'kg', value: 0, rangeLow: 0, rangeHigh: 2_000 }),
    ],
    ...overrides,
  });
}

export function ovenMachine(overrides: Partial<MachineSnapshot> = {}): MachineSnapshot {
  return machine({
    id: 'oven-1',
    label: 'Deck oven',
    tags: [
      tag({ id: 'bake-temp-setpoint-c', unit: 'C', setpoint: 180, value: 180, rangeLow: 20, rangeHigh: 260 }),
      tag({ id: 'bake-temp-c', unit: 'C', value: 20, rangeLow: 0, rangeHigh: 300 }),
    ],
    ...overrides,
  });
}

export function conveyorMachine(overrides: Partial<MachineSnapshot> = {}): MachineSnapshot {
  return machine({
    id: 'conveyor-1',
    label: 'Spiral conveyor',
    tags: [tag({ id: 'line-speed-m-min', unit: 'm/min', value: 6, rangeLow: 0, rangeHigh: 12 })],
    ...overrides,
  });
}

export function wrapperMachine(overrides: Partial<MachineSnapshot> = {}): MachineSnapshot {
  return machine({ id: 'wrapper-1', label: 'Flow wrapper', tags: [], ...overrides });
}

export function worldSnapshot(machines: readonly MachineSnapshot[], overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    tick: 0,
    simulatedTime: '1970-01-01T00:00:00.000Z',
    speed: 1,
    machines,
    balance: [],
    balanceOk: true,
    digest: 'fixture',
    ...overrides,
  };
}
