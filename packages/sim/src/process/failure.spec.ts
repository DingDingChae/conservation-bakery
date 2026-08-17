import { describe, expect, it } from 'vitest';
import { createSeededRng, WearComponent, type ComponentDefinition } from './failure.js';

function def(overrides: Partial<ComponentDefinition> = {}): ComponentDefinition {
  return { kind: 'bearing', label: 'main drive bearing', wearRatePerHour: 0.001, dutyExponent: 1, ...overrides };
}

describe('createSeededRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createSeededRng(123);
    const b = createSeededRng(123);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces values in [0, 1)', () => {
    const rng = createSeededRng(1);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('different seeds produce different sequences', () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });
});

describe('WearComponent', () => {
  it('accumulates wear deterministically and fails by the time wear reaches 1', () => {
    // wearRatePerHour 0.01 reaches wear 1 (guaranteed failure) at hour 100 at the
    // latest, but the random early-failure chance in the 0.8..1.0 "at risk" band
    // can fire sooner for a given seed — so this asserts the outcome, not the
    // exact hour.
    const component = new WearComponent(def({ wearRatePerHour: 0.01 }));
    const rng = createSeededRng(1);
    let firstEvent;
    for (let hour = 1; hour <= 100; hour += 1) {
      const event = component.advance(1, 1, rng, hour);
      if (event && !firstEvent) firstEvent = event;
    }
    expect(component.wear).toBe(1);
    expect(component.failed).toBe(true);
    expect(firstEvent?.kind).toBe('condemned');
    expect(firstEvent?.componentKind).toBe('bearing');
    expect(firstEvent?.runHoursAtFailure).toBeLessThanOrEqual(100);
  });

  it('does not wear while duty is zero', () => {
    const component = new WearComponent(def());
    const rng = createSeededRng(1);
    component.advance(1000, 0, rng, 1000);
    expect(component.wear).toBe(0);
    expect(component.failed).toBe(false);
  });

  it('reports no event once already failed', () => {
    const component = new WearComponent(def({ wearRatePerHour: 1 })); // fails immediately
    const rng = createSeededRng(1);
    const first = component.advance(1, 1, rng, 1);
    expect(first?.kind).toBe('condemned');
    const second = component.advance(1, 1, rng, 2);
    expect(second).toBeUndefined();
  });

  it('rejects a negative hours advance', () => {
    const component = new WearComponent(def());
    const rng = createSeededRng(1);
    expect(() => component.advance(-1, 1, rng, 0)).toThrow();
  });

  it('replace() resets wear and failed state', () => {
    const component = new WearComponent(def({ wearRatePerHour: 1 }));
    const rng = createSeededRng(1);
    component.advance(1, 1, rng, 1);
    expect(component.failed).toBe(true);
    component.replace();
    expect(component.wear).toBe(0);
    expect(component.failed).toBe(false);
  });

  it('is fully reproducible: same seed and schedule fail at the same hour', () => {
    const runToFailure = (seed: number): number | undefined => {
      const component = new WearComponent(def({ wearRatePerHour: 0.001 }));
      const rng = createSeededRng(seed);
      for (let hour = 1; hour <= 2000; hour += 1) {
        const event = component.advance(1, 1, rng, hour);
        if (event) return event.runHoursAtFailure;
      }
      return undefined;
    };

    const first = runToFailure(999);
    const second = runToFailure(999);
    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  it('different seeds can fail at different hours within the at-risk window', () => {
    const runToFailure = (seed: number): number | undefined => {
      const component = new WearComponent(def({ wearRatePerHour: 0.001 }));
      const rng = createSeededRng(seed);
      for (let hour = 1; hour <= 2000; hour += 1) {
        const event = component.advance(1, 1, rng, hour);
        if (event) return event.runHoursAtFailure;
      }
      return undefined;
    };

    const results = new Set([1, 2, 3, 4, 5].map((seed) => runToFailure(seed)));
    // Not a hard guarantee for any possible seed set, but across five different
    // seeds the random early-failure chance should produce more than one distinct
    // failure hour, proving the RNG is actually being consulted.
    expect(results.size).toBeGreaterThan(1);
  });
});
