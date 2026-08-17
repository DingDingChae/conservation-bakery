/**
 * A fixed-capacity ring buffer of tag history for the trend recorder.
 *
 * Capacity is fixed at construction so a long-running world never grows memory
 * without bound: once full, the oldest sample is overwritten. Downsampling for a
 * long window is a deterministic function of the samples currently held — no
 * randomness, no wall-clock — so the same recorded history always renders the same
 * trend.
 */

export interface TrendSample {
  readonly tick: number;
  readonly value: number;
}

export class TrendBuffer {
  readonly capacity: number;
  readonly #backing: (TrendSample | undefined)[];
  #start = 0;
  #count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`trend buffer capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.#backing = new Array(capacity);
  }

  get size(): number {
    return this.#count;
  }

  get full(): boolean {
    return this.#count === this.capacity;
  }

  record(sample: TrendSample): void {
    const index = (this.#start + this.#count) % this.capacity;
    this.#backing[index] = sample;
    if (this.#count < this.capacity) {
      this.#count += 1;
    } else {
      this.#start = (this.#start + 1) % this.capacity;
    }
  }

  /** Every held sample, oldest first. */
  samples(): readonly TrendSample[] {
    const out: TrendSample[] = [];
    for (let i = 0; i < this.#count; i += 1) {
      const sample = this.#backing[(this.#start + i) % this.capacity];
      if (sample) out.push(sample);
    }
    return out;
  }

  /**
   * Downsample to at most `targetPoints` points. The held samples (oldest to
   * newest) are split into `targetPoints` equal-width buckets by position, not by
   * wall time, and each bucket becomes one point: the mean tick and mean value of
   * the samples that fall in it. A window that already fits is returned unchanged.
   *
   * Deterministic and pure: the same buffer contents always downsample to the same
   * points, regardless of when or how many times it is called.
   */
  downsample(targetPoints: number): readonly TrendSample[] {
    if (!Number.isInteger(targetPoints) || targetPoints <= 0) {
      throw new RangeError(`targetPoints must be a positive integer, got ${targetPoints}`);
    }
    const all = this.samples();
    if (all.length <= targetPoints) return all;

    const out: TrendSample[] = [];
    const bucketSize = all.length / targetPoints;
    for (let bucket = 0; bucket < targetPoints; bucket += 1) {
      const from = Math.floor(bucket * bucketSize);
      const to = Math.max(Math.floor((bucket + 1) * bucketSize), from + 1);
      let tickSum = 0;
      let valueSum = 0;
      let n = 0;
      for (let i = from; i < to && i < all.length; i += 1) {
        const sample = all[i];
        if (!sample) continue;
        tickSum += sample.tick;
        valueSum += sample.value;
        n += 1;
      }
      if (n === 0) continue;
      out.push({ tick: Math.round(tickSum / n), value: valueSum / n });
    }
    return out;
  }
}
