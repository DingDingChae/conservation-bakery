import { describe, expect, it } from 'vitest';
import { PidController } from './pid.js';

/** A simple first-order lag plant: measurement chases output with time constant tau. */
function stepPlant(measurement: number, output: number, dt: number, tau: number): number {
  return measurement + ((output - measurement) * dt) / tau;
}

describe('PidController reaching setpoint', () => {
  it('converges to setpoint on a first-order plant', () => {
    const pid = new PidController({ kp: 2, ki: 0.8, kd: 0.05 }, { min: -100, max: 100 });
    pid.transferTo('AUTO', 50, 0);

    let measurement = 0;
    const dt = 0.1;
    for (let step = 0; step < 2000; step += 1) {
      const output = pid.update(50, measurement, dt);
      measurement = stepPlant(measurement, output, dt, 2);
    }

    expect(Math.abs(measurement - 50)).toBeLessThan(0.5);
  });
});

describe('PidController anti-windup', () => {
  it('keeps the integral term far smaller than a naive, unguarded integrator would', () => {
    // Output is tightly clamped, so the loop saturates almost immediately and stays
    // saturated for a long stretch while the setpoint is far away — exactly the
    // condition that makes an unprotected integral run away.
    const pid = new PidController({ kp: 1, ki: 1, kd: 0 }, { min: 0, max: 10 });
    pid.transferTo('AUTO', 100, 0);

    let naiveIntegral = 0;
    let measurement = 0;
    const dt = 0.1;
    const ki = 1;
    for (let step = 0; step < 500; step += 1) {
      const output = pid.update(100, measurement, dt);
      // A naive integrator accumulates every step, unconditionally, with no clamp
      // guard — this is the runaway behaviour anti-windup exists to prevent.
      naiveIntegral += ki * (100 - measurement) * dt;
      measurement = stepPlant(measurement, output, dt, 50); // slow plant: stays saturated
    }

    expect(Math.abs(naiveIntegral)).toBeGreaterThan(1000); // sanity: the naive baseline really did run away
    expect(Math.abs(pid.integralTerm)).toBeLessThan(Math.abs(naiveIntegral) / 10);
  });

  it('recovers promptly once the setpoint reverses, instead of staying pinned', () => {
    const pid = new PidController({ kp: 1, ki: 1, kd: 0 }, { min: 0, max: 10 });
    pid.transferTo('AUTO', 100, 0);

    let measurement = 0;
    const dt = 0.1;
    for (let step = 0; step < 500; step += 1) {
      const output = pid.update(100, measurement, dt);
      measurement = stepPlant(measurement, output, dt, 50);
    }
    expect(pid.output).toBe(10); // confirm it really is pinned at the high limit

    // Reverse the setpoint hard and confirm the output comes off the high limit
    // well before it would if the integral had run away unchecked (which, at the
    // naive accumulation rate measured above, would take hundreds of steps to
    // unwind through zero).
    let leftSaturationWithin = -1;
    for (let step = 0; step < 30; step += 1) {
      const output = pid.update(-100, measurement, dt);
      measurement = stepPlant(measurement, output, dt, 50);
      if (output < 10) {
        leftSaturationWithin = step;
        break;
      }
    }
    expect(leftSaturationWithin).toBeGreaterThanOrEqual(0);
    expect(leftSaturationWithin).toBeLessThan(30);
  });

  it('respects output clamping', () => {
    const pid = new PidController({ kp: 10, ki: 5, kd: 0 }, { min: -1, max: 1 });
    pid.transferTo('AUTO', 1000, 0);
    for (let step = 0; step < 50; step += 1) {
      const output = pid.update(1000, 0, 0.1);
      expect(output).toBeLessThanOrEqual(1);
      expect(output).toBeGreaterThanOrEqual(-1);
    }
  });
});

describe('PidController bumpless transfer', () => {
  it('produces no output step when transferring MANUAL -> AUTO', () => {
    const pid = new PidController({ kp: 3, ki: 0.5, kd: 0.1 }, { min: -50, max: 50 });
    pid.setManualOutput(12.5);
    expect(pid.output).toBeCloseTo(12.5, 10);

    pid.transferTo('AUTO', 20, 18);
    // The transfer itself must not move the output at all.
    expect(pid.output).toBeCloseTo(12.5, 10);
    expect(pid.mode).toBe('AUTO');
  });

  it('does not move output on transfer even with different gains and clamped limits', () => {
    const pid = new PidController({ kp: 0.2, ki: 2, kd: 0 }, { min: 0, max: 100 });
    pid.setManualOutput(40);
    pid.transferTo('AUTO', 200, 150);
    expect(pid.output).toBeCloseTo(40, 9);
  });

  it('MANUAL mode holds the operator-set output regardless of error', () => {
    const pid = new PidController({ kp: 5, ki: 5, kd: 5 }, { min: -10, max: 10 });
    pid.setManualOutput(3);
    for (let step = 0; step < 10; step += 1) {
      const output = pid.update(100, 0, 0.1);
      expect(output).toBe(3);
    }
  });
});
