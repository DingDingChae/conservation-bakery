import { describe, expect, it } from 'vitest';

import { Ledger, elementCommodity, grams } from '@conservation-bakery/sim';

import { createMixerRig, createOvenRig, moveElementalMassUpTo } from './machines.js';

function freshLedger(): Ledger {
  const ledger = new Ledger();
  ledger.openAccount({ id: 'from', kind: 'stock', label: 'from' });
  ledger.openAccount({ id: 'to', kind: 'stock', label: 'to' });
  return ledger;
}

describe('moveElementalMassUpTo', () => {
  it('moves exactly the requested mass, split proportionally across whatever elements are present', () => {
    const ledger = freshLedger();
    ledger.post({
      process: 'test:seed',
      entries: [
        { account: 'genesis', commodity: elementCommodity('C'), delta: -grams(60) },
        { account: 'from', commodity: elementCommodity('C'), delta: grams(60) },
        { account: 'genesis', commodity: elementCommodity('H'), delta: -grams(40) },
        { account: 'from', commodity: elementCommodity('H'), delta: grams(40) },
      ],
    });

    const moved = moveElementalMassUpTo(ledger, 'from', 'to', grams(50), 'test:move');

    expect(moved).toBe(grams(50));
    expect(ledger.balance('to', elementCommodity('C')) + ledger.balance('to', elementCommodity('H'))).toBe(grams(50));
    expect(ledger.audit().ok).toBe(true);
  });

  it('caps the move at whatever mass is actually available, never inventing more', () => {
    const ledger = freshLedger();
    ledger.post({
      process: 'test:seed',
      entries: [
        { account: 'genesis', commodity: elementCommodity('C'), delta: -grams(10) },
        { account: 'from', commodity: elementCommodity('C'), delta: grams(10) },
      ],
    });

    const moved = moveElementalMassUpTo(ledger, 'from', 'to', grams(50), 'test:move');

    expect(moved).toBe(grams(10));
    expect(ledger.balance('from', elementCommodity('C'))).toBe(0n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('is a no-op, not a throw, when nothing is present to move', () => {
    const ledger = freshLedger();
    const moved = moveElementalMassUpTo(ledger, 'from', 'to', grams(50), 'test:move');
    expect(moved).toBe(0n);
    expect(ledger.audit().ok).toBe(true);
  });
});

describe('MachineRig', () => {
  it('refuses a running mode before commissioning, and accepts it after', () => {
    const rig = createMixerRig(1);
    expect(rig.requestMode('MANUAL').ok).toBe(false);
    rig.machine.commission();
    expect(rig.requestMode('MANUAL').ok).toBe(true);
    expect(rig.machine.running).toBe(true);
  });

  it('sets a real setpoint tag and refuses to set a measurement tag or an unknown tag', () => {
    const rig = createOvenRig(1);
    expect(rig.setSetpoint('bake-temp-setpoint-c', 200).ok).toBe(true);
    expect(rig.machine.getTag('bake-temp-setpoint-c')).toBe(200);

    const measurementResult = rig.setSetpoint('bake-temp-c', 999);
    expect(measurementResult.ok).toBe(false);

    const unknownResult = rig.setSetpoint('no-such-tag', 1);
    expect(unknownResult.ok).toBe(false);
  });

  it('refuses acknowledgeAlarm and resetAlarm for an unknown alarm id', () => {
    const rig = createMixerRig(1);
    expect(rig.acknowledgeAlarm('no-such-alarm').ok).toBe(false);
    expect(rig.resetAlarm('no-such-alarm').ok).toBe(false);
  });

  it('raises, acknowledges and clears a non-latching alarm as its condition comes and goes', () => {
    const rig = createMixerRig(1);
    rig.advance(1, 1 / 3600, 1, new Map([['hopper-low', true]]));
    const raised = rig.alarms.find((a) => a.id === 'hopper-low');
    expect(raised?.state).toBe('active-unacknowledged');

    expect(rig.acknowledgeAlarm('hopper-low').ok).toBe(true);
    // condition still active: a non-latching alarm stays acknowledged, not normal.
    rig.advance(2, 1 / 3600, 1, new Map([['hopper-low', true]]));
    expect(rig.alarms.find((a) => a.id === 'hopper-low')?.state).toBe('active-acknowledged');

    // condition gone: a non-latching, already-acknowledged alarm returns to normal on its own.
    rig.advance(3, 1 / 3600, 1, new Map([['hopper-low', false]]));
    expect(rig.alarms.find((a) => a.id === 'hopper-low')?.state).toBe('normal');
  });

  it('drives a condemned component through the full maintenance alarm cycle without ever getting stuck', () => {
    const rig = createOvenRig(1);
    // A single, deliberately huge `dtHours` deterministically condemns the
    // component immediately (wear clamps to 1, no rng branch is even
    // consulted) — see WearComponent.advance, which this is a direct,
    // legitimate caller of via MachineRig.advance.
    rig.machine.commission();
    rig.requestMode('MANUAL');
    const events = rig.advance(1, 1_000, 1, new Map([['over-temp', false]]));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('condemned');

    const maintenance = rig.alarms.find((a) => a.id === 'maintenance-due');
    expect(maintenance?.state).toBe('active-unacknowledged');
    expect(rig.machine.wear).toBe(1);

    // Acknowledging performs the service (see MachineRig.acknowledgeAlarm's
    // own doc comment for why it lives here and not in resetAlarm).
    expect(rig.acknowledgeAlarm('maintenance-due').ok).toBe(true);
    expect(rig.machine.wear).toBe(0);

    // The alarm only reaches 'cleared' on the *next* evaluation, once the
    // now-repaired condition reads false.
    rig.advance(2, 0, 1, new Map([['over-temp', false]]));
    expect(rig.alarms.find((a) => a.id === 'maintenance-due')?.state).toBe('cleared');

    expect(rig.resetAlarm('maintenance-due').ok).toBe(true);
    expect(rig.alarms.find((a) => a.id === 'maintenance-due')?.state).toBe('normal');
  });
});
