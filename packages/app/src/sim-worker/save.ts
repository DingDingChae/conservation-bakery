/**
 * Save, load and rewind.
 *
 * A run is fully determined by exactly four things: the seed, the start
 * instant, the difficulty history, and the command journal — see
 * `packages/sim/src/clock/journal.ts`'s own doc comment, which this module
 * extends by one field (`difficultyChanges`) because difficulty can change
 * mid-run (see `difficulty.ts`) and the shared `Command` journal alone does
 * not carry that.
 *
 * `loadWorld` and `rewindWorld` never mutate a running `SimWorld` in place —
 * both always rebuild a fresh one from `(seed, startInstantMs, difficulty)`
 * and replay every recorded command up to the target tick. That is what
 * makes the round trip exact: a rebuilt world sees the identical sequence of
 * inputs a live one did, tick for tick, and — being fully deterministic (no
 * `Math.random`, no wall-clock read that affects state) — reaches the exact
 * same digest.
 */

import type { Command as IpcCommand } from '../shared/ipc.js';
import type { DifficultyChangeRecord, DifficultyKnobs, DifficultySettings } from './difficulty.js';
import { SimWorld } from './world.js';

export interface SaveFile {
  readonly seed: number;
  readonly startInstantMs: number;
  readonly initialDifficulty: DifficultySettings;
  readonly difficultyChanges: readonly DifficultyChangeRecord[];
  /** Every accepted command, stamped with the tick it was applied on — a
   * refused command never changes state, so it is not recorded (replaying
   * only accepted commands reproduces the exact same state either way). */
  readonly commands: readonly { readonly type: string; readonly tick: number; readonly payload: IpcCommand }[];
  /** The tick this save was taken at. `loadWorld` replays to exactly this
   * tick; `rewindWorld` may target any earlier one. */
  readonly tick: number;
}

export function createSave(world: SimWorld): SaveFile {
  return {
    seed: world.seed,
    startInstantMs: world.startInstantMs,
    initialDifficulty: world.initialDifficulty,
    difficultyChanges: world.difficultyChanges,
    commands: world.journalRecord().commands.map((command) => ({
      type: command.type,
      tick: command.tick,
      payload: command.payload as IpcCommand,
    })),
    tick: world.tick,
  };
}

export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save);
}

function isDifficultyKnobs(value: unknown): value is DifficultyKnobs {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const keys: readonly (keyof DifficultyKnobs)[] = [
    'economyPressure',
    'breakdownRate',
    'qualityTolerance',
    'spoilage',
    'regulatorStrictness',
    'timePressure',
    'assistance',
  ];
  return keys.every((key) => typeof record[key] === 'number');
}

export function deserializeSave(json: string): SaveFile {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TypeError('save JSON must decode to an object');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record['seed'] !== 'number' || typeof record['startInstantMs'] !== 'number') {
    throw new TypeError('save JSON is missing a numeric seed or startInstantMs');
  }
  if (typeof record['tick'] !== 'number' || !Number.isInteger(record['tick']) || record['tick'] < 0) {
    throw new TypeError('save JSON is missing a valid non-negative integer tick');
  }
  const initialDifficulty = record['initialDifficulty'] as { preset?: unknown; knobs?: unknown } | undefined;
  if (!initialDifficulty || !isDifficultyKnobs(initialDifficulty.knobs)) {
    throw new TypeError('save JSON is missing valid initialDifficulty knobs');
  }
  if (!Array.isArray(record['difficultyChanges']) || !Array.isArray(record['commands'])) {
    throw new TypeError('save JSON is missing its difficultyChanges or commands arrays');
  }
  return record as unknown as SaveFile;
}

/**
 * Rebuild a fresh `SimWorld` from `save.seed`/`save.startInstantMs`/
 * `save.initialDifficulty`, then replay every difficulty change and command
 * recorded at or before `targetTick`, stepping the world forward tick by
 * tick exactly as it ran live.
 */
function replay(save: SaveFile, targetTick: number): SimWorld {
  if (!Number.isInteger(targetTick) || targetTick < 0 || targetTick > save.tick) {
    throw new RangeError(`cannot rewind to tick ${targetTick}: this save only covers ticks 0..${save.tick}`);
  }

  const world = new SimWorld({
    seed: save.seed,
    startInstantMs: save.startInstantMs,
    difficulty: save.initialDifficulty,
  });

  const commandsByTick = new Map<number, IpcCommand[]>();
  for (const command of save.commands) {
    if (command.tick > targetTick) continue;
    const existing = commandsByTick.get(command.tick);
    if (existing) existing.push(command.payload);
    else commandsByTick.set(command.tick, [command.payload]);
  }

  const difficultyByTick = new Map<number, DifficultyKnobs>();
  for (const change of save.difficultyChanges) {
    if (change.tick > targetTick) continue;
    difficultyByTick.set(change.tick, change.knobs);
  }

  const applyDue = (tick: number): void => {
    const knobs = difficultyByTick.get(tick);
    if (knobs) world.setDifficulty(knobs);
    for (const command of commandsByTick.get(tick) ?? []) world.applyCommand(command);
  };

  applyDue(0);
  while (world.tick < targetTick) {
    world.step();
    applyDue(world.tick);
  }
  return world;
}

/** Load a save exactly as it was taken — replays every recorded input up to
 * `save.tick`. The reproduced world's `digest()` matches the digest the live
 * world had at that tick, byte for byte. */
export function loadWorld(save: SaveFile): SimWorld {
  return replay(save, save.tick);
}

/** Rebuild the world exactly as it stood at an earlier tick, by replaying
 * only the inputs recorded at or before that tick. `toTick` must not exceed
 * `save.tick` — rewinding forward past what was actually recorded would not
 * be a rewind, it would be inventing input that never happened. */
export function rewindWorld(save: SaveFile, toTick: number): SimWorld {
  return replay(save, toTick);
}
