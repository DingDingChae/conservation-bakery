/**
 * Simulation host.
 *
 * Runs the deterministic core on a worker thread and publishes snapshots. The
 * simulation must never share a thread with the window: a 60x tick burst would
 * otherwise stall the interface, and — worse — a renderer stall would change how many
 * ticks elapsed, which would make the world's outcome depend on frame timing. The
 * simulation's clock is its own, and the window merely watches it.
 *
 * Nothing here computes physics. This class owns the worker's lifecycle and the
 * translation between worker messages and the declared IPC contract.
 */

import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type {
  Command,
  CommandResult,
  ProvenanceNode,
  WorldSnapshot,
} from '../shared/ipc.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface PendingRequest {
  readonly resolve: (value: never) => void;
  readonly reject: (reason: Error) => void;
}

type WorkerMessage =
  | { readonly kind: 'snapshot'; readonly snapshot: WorldSnapshot }
  | { readonly kind: 'reply'; readonly id: number; readonly payload: unknown }
  | { readonly kind: 'error'; readonly id: number; readonly message: string }
  | { readonly kind: 'fault'; readonly message: string };

export declare interface SimulationHost {
  on(event: 'snapshot', listener: (snapshot: WorldSnapshot) => void): this;
  /**
   * A conservation failure is not a recoverable condition. If the ledger ever fails to
   * balance, the world is no longer trustworthy and the honest thing is to stop and say
   * so rather than keep drawing a factory whose books do not close.
   */
  on(event: 'fault', listener: (message: string) => void): this;
}

export class SimulationHost extends EventEmitter {
  #worker: Worker | null = null;
  #latest: WorldSnapshot | null = null;
  #nextRequestId = 1;
  readonly #pending = new Map<number, PendingRequest>();

  start(): void {
    if (this.#worker) return;

    const worker = new Worker(path.join(here, '../sim-worker/worker.js'));
    this.#worker = worker;

    worker.on('message', (message: WorkerMessage) => {
      switch (message.kind) {
        case 'snapshot':
          this.#latest = message.snapshot;
          this.emit('snapshot', message.snapshot);
          return;
        case 'reply': {
          const pending = this.#pending.get(message.id);
          if (!pending) return;
          this.#pending.delete(message.id);
          (pending.resolve as (value: unknown) => void)(message.payload);
          return;
        }
        case 'error': {
          const pending = this.#pending.get(message.id);
          if (!pending) return;
          this.#pending.delete(message.id);
          pending.reject(new Error(message.message));
          return;
        }
        case 'fault':
          this.emit('fault', message.message);
          return;
      }
    });

    worker.on('error', (error: unknown) => {
      this.emit('fault', error instanceof Error ? error.message : String(error));
    });

    // Reject everything still in flight rather than leaving a caller waiting forever
    // on a worker that has gone.
    worker.on('exit', (code) => {
      for (const [, pending] of this.#pending) {
        pending.reject(new Error(`the simulation worker exited with code ${code}`));
      }
      this.#pending.clear();
      this.#worker = null;
    });
  }

  stop(): void {
    const worker = this.#worker;
    this.#worker = null;
    if (worker) void worker.terminate();
  }

  snapshot(): WorldSnapshot | null {
    return this.#latest;
  }

  send(command: Command): Promise<CommandResult> {
    return this.#request<CommandResult>('command', command);
  }

  provenance(lotId: string): Promise<ProvenanceNode> {
    return this.#request<ProvenanceNode>('provenance', { lotId });
  }

  #request<T>(kind: string, payload: unknown): Promise<T> {
    const worker = this.#worker;
    if (!worker) {
      return Promise.reject(new Error('the simulation worker is not running'));
    }
    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: resolve as (value: never) => void,
        reject,
      });
      worker.postMessage({ kind, id, payload });
    });
  }
}
