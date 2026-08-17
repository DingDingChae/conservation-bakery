/**
 * A tunable PID controller, deterministic by construction: it never reads the wall
 * clock, only a `dt` passed in by the caller on each `update()`. The same sequence
 * of `update()` calls with the same arguments always produces the same output.
 *
 * Anti-windup: the integral term only accumulates while doing so would not push the
 * output further past a limit it has already reached ("clamping" anti-windup). This
 * is what keeps a long saturation (an actuator pinned at its limit while the process
 * is far from setpoint) from leaving a huge hidden integral that later overshoots.
 *
 * Bumpless transfer: switching from MANUAL to AUTO computes the integral term that
 * reproduces the current manual output exactly at the instant of transfer, so the
 * output does not step when the mode changes — the operator feels no bump.
 */

export interface PidGains {
  readonly kp: number;
  readonly ki: number;
  readonly kd: number;
}

export interface PidLimits {
  readonly min: number;
  readonly max: number;
}

export type PidMode = 'AUTO' | 'MANUAL';

function clamp(value: number, limits: PidLimits): number {
  return Math.min(limits.max, Math.max(limits.min, value));
}

export class PidController {
  #gains: PidGains;
  readonly #limits: PidLimits;
  #mode: PidMode = 'MANUAL';
  #integral = 0;
  #output: number;
  #previousMeasurement = 0;
  #hasPrevious = false;

  constructor(gains: PidGains, limits: PidLimits, initialOutput = 0) {
    if (limits.min > limits.max) {
      throw new RangeError(`PID output limits are inverted: min ${limits.min} > max ${limits.max}`);
    }
    this.#gains = gains;
    this.#limits = limits;
    this.#output = clamp(initialOutput, limits);
  }

  get mode(): PidMode {
    return this.#mode;
  }

  get output(): number {
    return this.#output;
  }

  get gains(): PidGains {
    return this.#gains;
  }

  get limits(): PidLimits {
    return this.#limits;
  }

  /** The accumulated integral term, exposed for tuning displays and anti-windup tests. */
  get integralTerm(): number {
    return this.#integral;
  }

  setGains(gains: PidGains): void {
    this.#gains = gains;
  }

  /** Drive the output directly, as an operator would with the loop in MANUAL. */
  setManualOutput(value: number): void {
    this.#output = clamp(value, this.#limits);
  }

  /**
   * Switch modes. Transferring MANUAL -> AUTO is bumpless: the integral term is
   * back-solved so that `output` at this exact instant is unchanged, and the very
   * next `update()` continues smoothly from there rather than jumping to whatever
   * the accumulated (and, in MANUAL, frozen) integral would otherwise have produced.
   */
  transferTo(mode: PidMode, setpoint: number, measurement: number): void {
    if (mode === 'AUTO' && this.#mode !== 'AUTO') {
      const error = setpoint - measurement;
      const p = this.#gains.kp * error;
      // #integral already stands for the integral term's direct contribution to
      // output (each update() adds ki * error * dt to it directly), so solving for
      // "what integral term makes p + integral equal the current output" is a plain
      // subtraction, not a division by ki.
      this.#integral = this.#output - p;
      this.#previousMeasurement = measurement;
      this.#hasPrevious = true;
    }
    this.#mode = mode;
  }

  /**
   * Advance one fixed step of `dt` (seconds). In MANUAL the controller tracks the
   * process without acting, so a later bumpless transfer has a real measurement to
   * work from; the output is whatever the operator last set.
   */
  update(setpoint: number, measurement: number, dt: number): number {
    if (dt <= 0) throw new RangeError(`PID update requires dt > 0, got ${dt}`);

    if (this.#mode === 'MANUAL') {
      this.#previousMeasurement = measurement;
      this.#hasPrevious = true;
      return this.#output;
    }

    const error = setpoint - measurement;
    const p = this.#gains.kp * error;

    // Derivative on measurement, not on error, so a setpoint step alone never
    // produces a derivative kick.
    const measurementRate = this.#hasPrevious ? (measurement - this.#previousMeasurement) / dt : 0;
    const d = -this.#gains.kd * measurementRate;

    // Clamping anti-windup: only integrate further in the direction that is
    // already saturated if doing so would move the output back off the limit.
    const saturatedHigh = this.#output >= this.#limits.max;
    const saturatedLow = this.#output <= this.#limits.min;
    const wouldDeepenSaturation = (saturatedHigh && error > 0) || (saturatedLow && error < 0);
    if (this.#gains.ki !== 0 && !wouldDeepenSaturation) {
      this.#integral += this.#gains.ki * error * dt;
    }

    const output = clamp(p + this.#integral + d, this.#limits);
    this.#output = output;
    this.#previousMeasurement = measurement;
    this.#hasPrevious = true;
    return output;
  }
}
