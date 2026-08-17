/**
 * The simulation worker.
 *
 * Boots the interactive world (`world.ts`) on its own thread, runs it on a
 * fixed 1-second step regardless of what the main process happens to be
 * doing, and speaks exactly the message shapes `simulationHost.ts` expects:
 * `{kind:'snapshot',snapshot}`, `{kind:'reply',id,payload}`,
 * `{kind:'error',id,message}`, `{kind:'fault',message}`.
 *
 * This file is deliberately thin. Every rule that governs *what* the world
 * does lives in `world.ts`, `machines.ts` and `difficulty.ts`, all of which
 * are plain classes and functions a test can drive directly without ever
 * spinning up a real worker thread. What lives here is only the two things
 * that genuinely need a live thread: the real-time scheduling loop, and the
 * `postMessage` protocol.
 */

import { parentPort } from 'node:worker_threads';

import type { Command, CommandResult, ProvenanceNode } from '../shared/ipc.js';
import { defaultDifficultySettings } from './difficulty.js';
import { SimWorld } from './world.js';

if (!parentPort) {
  throw new Error('sim-worker/worker.ts must be run inside a worker thread');
}
const port = parentPort;

/** A fixed, arbitrary in-world epoch — 2026-01-05T06:00:00.000Z — never
 * `Date.now()` or an argless `new Date()`. `save.ts` exists precisely so a
 * future message could hand this worker a `SaveFile` to resume from instead
 * of always starting a fresh world here; `shared/ipc.ts` does not yet carry
 * a message for that, which is a gap in the shared contract, not here. */
const DEFAULT_START_INSTANT_MS = 1_767_593_600_000;
const DEFAULT_SEED = 1;

const world = new SimWorld({
  seed: DEFAULT_SEED,
  startInstantMs: DEFAULT_START_INSTANT_MS,
  difficulty: defaultDifficultySettings(),
});

/** How often a snapshot is actually pushed to the main process, regardless
 * of speed — "throttle to about 10 publishes a second even at 60x" per this
 * package's brief. This only changes how often `world.snapshot()` is *read*;
 * `frame()` below always runs every tick the wall clock owes the simulation
 * first, so the throttle can never change which ticks ran. */
const PUBLISH_INTERVAL_MS = 100;
/** How often the scheduling loop itself wakes up. Finer than the publish
 * interval so that even at 1x speed, a tick lands close to its real second
 * rather than being batched into a visible stutter. */
const FRAME_INTERVAL_MS = 50;

let lastPublishMs = 0;
/** Fractional ticks the wall clock owes the simulation but hasn't rounded
 * up to a whole tick yet. Carried across frames so no tick is ever dropped —
 * only ever deferred to the next frame that completes it. */
let carryTicks = 0;
let stopped = false;

function postSnapshot(): void {
  port.postMessage({ kind: 'snapshot', snapshot: world.snapshot() });
}

function fault(message: string): void {
  stopped = true;
  clearInterval(timer);
  port.postMessage({ kind: 'fault', message });
}

function frame(): void {
  if (stopped) return;

  if (world.speed > 0) {
    const owedTicks = (FRAME_INTERVAL_MS / 1000) * world.speed;
    carryTicks += owedTicks;
    const wholeTicks = Math.floor(carryTicks);
    carryTicks -= wholeTicks;

    for (let i = 0; i < wholeTicks; i += 1) {
      try {
        // Every owed tick runs, in full, every time — see CONTRACT.md rule 1
        // and this package's brief: skipping a tick to save a frame would
        // change the world, not just how often it's drawn.
        world.step();
      } catch (error) {
        fault(error instanceof Error ? error.message : String(error));
        return;
      }
    }
  }

  // `Date.now()` here only decides *when* to read and push the next
  // snapshot — a display cadence, not simulation state. See
  // `world.spec.ts`'s throttle-invariance test for the property this relies
  // on: `world.digest()` after N `step()` calls never depends on how often
  // (or whether) a snapshot was published along the way.
  const now = Date.now();
  if (now - lastPublishMs >= PUBLISH_INTERVAL_MS) {
    lastPublishMs = now;
    postSnapshot();
  }
}

const timer = setInterval(frame, FRAME_INTERVAL_MS);

interface IncomingMessage {
  readonly kind: string;
  readonly id: number;
  readonly payload: unknown;
}

port.on('message', (message: IncomingMessage) => {
  try {
    if (message.kind === 'command') {
      const result: CommandResult = world.applyCommand(message.payload as Command);
      port.postMessage({ kind: 'reply', id: message.id, payload: result });
      return;
    }
    if (message.kind === 'provenance') {
      const { lotId } = message.payload as { lotId: string };
      const node: ProvenanceNode = world.provenance(lotId);
      port.postMessage({ kind: 'reply', id: message.id, payload: node });
      return;
    }
    port.postMessage({ kind: 'error', id: message.id, message: `unknown request kind "${message.kind}"` });
  } catch (error) {
    port.postMessage({ kind: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
});

// Publish an initial snapshot immediately, so the main process has something
// to show before the first 100ms publish tick lands.
postSnapshot();
