import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { seedWorld, WORLD_ACCOUNTS } from '../world/accounts.js';
import {
  ShiftOverlapError,
  StaffRoster,
  UnknownWorkerError,
  shiftHours,
  staffGlucoseEquivalentMass,
  staffRespiration,
  stockProvisions,
  wagesOwedMinorUnits,
  type ShiftDefinition,
  type Worker,
} from './staff.js';

const WORKER: Worker = {
  id: 'w1',
  name: 'Line worker one',
  skills: ['mixing', 'oven'],
  hourlyWageMinorUnits: 1_500n,
};

describe('staff: roster and shifts', () => {
  it('refuses to schedule a shift for an unknown worker', () => {
    const roster = new StaffRoster(60);
    const shift: ShiftDefinition = { workerId: 'ghost', startTick: 0, endTick: 60, restHoursRequired: 11 };
    expect(() => roster.scheduleShift(shift)).toThrow(UnknownWorkerError);
  });

  it('refuses an overlapping shift for the same worker', () => {
    const roster = new StaffRoster(60);
    roster.hire(WORKER);
    roster.scheduleShift({ workerId: 'w1', startTick: 0, endTick: 480, restHoursRequired: 11 });
    expect(() =>
      roster.scheduleShift({ workerId: 'w1', startTick: 240, endTick: 720, restHoursRequired: 11 }),
    ).toThrow(ShiftOverlapError);
  });

  it('is unavailable when not rostered, available on shift, and enforces rest afterward', () => {
    const roster = new StaffRoster(60); // 60 ticks per hour
    roster.hire(WORKER);
    roster.scheduleShift({ workerId: 'w1', startTick: 0, endTick: 480, restHoursRequired: 11 }); // 8h shift
    roster.scheduleShift({ workerId: 'w1', startTick: 480 + 11 * 60, endTick: 480 + 11 * 60 + 480, restHoursRequired: 11 });

    expect(roster.availability('w1', -1).available).toBe(false);
    expect(roster.availability('w1', -1).reason).toBe('not-rostered');

    expect(roster.availability('w1', 100).available).toBe(true);

    // Right after the first shift ends, the second shift has not started, so
    // this is correctly "not rostered" for this tick, not a rest violation.
    expect(roster.availability('w1', 481).available).toBe(false);

    // At the start of the second shift, the required 11h rest has elapsed
    // exactly, so the worker is available.
    const secondShiftStart = 480 + 11 * 60;
    expect(roster.availability('w1', secondShiftStart).available).toBe(true);
  });

  it('marks an unscheduled absence as a pure scheduling fact, never a medical one', () => {
    const roster = new StaffRoster(60);
    roster.hire(WORKER);
    roster.scheduleShift({ workerId: 'w1', startTick: 0, endTick: 480, restHoursRequired: 11 });
    roster.markAbsent('w1', 0);

    const check = roster.availability('w1', 100);
    expect(check.available).toBe(false);
    expect(check.reason).toBe('unscheduled-absence');
  });

  it('short-staffs a skill query when workers are unavailable, without halting anything itself', () => {
    const roster = new StaffRoster(60);
    const worker2: Worker = { ...WORKER, id: 'w2' };
    roster.hire(WORKER);
    roster.hire(worker2);
    roster.scheduleShift({ workerId: 'w1', startTick: 0, endTick: 480, restHoursRequired: 11 });
    roster.scheduleShift({ workerId: 'w2', startTick: 0, endTick: 480, restHoursRequired: 11 });
    roster.markAbsent('w2', 0);

    const available = roster.availableWithSkill(100, 'oven');
    expect(available.map((w) => w.id)).toEqual(['w1']);
  });
});

describe('staff: wages', () => {
  it('computes exact wages owed for a shift', () => {
    const shift: ShiftDefinition = { workerId: 'w1', startTick: 0, endTick: 480, restHoursRequired: 11 };
    expect(shiftHours(shift, 60)).toBe(8);
    expect(wagesOwedMinorUnits(WORKER, shift, 60)).toBe(12_000n); // 8h * 1500
  });
});

describe('staff: respiration', () => {
  it('respires more glucose-equivalent mass for more workers or more hours', () => {
    const base = staffGlucoseEquivalentMass(4, 8);
    expect(staffGlucoseEquivalentMass(8, 8)).toBeGreaterThan(base);
    expect(staffGlucoseEquivalentMass(4, 16)).toBeGreaterThan(base);
    expect(staffGlucoseEquivalentMass(0, 8)).toBe(0n);
    expect(staffGlucoseEquivalentMass(4, 0)).toBe(0n);
  });

  it('draws a real, balanced posting against the tracked atmosphere', () => {
    const ledger = new Ledger();
    seedWorld(ledger);
    ledger.openAccount({ id: 'staff.provisions', kind: 'stock', label: 'staff provisions' });
    ledger.openAccount({ id: 'staff.heat', kind: 'external', label: 'staff metabolic heat' });

    // 4 workers over an 8h shift respire a bit over 1.3 kg of glucose-
    // equivalent mass (see staffGlucoseEquivalentMass) -- stock generously
    // more than that so the respiration posting below has enough to draw on.
    stockProvisions(ledger, { account: 'staff.provisions', massUg: 5_000_000_000n });

    const atmosphereBefore = ledger.balance(WORLD_ACCOUNTS.atmosphere, 'el:O');
    const posting = staffRespiration({
      provisionsAccount: 'staff.provisions',
      heatAccount: 'staff.heat',
      workerCount: 4,
      hours: 8,
    });
    expect(posting).toBeDefined();
    ledger.post(posting!);

    const atmosphereAfter = ledger.balance(WORLD_ACCOUNTS.atmosphere, 'el:O');
    expect(atmosphereAfter).not.toBe(atmosphereBefore); // oxygen was actually drawn
    expect(ledger.audit().ok).toBe(true);
  });

  it('returns undefined rather than a no-op posting when there is nothing to respire', () => {
    expect(staffRespiration({ provisionsAccount: 'x', heatAccount: 'y', workerCount: 0, hours: 8 })).toBeUndefined();
  });
});
