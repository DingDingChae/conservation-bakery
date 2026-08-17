/**
 * Hand-built fixtures for the renderer mount smoke test (`mount.spec.ts`).
 *
 * A `WorldSnapshot` with two machines (one running with an active alarm, one idle with
 * a normal one), several tags (some with a setpoint, one without), and a small
 * `ProvenanceNode` tree — enough real shape for every panel the shell can show
 * (header, nav rail, faceplate, balance, provenance tree, settings) to render
 * something a person could actually read, not just an empty shell.
 *
 * Every name here is equipment or product only, per CONTRACT.md rule 2 — "interlock
 * refusal" and "motor overload trip" are the two alarm names below, verbatim.
 */

import type { MachineSnapshot, ProvenanceNode, WorldSnapshot } from '../../shared/ipc.js';

export const FIXTURE_MACHINE_OVEN_ID = 'oven-1';
export const FIXTURE_MACHINE_MIXER_ID = 'mixer-1';
export const FIXTURE_ALARM_ID = 'door-interlock';
export const FIXTURE_TAG_ID = 'top-heat';
export const FIXTURE_LOT_ID = 'lot-loaf-0001';

const ovenMachine: MachineSnapshot = {
  id: FIXTURE_MACHINE_OVEN_ID,
  label: 'Deck Oven 1',
  mode: 'AUTO',
  commissioned: true,
  running: true,
  runHours: 128.5,
  serviceDueInHours: 40,
  tags: [
    {
      id: FIXTURE_TAG_ID,
      label: 'Top Heat',
      unit: '°C',
      value: 212,
      setpoint: 220,
      rangeLow: 150,
      rangeHigh: 260,
    },
    {
      id: 'belt-speed',
      label: 'Belt Speed',
      unit: '%',
      value: 64,
      setpoint: 70,
      rangeLow: 0,
      rangeHigh: 100,
    },
  ],
  alarms: [
    {
      id: FIXTURE_ALARM_ID,
      label: 'Door Interlock',
      state: 'active-unacknowledged',
      priority: 1,
      firstOut: true,
      raisedAtTick: 4180,
    },
    {
      id: 'element-temp-high',
      label: 'Element Temp High',
      state: 'cleared',
      priority: 2,
      firstOut: false,
      raisedAtTick: 4000,
    },
  ],
};

const mixerMachine: MachineSnapshot = {
  id: FIXTURE_MACHINE_MIXER_ID,
  label: 'Spiral Mixer 1',
  mode: 'MANUAL',
  commissioned: true,
  running: false,
  runHours: 5,
  serviceDueInHours: 500,
  tags: [
    {
      id: 'bowl-speed',
      label: 'Bowl Speed',
      unit: 'rpm',
      value: 0,
      setpoint: null,
      rangeLow: 0,
      rangeHigh: 120,
    },
  ],
  alarms: [
    {
      id: 'motor-overload',
      label: 'Motor Overload Trip',
      state: 'normal',
      priority: 3,
      firstOut: false,
      raisedAtTick: 0,
    },
  ],
};

/** Two machines, several tags, one active-unacknowledged alarm — the minimum this
 * task's brief asks the fixture to carry. */
export function buildFixtureSnapshot(): WorldSnapshot {
  return {
    tick: 4200,
    simulatedTime: '2026-01-05T06:30:00.000Z',
    speed: 1,
    machines: [ovenMachine, mixerMachine],
    balance: [
      { commodity: 'wheat-flour-white', residual: '0' },
      { commodity: 'water-liquid', residual: '0' },
      { commodity: 'energy', residual: '0' },
    ],
    balanceOk: true,
    digest: 'fixture-digest',
  };
}

const flourLot: ProvenanceNode = {
  lotId: 'lot-flour-0001',
  substanceId: 'wheat-flour-white',
  label: 'Wheat Flour White',
  mass: '600000',
  tick: 4000,
  process: 'delivery',
  children: [],
};

const doughLot: ProvenanceNode = {
  lotId: 'lot-dough-0001',
  substanceId: 'dough',
  label: 'Dough Batch',
  mass: '950000',
  tick: 4100,
  process: 'mixing',
  children: [flourLot],
};

/** A small, real ancestry tree — root, one child, one grandchild — for the provenance
 * screen (`provenance/tree.ts`) to walk and render. */
export function buildFixtureProvenance(): ProvenanceNode {
  return {
    lotId: FIXTURE_LOT_ID,
    substanceId: 'bread-loaf',
    label: 'Bread Loaf Lot 0001',
    mass: '900000',
    tick: 4200,
    process: 'baking',
    children: [doughLot],
  };
}
