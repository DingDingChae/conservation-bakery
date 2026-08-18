import { describe, expect, it } from 'vitest';

import { toExact } from '../shared/ipc.js';
import { presetSettings } from './difficulty.js';
import { PLANT_CASH, PLANT_CASH_COMMODITY, PLANT_RECEIVING, SimWorld } from './world.js';

function freshWorld(preset: 'freePlay' | 'easy' | 'realistic' | 'punishing' = 'freePlay'): SimWorld {
  return new SimWorld({ seed: 20260817, startInstantMs: 1_767_593_600_000, difficulty: presetSettings(preset) });
}

describe('SimWorld', () => {
  it('boots with every machine commissioned and off, and a closed ledger', () => {
    const world = freshWorld();
    const snapshot = world.snapshot();

    expect(snapshot.tick).toBe(0);
    expect(snapshot.speed).toBe(1);
    expect(snapshot.balanceOk).toBe(true);
    expect(snapshot.machines.map((m) => m.id).sort()).toEqual([
      'cooler-1',
      'creamery-1',
      'mill-1',
      'mixer-1',
      'oven-convection-1',
      'oven-deck-1',
      'oven-tunnel-1',
      'qa-lab-1',
      'refinery-1',
      'sales-office-1',
      'wrapper-1',
    ]);
    for (const machine of snapshot.machines) {
      expect(machine.commissioned).toBe(true);
      expect(machine.mode).toBe('OFF');
      expect(machine.running).toBe(false);
    }
    for (const row of snapshot.balance) {
      expect(row.residual).toBe('0');
    }
  });

  it('accepts every legal speed and refuses an illegal one', () => {
    const world = freshWorld();
    for (const speed of [0, 1, 5, 60] as const) {
      expect(world.applyCommand({ kind: 'setSpeed', speed })).toEqual({ accepted: true });
      expect(world.snapshot().speed).toBe(speed);
    }
    // A payload straight off a wire that has not been type-checked can still
    // carry an illegal value — the worker must refuse it, not misbehave.
    const illegal = world.applyCommand({ kind: 'setSpeed', speed: 7 as never });
    expect(illegal.accepted).toBe(false);
    expect(illegal.reason).toBeTruthy();
  });

  it('refuses every machine command against an unknown machine, with a real reason', () => {
    const world = freshWorld();
    const commands = [
      { kind: 'setMode', machineId: 'no-such-machine', mode: 'MANUAL' },
      { kind: 'setSetpoint', machineId: 'no-such-machine', tagId: 'x', value: 1 },
      { kind: 'acknowledgeAlarm', machineId: 'no-such-machine', alarmId: 'x' },
      { kind: 'resetAlarm', machineId: 'no-such-machine', alarmId: 'x' },
    ] as const;
    for (const command of commands) {
      const result = world.applyCommand(command);
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('no-such-machine');
    }
  });

  it('drives a real machine through setMode and setSetpoint, refusing an illegal transition', () => {
    const world = freshWorld();
    expect(world.applyCommand({ kind: 'setMode', machineId: 'oven-deck-1', mode: 'MANUAL' })).toEqual({ accepted: true });
    expect(world.snapshot().machines.find((m) => m.id === 'oven-deck-1')?.running).toBe(true);

    // AUTO cannot jump straight to SERVICE (see process/machine.ts).
    const auto = world.applyCommand({ kind: 'setMode', machineId: 'oven-deck-1', mode: 'AUTO' });
    expect(auto.accepted).toBe(true);
    const illegalService = world.applyCommand({ kind: 'setMode', machineId: 'oven-deck-1', mode: 'SERVICE' });
    expect(illegalService.accepted).toBe(false);

    const setpoint = world.applyCommand({
      kind: 'setSetpoint',
      machineId: 'oven-deck-1',
      tagId: 'bake-temp-setpoint-c',
      value: 210,
    });
    expect(setpoint.accepted).toBe(true);
    const tag = world.snapshot().machines.find((m) => m.id === 'oven-deck-1')?.tags.find((t) => t.id === 'bake-temp-setpoint-c');
    expect(tag?.value).toBe(210);

    const badTag = world.applyCommand({
      kind: 'setSetpoint',
      machineId: 'oven-deck-1',
      tagId: 'bake-temp-c', // a measurement, not a setpoint
      value: 1,
    });
    expect(badTag.accepted).toBe(false);
  });

  it('runs the background scenario and both machines every tick without ever unbalancing the ledger', () => {
    const world = freshWorld();
    world.applyCommand({ kind: 'setMode', machineId: 'mixer-1', mode: 'MANUAL' });
    world.applyCommand({ kind: 'setMode', machineId: 'oven-deck-1', mode: 'AUTO' });

    for (let i = 0; i < 30; i += 1) world.step();

    const snapshot = world.snapshot();
    expect(snapshot.tick).toBe(30);
    expect(snapshot.balanceOk).toBe(true);
    for (const row of snapshot.balance) expect(row.residual).toBe('0');
  });

  it('call-a-supplier moves real, costed material through the ledger after a real lead time', () => {
    const world = freshWorld('freePlay'); // assistance 1 — permitted.
    const before = world.ledger.balance(PLANT_CASH, PLANT_CASH_COMMODITY);

    const result = world.applyCommand({
      kind: 'callSupplier',
      substanceId: 'wheat-flour-white',
      massUg: toExact(1_000_000_000n), // 1 kilogram
    });
    expect(result).toEqual({ accepted: true });

    // Charged immediately...
    const afterCharge = world.ledger.balance(PLANT_CASH, PLANT_CASH_COMMODITY);
    expect(afterCharge).toBeLessThan(before);
    // ...but not delivered yet: a real lead time, not a spawn.
    expect(world.ledger.balance(PLANT_RECEIVING, 'el:C')).toBe(0n);

    for (let i = 0; i < 2_000 && world.ledger.balance(PLANT_RECEIVING, 'el:C') === 0n; i += 1) world.step();

    expect(world.ledger.balance(PLANT_RECEIVING, 'el:C')).toBeGreaterThan(0n);
    expect(world.ledger.audit().ok).toBe(true);
  });

  it('refuses call-a-supplier for an unknown substance, and for a mass the plant cannot afford', () => {
    const world = freshWorld('freePlay');
    const unknown = world.applyCommand({ kind: 'callSupplier', substanceId: 'unobtainium', massUg: toExact(1n) });
    expect(unknown.accepted).toBe(false);

    const tooMuch = world.applyCommand({
      kind: 'callSupplier',
      substanceId: 'wheat-flour-white',
      massUg: toExact(1_000_000_000_000_000n), // 1,000 tonnes — far past any preset's starting cash
    });
    expect(tooMuch.accepted).toBe(false);
    expect(tooMuch.reason).toContain('insufficient funds');
  });

  it('refuses call-a-supplier under Realistic and Punishing, where assistance is too low', () => {
    for (const preset of ['realistic', 'punishing'] as const) {
      const world = freshWorld(preset);
      const result = world.applyCommand({ kind: 'callSupplier', substanceId: 'wheat-flour-white', massUg: toExact(1_000n) });
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('difficulty');
    }
  });

  it('throws a real "unknown lot" error for a lot id that was never created', () => {
    const world = freshWorld();
    expect(() => world.provenance('lot:does-not-exist:0')).toThrow();
  });

  it('produces the identical digest after the same number of ticks regardless of how often a snapshot was published in between', () => {
    const build = (): SimWorld => new SimWorld({ seed: 42, startInstantMs: 1_767_593_600_000, difficulty: presetSettings('freePlay') });

    const worldA = build();
    const worldB = build();
    const TICKS = 25;

    for (let i = 0; i < TICKS; i += 1) {
      if (i === 3) {
        worldA.applyCommand({ kind: 'setMode', machineId: 'mixer-1', mode: 'MANUAL' });
        worldB.applyCommand({ kind: 'setMode', machineId: 'mixer-1', mode: 'MANUAL' });
      }
      worldA.step();
      worldA.digest(); // "published" every tick
    }
    for (let i = 0; i < TICKS; i += 1) {
      if (i === 3) worldB.applyCommand({ kind: 'setMode', machineId: 'oven-deck-1', mode: 'MANUAL' }); // never mind — this world only publishes at the end
      worldB.step();
    }
    // worldB's mid-run command above was deliberately different (oven vs
    // mixer) to prove digest *does* pick up a real state difference; now
    // rebuild worldB identically to worldA and confirm the throttle itself
    // — publishing never vs. every tick — makes no difference.
    const worldC = build();
    for (let i = 0; i < TICKS; i += 1) {
      if (i === 3) worldC.applyCommand({ kind: 'setMode', machineId: 'mixer-1', mode: 'MANUAL' });
      worldC.step();
    }

    expect(worldC.digest()).toBe(worldA.digest());
    expect(worldB.digest()).not.toBe(worldA.digest());
  });

  it('runs a real Victoria sponge batch end to end — grain and milk to a shipped, paid-for cake — with the ledger closing every tick along the way', () => {
    const world = freshWorld('freePlay'); // assistance 1 — call-a-supplier permitted.

    const equipmentIds = [
      'mill-1',
      'creamery-1',
      'refinery-1',
      'mixer-1',
      'oven-deck-1',
      'oven-convection-1',
      'oven-tunnel-1',
      'cooler-1',
      'wrapper-1',
      'qa-lab-1',
    ] as const;
    for (const machineId of equipmentIds) {
      // OFF -> AUTO is not a legal transition (see `process/machine.ts`'s
      // `LEGAL_TRANSITIONS`) — every machine passes through MANUAL first,
      // exactly like a real operator bringing a line up.
      expect(world.applyCommand({ kind: 'setMode', machineId, mode: 'MANUAL' })).toEqual({ accepted: true });
    }

    // Real raw ingredients for a real recipe (see `plant.ts`'s
    // `VICTORIA_SPONGE_FORMULATION`), each a real, costed, lead-timed
    // delivery — nothing here spawns a gram.
    const kg = 1_000_000_000n;
    const deliveries: readonly (readonly [string, bigint])[] = [
      ['wheat-grain', 50n * kg],
      ['cow-milk-whole', 60n * kg],
      ['sugar-beet', 60n * kg],
      ['hen-egg-whole', 2n * kg],
      ['sodium-bicarbonate', 1n * kg],
      ['cream-of-tartar', 1n * kg],
      ['sodium-chloride', 1n * kg],
      ['polypropylene-film', 1n * kg],
    ];
    for (const [substanceId, massUg] of deliveries) {
      expect(world.applyCommand({ kind: 'callSupplier', substanceId, massUg: toExact(massUg) })).toEqual({ accepted: true });
    }

    const cashAfterOrdering = world.ledger.balance(PLANT_CASH, PLANT_CASH_COMMODITY);

    // `step()` itself throws if the ledger's books ever stop closing (see
    // `SimWorld.step`'s own doc comment) — every one of these ticks is
    // already a real per-tick conservation assertion, not merely the final
    // one checked below.
    let shipped = false;
    for (let i = 0; i < 20_000 && !shipped; i += 1) {
      world.step();
      shipped = world.ledger.balance(PLANT_CASH, PLANT_CASH_COMMODITY) > cashAfterOrdering;
    }

    expect(shipped).toBe(true); // real revenue moved into the plant's own cash account.
    expect(world.ledger.audit().ok).toBe(true);

    const snapshot = world.snapshot();
    expect(snapshot.balanceOk).toBe(true);
    for (const row of snapshot.balance) expect(row.residual).toBe('0');

    const office = snapshot.machines.find((m) => m.id === 'sales-office-1');
    expect(office?.tags.find((t) => t.id === 'shipments-count')?.value).toBeGreaterThan(0);
  });
});
