import { describe, expect, it } from 'vitest';
import { Rng } from '../clock/rng.js';
import type { HaccpPlan, TemperatureLogEntry } from './quality.js';
import { inspect } from './regulator.js';

const PLAN: HaccpPlan = {
  id: 'plan-1',
  ccps: [{ id: 'core-temp', description: 'core bake temperature', parameter: 'core-temperature-c', minValue: 90, maxValue: 220 }],
};

function buildLog(length: number, badIndices: readonly number[]): TemperatureLogEntry[] {
  const bad = new Set(badIndices);
  return Array.from({ length }, (_, i) => ({
    tick: i,
    ccpId: 'core-temp',
    valueC: bad.has(i) ? 50 : 150,
  }));
}

describe('regulator: inspections', () => {
  it('passes with no findings when nothing on the log is out of limit', () => {
    const log = buildLog(50, []);
    const result = inspect(PLAN, log, 'punishing', Rng.fromSeed(1), 0);
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.lineStopped).toBe(false);
  });

  it('is advisory-only on Free Play and Easy: a finding never stops the line', () => {
    const log = buildLog(50, Array.from({ length: 50 }, (_, i) => i)); // every reading fails
    const freePlay = inspect(PLAN, log, 'free-play', Rng.fromSeed(2), 0);
    const easy = inspect(PLAN, log, 'easy', Rng.fromSeed(2), 0);
    expect(freePlay.passed).toBe(false);
    expect(freePlay.findings.length).toBeGreaterThan(0);
    expect(freePlay.lineStopped).toBe(false);
    expect(easy.lineStopped).toBe(false);
  });

  it('enforces a line stop on Realistic and Punishing when a finding occurs', () => {
    const log = buildLog(50, Array.from({ length: 50 }, (_, i) => i));
    const realistic = inspect(PLAN, log, 'realistic', Rng.fromSeed(2), 0);
    const punishing = inspect(PLAN, log, 'punishing', Rng.fromSeed(2), 0);
    expect(realistic.lineStopped).toBe(true);
    expect(punishing.lineStopped).toBe(true);
  });

  it('samples a larger share of the log on a stricter difficulty', () => {
    const log = buildLog(100, []);
    const freePlay = inspect(PLAN, log, 'free-play', Rng.fromSeed(3), 0);
    const punishing = inspect(PLAN, log, 'punishing', Rng.fromSeed(3), 0);
    expect(punishing.sampledEntries).toBeGreaterThan(freePlay.sampledEntries);
    expect(punishing.sampledEntries).toBe(100); // punishing reviews the whole log
  });

  it('never finds anything in an empty log', () => {
    const result = inspect(PLAN, [], 'punishing', Rng.fromSeed(4), 0);
    expect(result).toEqual({ tick: 0, sampledEntries: 0, findings: [], passed: true, lineStopped: false });
  });

  it('is deterministic: the same seed and inputs produce the exact same inspection result', () => {
    const log = buildLog(80, [5, 40, 71]);
    const a = inspect(PLAN, log, 'realistic', Rng.fromSeed(123), 7);
    const b = inspect(PLAN, log, 'realistic', Rng.fromSeed(123), 7);
    expect(a).toEqual(b);
  });

  it('a different seed can sample a different subset of the log', () => {
    const log = buildLog(80, [5, 40, 71]);
    const a = inspect(PLAN, log, 'free-play', Rng.fromSeed(1), 0);
    const b = inspect(PLAN, log, 'free-play', Rng.fromSeed(2), 0);
    // Not guaranteed to differ for every seed pair in general, but this pair
    // is fixed and checked to actually differ, so the test is not vacuous.
    expect(a).not.toEqual(b);
  });
});
