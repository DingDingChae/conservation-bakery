import { describe, expect, it } from 'vitest';
import { TrendBuffer } from './trend.js';

describe('TrendBuffer capacity', () => {
  it('holds up to capacity samples in order', () => {
    const buffer = new TrendBuffer(3);
    buffer.record({ tick: 1, value: 10 });
    buffer.record({ tick: 2, value: 20 });
    buffer.record({ tick: 3, value: 30 });
    expect(buffer.size).toBe(3);
    expect(buffer.full).toBe(true);
    expect(buffer.samples()).toEqual([
      { tick: 1, value: 10 },
      { tick: 2, value: 20 },
      { tick: 3, value: 30 },
    ]);
  });

  it('overwrites the oldest sample once full, staying at fixed capacity', () => {
    const buffer = new TrendBuffer(3);
    for (let i = 1; i <= 5; i += 1) buffer.record({ tick: i, value: i * 10 });
    expect(buffer.size).toBe(3);
    expect(buffer.samples()).toEqual([
      { tick: 3, value: 30 },
      { tick: 4, value: 40 },
      { tick: 5, value: 50 },
    ]);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new TrendBuffer(0)).toThrow();
    expect(() => new TrendBuffer(-1)).toThrow();
  });
});

describe('TrendBuffer downsampling', () => {
  it('returns the samples unchanged when they already fit', () => {
    const buffer = new TrendBuffer(10);
    buffer.record({ tick: 1, value: 1 });
    buffer.record({ tick: 2, value: 2 });
    expect(buffer.downsample(100)).toEqual(buffer.samples());
  });

  it('downsamples a long window to the requested point count deterministically', () => {
    const buffer = new TrendBuffer(1000);
    for (let i = 0; i < 1000; i += 1) buffer.record({ tick: i, value: i });

    const first = buffer.downsample(10);
    const second = buffer.downsample(10);
    expect(first).toHaveLength(10);
    expect(first).toEqual(second); // deterministic: same buffer, same result every time

    // Bucket means should be monotonically increasing for monotonically increasing input.
    for (let i = 1; i < first.length; i += 1) {
      const previous = first[i - 1]!;
      const current = first[i]!;
      expect(current.value).toBeGreaterThan(previous.value);
    }
  });

  it('rejects a non-positive target point count', () => {
    const buffer = new TrendBuffer(5);
    buffer.record({ tick: 1, value: 1 });
    expect(() => buffer.downsample(0)).toThrow();
  });
});
