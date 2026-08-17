import { describe, expect, it } from 'vitest';

import {
  DIFFICULTY_PRESETS,
  breakdownHazardMultiplier,
  clampKnob,
  presetSettings,
  startingCashMinor,
  supplierCallsPermitted,
  supplierLeadTimeTicks,
  supplierPriceMinor,
  withKnobs,
  type DifficultyPresetName,
} from './difficulty.js';
import { SimWorld } from './world.js';

const PRESETS: readonly DifficultyPresetName[] = ['freePlay', 'easy', 'realistic', 'punishing'];

describe('difficulty presets and knobs', () => {
  it('keeps every knob in every preset within 0..1', () => {
    for (const preset of PRESETS) {
      for (const value of Object.values(DIFFICULTY_PRESETS[preset])) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clamps a knob into 0..1, including non-finite input', () => {
    expect(clampKnob(-5)).toBe(0);
    expect(clampKnob(5)).toBe(1);
    expect(clampKnob(0.5)).toBe(0.5);
    expect(clampKnob(Number.NaN)).toBe(0);
  });

  it('re-derives the preset name from the actual knobs, never trusting a stale label', () => {
    const easy = presetSettings('easy');
    const moved = withKnobs(easy, { economyPressure: 0.9 });
    expect(moved.preset).toBe('custom');

    // Moving every knob back to Punishing's own values is recognised as Punishing again.
    const backToPunishing = withKnobs(moved, DIFFICULTY_PRESETS.punishing);
    expect(backToPunishing.preset).toBe('punishing');
  });

  it('only permits call-a-supplier at Free Play and Easy', () => {
    expect(supplierCallsPermitted(DIFFICULTY_PRESETS.freePlay)).toBe(true);
    expect(supplierCallsPermitted(DIFFICULTY_PRESETS.easy)).toBe(true);
    expect(supplierCallsPermitted(DIFFICULTY_PRESETS.realistic)).toBe(false);
    expect(supplierCallsPermitted(DIFFICULTY_PRESETS.punishing)).toBe(false);
  });

  it('makes Free Play strictly more generous than Punishing on cash, price, lead time and hazard', () => {
    const free = DIFFICULTY_PRESETS.freePlay;
    const punishing = DIFFICULTY_PRESETS.punishing;

    expect(startingCashMinor(free)).toBeGreaterThan(startingCashMinor(punishing));
    expect(supplierPriceMinor('wheat-flour-white', 1_000_000_000n, free)).toBeLessThan(
      supplierPriceMinor('wheat-flour-white', 1_000_000_000n, punishing),
    );
    expect(supplierLeadTimeTicks(free)).toBeLessThan(supplierLeadTimeTicks(punishing));
    expect(breakdownHazardMultiplier(free)).toBeLessThan(breakdownHazardMultiplier(punishing));
  });

  it('never returns a non-positive starting cash, price or lead time, at any preset', () => {
    for (const preset of PRESETS) {
      const knobs = DIFFICULTY_PRESETS[preset];
      expect(startingCashMinor(knobs)).toBeGreaterThan(0n);
      expect(supplierPriceMinor('wheat-flour-white', 1_000_000_000n, knobs)).toBeGreaterThanOrEqual(0n);
      expect(supplierLeadTimeTicks(knobs)).toBeGreaterThanOrEqual(1);
    }
  });

  it('closes the ledger to exactly zero residual under every preset, whether or not a call-a-supplier is permitted', () => {
    for (const preset of PRESETS) {
      const world = new SimWorld({ seed: 7, startInstantMs: 1_767_593_600_000, difficulty: presetSettings(preset) });

      world.applyCommand({ kind: 'setMode', machineId: 'mixer-1', mode: 'MANUAL' });
      world.applyCommand({ kind: 'setMode', machineId: 'oven-1', mode: 'AUTO' });
      // Attempted at every preset; only accepted where the difficulty
      // permits it — either outcome must still leave the ledger closed.
      world.applyCommand({ kind: 'callSupplier', substanceId: 'butter', massUg: '2000000' });

      for (let i = 0; i < 25; i += 1) world.step();

      const audit = world.ledger.audit();
      expect(audit.ok, `preset ${preset}: ${JSON.stringify(audit.discrepancies)}`).toBe(true);
      expect(world.snapshot().balanceOk).toBe(true);
    }
  });
});
