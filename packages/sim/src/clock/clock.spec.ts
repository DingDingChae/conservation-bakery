import { describe, expect, it } from 'vitest';
import { Clock, isSpeed, SPEEDS, type TickContext } from './clock.js';

const START = Date.UTC(2026, 0, 1, 0, 0, 0);

describe('Clock', () => {
  it('starts at tick 0 and advances by exactly one per step', () => {
    const clock = new Clock(START);
    expect(clock.tick).toBe(0);
    clock.advance(1);
    expect(clock.tick).toBe(1);
    clock.advance(4);
    expect(clock.tick).toBe(5);
  });

  it('derives simulated instant and datetime from startInstantMs, one second per tick', () => {
    const clock = new Clock(START);
    clock.advance(90);
    expect(clock.tick).toBe(90);
    expect(clock.instantMs()).toBe(START + 90_000);
    expect(clock.date().getTime()).toBe(START + 90_000);
    // instantMs/date also accept an explicit tick, independent of the current one.
    expect(clock.instantMs(0)).toBe(START);
    expect(clock.date(0).getTime()).toBe(START);
  });

  it('rejects a negative or non-integer tick count', () => {
    const clock = new Clock(START);
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(1.5)).toThrow(RangeError);
  });

  it('rejects a non-finite startInstantMs', () => {
    expect(() => new Clock(Number.NaN)).toThrow(RangeError);
    expect(() => new Clock(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('runs registered systems in declared order, not registration order', () => {
    const calls: string[] = [];
    const clock = new Clock(START);
    clock.register({ name: 'zzz', order: 10, run: () => calls.push('zzz') });
    clock.register({ name: 'mmm', order: 5, run: () => calls.push('mmm') });
    clock.register({ name: 'aaa', order: 10, run: () => calls.push('aaa') });

    clock.advance(1);

    // order 5 first, then order 10 ties broken alphabetically by name.
    expect(calls).toEqual(['mmm', 'aaa', 'zzz']);
    expect(clock.scheduledSystems().map((s) => s.name)).toEqual(['mmm', 'aaa', 'zzz']);
  });

  it('rejects registering two systems with the same name', () => {
    const clock = new Clock(START);
    clock.register({ name: 'a', order: 0, run: () => {} });
    expect(() => clock.register({ name: 'a', order: 1, run: () => {} })).toThrow();
  });

  it('passes each system the correct tick and instant for every step', () => {
    const seen: TickContext[] = [];
    const clock = new Clock(START);
    clock.register({ name: 'recorder', order: 0, run: (ctx) => seen.push(ctx) });

    clock.advance(3);

    expect(seen).toEqual([
      { tick: 1, instantMs: START + 1000 },
      { tick: 2, instantMs: START + 2000 },
      { tick: 3, instantMs: START + 3000 },
    ]);
  });

  it('advancing N ticks one at a time equals advancing N ticks in one call', () => {
    const totalTicks = 600;

    const single = new Clock(START);
    const singleSeen: TickContext[] = [];
    single.register({ name: 'recorder', order: 0, run: (ctx) => singleSeen.push(ctx) });
    for (let i = 0; i < totalTicks; i += 1) single.advance(1);

    const batched = new Clock(START);
    const batchedSeen: TickContext[] = [];
    batched.register({ name: 'recorder', order: 0, run: (ctx) => batchedSeen.push(ctx) });
    batched.advance(totalTicks);

    expect(batched.tick).toBe(single.tick);
    expect(batchedSeen).toEqual(singleSeen);
  });

  it('advancing at 5x and 60x chunk sizes reaches the same schedule as 1x', () => {
    const totalTicks = 600;

    function runInChunksOf(chunk: number): TickContext[] {
      const clock = new Clock(START);
      const seen: TickContext[] = [];
      clock.register({ name: 'recorder', order: 0, run: (ctx) => seen.push(ctx) });
      let remaining = totalTicks;
      while (remaining > 0) {
        const step = Math.min(chunk, remaining);
        clock.advance(step);
        remaining -= step;
      }
      return seen;
    }

    const speed1 = runInChunksOf(1);
    const speed5 = runInChunksOf(5);
    const speed60 = runInChunksOf(60);

    expect(speed5).toEqual(speed1);
    expect(speed60).toEqual(speed1);
  });

  it('exposes the fixed set of speed multipliers, 0 meaning paused', () => {
    expect(SPEEDS).toEqual([0, 1, 5, 60]);
    expect(isSpeed(0)).toBe(true);
    expect(isSpeed(60)).toBe(true);
    expect(isSpeed(2)).toBe(false);
  });
});
