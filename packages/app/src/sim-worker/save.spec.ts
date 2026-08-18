import { describe, expect, it } from 'vitest';

import { presetSettings } from './difficulty.js';
import { createSave, deserializeSave, loadWorld, rewindWorld, serializeSave } from './save.js';
import { SimWorld } from './world.js';

function playThrough(): { world: SimWorld; digestAtTick10: string } {
  const world = new SimWorld({ seed: 99, startInstantMs: 1_767_593_600_000, difficulty: presetSettings('easy') });
  world.applyCommand({ kind: 'setMode', machineId: 'mixer-1', mode: 'MANUAL' });
  world.applyCommand({ kind: 'setMode', machineId: 'mill-1', mode: 'MANUAL' });
  world.applyCommand({ kind: 'setMode', machineId: 'creamery-1', mode: 'MANUAL' });

  for (let i = 0; i < 10; i += 1) world.step();
  const digestAtTick10 = world.digest();

  // Advance one more tick before issuing further commands, so nothing else
  // is ever recorded *at* tick 10 — `rewindWorld(save, 10)` replays every
  // input recorded at or before tick 10, so a command recorded at tick 10
  // itself would land inside that rewound state too, and this test's
  // `digestAtTick10` was captured before any such command existed.
  world.step();

  // Exercise more of the bigger plant than just the mixer — a real oven, a
  // real supplier call for one of the new milled/churned/refined-ingredient
  // substances, and a mid-run difficulty change — so this save/rewind/load
  // round trip is genuinely a round trip through the larger plant, not just
  // the two machines the placeholder plant used to have.
  world.applyCommand({ kind: 'setMode', machineId: 'oven-deck-1', mode: 'AUTO' });
  world.applyCommand({ kind: 'setMode', machineId: 'refinery-1', mode: 'MANUAL' });
  world.applyCommand({ kind: 'callSupplier', substanceId: 'sucrose', massUg: '500000' });
  world.applyCommand({ kind: 'callSupplier', substanceId: 'wheat-grain', massUg: '2000000000' });
  world.applyCommand({ kind: 'callSupplier', substanceId: 'sugar-beet', massUg: '2000000000' });
  world.setDifficulty({ economyPressure: 0.9 });

  for (let i = 0; i < 15; i += 1) world.step();

  return { world, digestAtTick10 };
}

describe('save, load and rewind', () => {
  it('round-trips through JSON without losing anything a replay needs', () => {
    const { world } = playThrough();
    const save = createSave(world);
    const restored = deserializeSave(serializeSave(save));

    expect(restored.seed).toBe(save.seed);
    expect(restored.startInstantMs).toBe(save.startInstantMs);
    expect(restored.tick).toBe(save.tick);
    expect(restored.commands.length).toBe(save.commands.length);
    expect(restored.difficultyChanges.length).toBe(save.difficultyChanges.length);
  });

  it('loadWorld reproduces the exact live digest, byte for byte', () => {
    const { world } = playThrough();
    const save = createSave(world);

    const reloaded = loadWorld(deserializeSave(serializeSave(save)));

    expect(reloaded.tick).toBe(world.tick);
    expect(reloaded.digest()).toBe(world.digest());
    expect(reloaded.ledger.audit().ok).toBe(true);
  });

  it('rewindWorld reproduces the digest the live world actually had at that earlier tick', () => {
    const { world, digestAtTick10 } = playThrough();
    const save = createSave(world);

    const rewound = rewindWorld(save, 10);

    expect(rewound.tick).toBe(10);
    expect(rewound.digest()).toBe(digestAtTick10);
  });

  it('refuses to rewind past what the save actually recorded', () => {
    const { world } = playThrough();
    const save = createSave(world);
    expect(() => rewindWorld(save, save.tick + 1)).toThrow();
    expect(() => rewindWorld(save, -1)).toThrow();
  });

  it('rejects malformed save JSON instead of silently loading a broken world', () => {
    expect(() => deserializeSave('{}')).toThrow();
    expect(() => deserializeSave('not json')).toThrow();
    expect(() => deserializeSave(JSON.stringify({ seed: 1 }))).toThrow();
  });

  it('replays a refused command harmlessly: only accepted commands are journalled', () => {
    const world = new SimWorld({ seed: 5, startInstantMs: 1_767_593_600_000, difficulty: presetSettings('freePlay') });
    world.applyCommand({ kind: 'setMode', machineId: 'no-such-machine', mode: 'MANUAL' });
    world.applyCommand({ kind: 'setMode', machineId: 'mixer-1', mode: 'MANUAL' });
    for (let i = 0; i < 5; i += 1) world.step();

    const save = createSave(world);
    expect(save.commands.every((c) => c.payload.kind !== 'setMode' || (c.payload as { machineId: string }).machineId !== 'no-such-machine')).toBe(true);

    const reloaded = loadWorld(save);
    expect(reloaded.digest()).toBe(world.digest());
  });
});
