/**
 * The deterministic clock.
 *
 * Simulated time advances in fixed 1-second ticks, driven only by an explicit tick
 * count — never by wall-clock time. `Clock.advance` runs each tick exactly the same
 * way regardless of how many ticks are requested in one call, which is what makes
 * the 1x/60x equivalence hold: a real-time frame loop can batch 60 ticks into one
 * `advance(60)` at 60x speed and get precisely the state that 60 individual
 * `advance(1)` calls at 1x would have produced. See index.spec.ts for the test that
 * pins this down end to end.
 *
 * Simulated datetime is always derived from a `startInstantMs` supplied by the
 * caller — never from `Date.now()`, and never from `new Date()` called with no
 * argument — because either of those would make a replay's result depend on when
 * it happened to be replayed, which is exactly what determinism rules out.
 */

export interface TickContext {
  readonly tick: number;
  /** Milliseconds since the epoch that this tick lands on. */
  readonly instantMs: number;
}

/**
 * A per-tick system, run in a declared, deterministic order every tick.
 *
 * `order` is the primary sort key. Systems that declare the same `order` are then
 * sorted by `name`, so the schedule never depends on the sequence `register` was
 * called in — two callers that register the same systems in a different order
 * still get the same execution order.
 */
export interface TickSystem {
  readonly name: string;
  readonly order: number;
  run(ctx: TickContext): void;
}

/** The only speed multipliers the game exposes. 0 is paused. */
export const SPEEDS = [0, 1, 5, 60] as const;
export type Speed = (typeof SPEEDS)[number];

export function isSpeed(value: number): value is Speed {
  return (SPEEDS as readonly number[]).includes(value);
}

export class Clock {
  readonly #startInstantMs: number;
  readonly #systems: TickSystem[] = [];
  #tick = 0;

  constructor(startInstantMs: number) {
    if (!Number.isFinite(startInstantMs)) {
      throw new RangeError(`startInstantMs must be finite, got ${startInstantMs}`);
    }
    this.#startInstantMs = startInstantMs;
  }

  get tick(): number {
    return this.#tick;
  }

  get startInstantMs(): number {
    return this.#startInstantMs;
  }

  /** The simulated instant for a given tick (the current tick, by default). */
  instantMs(tick: number = this.#tick): number {
    return this.#startInstantMs + tick * 1000;
  }

  /** The simulated datetime for a given tick. Always built from `instantMs`. */
  date(tick: number = this.#tick): Date {
    return new Date(this.instantMs(tick));
  }

  /**
   * Register a per-tick system. Execution order is declared via `system.order`,
   * not inferred from the order `register` happens to be called in.
   */
  register(system: TickSystem): void {
    if (this.#systems.some((existing) => existing.name === system.name)) {
      throw new Error(`a system named "${system.name}" is already registered`);
    }
    this.#systems.push(system);
    this.#systems.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  }

  /** The systems that will run each tick, in the order they will run. */
  scheduledSystems(): readonly TickSystem[] {
    return [...this.#systems];
  }

  /**
   * Advance by exactly `ticks` fixed steps.
   *
   * Implemented as `ticks` sequential single-step advances, never as a batched
   * shortcut — there is deliberately no "fast path" that could compute a different
   * result for a larger step count.
   */
  advance(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new RangeError(`advance requires a non-negative integer tick count, got ${ticks}`);
    }
    for (let i = 0; i < ticks; i += 1) this.#step();
  }

  #step(): void {
    this.#tick += 1;
    const ctx: TickContext = { tick: this.#tick, instantMs: this.instantMs() };
    for (const system of this.#systems) system.run(ctx);
  }
}
