/**
 * The interactive plant: the two machines an operator actually drives.
 *
 * `packages/sim/src/scenario/firstChain.ts` proves the whole chain closes,
 * sunlight to shipped cake, but it runs as a fixed, non-interactive sequence
 * — the `Machine` instances it builds along the way never escape its own
 * generator scope. `world.ts` runs that scenario in the background for its
 * own sake (see that file), and separately builds these two: real, player-
 * controllable equipment on the *same* ledger, using the exact same
 * `Machine`/`Alarm`/`WearComponent` toolkit `packages/sim` already ships.
 *
 * Both machines move mass only through `moveElementalMassUpTo`, which is
 * itself only ever a `Ledger.post()` call — there is no path here that
 * credits an account without an equal, opposite debit.
 */

import type {
  AccountId,
  AlarmDefinition,
  CommandResult as SimCommandResult,
  ComponentDefinition,
  Entry,
  EquipmentEvent,
  Ledger,
  MachineDefinition,
  MachineMode,
} from '@conservation-bakery/sim';
import { Alarm, AlarmGroup, Machine, accepted, createSeededRng, partition, refused } from '@conservation-bakery/sim';

// `SimCommandResult` names the sim-side `{ok:true}` / `{ok:false,reason}`
// shape explicitly, distinct from `../shared/ipc.js`'s `CommandResult`
// (`{accepted, reason?}`) — every function in this module returns the former;
// `world.ts` adapts it to the latter at the process boundary.
export type { SimCommandResult };

/**
 * Move up to `maxMassUg` of whatever elemental mass `from` currently holds
 * into `to`, split across whatever elements are actually present using
 * `partition()` — so the parts always sum to exactly the mass moved,
 * regardless of how many different deliveries have been mixed together in
 * `from`. Returns the mass actually moved, which may be less than
 * `maxMassUg` (there may not be that much on hand) or zero.
 */
export function moveElementalMassUpTo(
  ledger: Ledger,
  from: AccountId,
  to: AccountId,
  maxMassUg: bigint,
  process: string,
): bigint {
  if (maxMassUg <= 0n) return 0n;

  const held: { readonly commodity: string; readonly amount: bigint }[] = [];
  let available = 0n;
  for (const [commodity, amount] of ledger.balances(from)) {
    if (amount <= 0n || !commodity.startsWith('el:')) continue;
    held.push({ commodity, amount });
    available += amount;
  }
  if (held.length === 0) return 0n;

  const moveMass = maxMassUg < available ? maxMassUg : available;
  if (moveMass <= 0n) return 0n;

  const shares = partition(
    moveMass,
    held.map((h) => h.amount),
  );
  const entries: Entry[] = [];
  held.forEach((h, index) => {
    const share = shares[index] ?? 0n;
    if (share === 0n) return;
    entries.push({ account: from, commodity: h.commodity as Entry['commodity'], delta: -share });
    entries.push({ account: to, commodity: h.commodity as Entry['commodity'], delta: share });
  });
  if (entries.length === 0) return 0n;

  ledger.post({ process, entries });
  return moveMass;
}

export interface TagView {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  /** Non-null only for a tag that *is* a setpoint. `world.ts` does not pair a
   * measurement tag with a companion setpoint tag — each `Machine` tag maps
   * to exactly one row, so a caller can tell unambiguously which id to send
   * back in a `setSetpoint` command. */
  readonly setpoint: number | null;
  readonly rangeLow: number;
  readonly rangeHigh: number;
}

const TAG_LABELS: Readonly<Record<string, string>> = {
  'mix-speed-rpm': 'Mix speed setpoint',
  'batch-mass-kg': 'Batter in bowl',
  'bake-temp-setpoint-c': 'Bake temperature setpoint',
  'bake-temp-c': 'Bake temperature',
};

export interface MachineRigOptions {
  readonly id: string;
  readonly label: string;
  /** Build a fresh `Machine` from this definition. Exactly one of `definition`
   * or `existingMachine` must be given. */
  readonly definition?: MachineDefinition;
  /**
   * Wrap an already-built `Machine` instead of constructing a new one — used
   * for the `plant/*` unit operations (`createMill`, `createCreamery`,
   * `createRefinery`), each of which already builds its own `Machine` from its
   * own `MachineDefinition` internally and exposes it as `ProcessUnit.machine`.
   * Wrapping that same instance (rather than building a second one) means
   * `MachineRig.advance`'s wear/alarm bookkeeping and the unit's own batch
   * operations (`millGrain`, `separateMilk`, ...) are always looking at the
   * identical machine state — there is only ever one `Machine` per real piece
   * of equipment, never two views that could drift apart.
   */
  readonly existingMachine?: Machine;
  readonly alarmDefinitions: readonly AlarmDefinition[];
  /** The one alarm in `alarmDefinitions` (if any) that a condemned wear
   * component trips, and that `resetAlarm` also performs maintenance against. */
  readonly maintenanceAlarmId?: string;
  readonly wearSeed: number;
}

/** One real, player-controllable machine: a `Machine`, its `AlarmGroup`, and
 * the seeded wear stream that drives its equipment events. See the module
 * doc comment for why this exists alongside, not instead of, `firstChain`. */
export class MachineRig {
  readonly id: string;
  readonly label: string;
  readonly machine: Machine;
  readonly #alarmGroup: AlarmGroup;
  readonly #wearRng: ReturnType<typeof createSeededRng>;
  readonly #maintenanceAlarmId: string | undefined;
  #maintenanceDue = false;

  constructor(options: MachineRigOptions) {
    this.id = options.id;
    this.label = options.label;
    if (options.existingMachine) {
      this.machine = options.existingMachine;
    } else {
      if (!options.definition) {
        throw new Error(`MachineRig "${options.id}" needs either a "definition" or an "existingMachine"`);
      }
      this.machine = new Machine(options.id, options.label, options.definition);
    }
    this.#alarmGroup = new AlarmGroup(options.alarmDefinitions.map((definition) => new Alarm(definition)));
    this.#wearRng = createSeededRng(options.wearSeed);
    this.#maintenanceAlarmId = options.maintenanceAlarmId;
  }

  get alarms(): readonly Alarm[] {
    return this.#alarmGroup.alarms();
  }

  requestMode(mode: MachineMode): SimCommandResult {
    return this.machine.requestMode(mode);
  }

  setSetpoint(tagId: string, value: number): SimCommandResult {
    let kind: 'measurement' | 'setpoint';
    try {
      kind = this.machine.tagDefinition(tagId).kind;
    } catch {
      return refused(`"${this.id}" has no tag "${tagId}"`);
    }
    if (kind !== 'setpoint') {
      return refused(`"${tagId}" on "${this.id}" is a measurement and cannot be set directly`);
    }
    this.machine.setTag(tagId, value);
    return accepted();
  }

  /**
   * Acknowledging the plant's one maintenance alarm is how an operator
   * records that the condemned component was actually serviced — there is
   * no separate "perform maintenance" command in the shared IPC contract, so
   * this is the one legitimate place that side effect belongs. It has to sit
   * here rather than in `resetAlarm`: a latching alarm only reaches
   * `'cleared'` (which `Alarm.reset()` requires) once its *condition* has
   * gone false on a later evaluation, so clearing the condition has to
   * happen at acknowledge time, not depend on a reset that cannot yet occur.
   */
  acknowledgeAlarm(alarmId: string): SimCommandResult {
    const alarm = this.#alarmGroup.alarms().find((a) => a.id === alarmId);
    if (!alarm) return refused(`"${this.id}" has no alarm "${alarmId}"`);
    const result = alarm.acknowledge();
    if (result.ok && alarmId === this.#maintenanceAlarmId && this.#maintenanceDue) {
      this.machine.performMaintenance();
      this.#maintenanceDue = false;
    }
    return result;
  }

  resetAlarm(alarmId: string): SimCommandResult {
    const alarm = this.#alarmGroup.alarms().find((a) => a.id === alarmId);
    if (!alarm) return refused(`"${this.id}" has no alarm "${alarmId}"`);
    return alarm.reset();
  }

  /**
   * Advance wear by one tick's worth of (difficulty-scaled) run hours and
   * re-evaluate every alarm this rig owns. `conditions` supplies every
   * non-maintenance alarm condition this tick; the maintenance condition (if
   * this rig has one) is added automatically from the wear stream.
   */
  advance(
    tick: number,
    dtHours: number,
    hazardMultiplier: number,
    conditions: ReadonlyMap<string, boolean>,
  ): readonly EquipmentEvent[] {
    // `Machine.advance` no-ops on its own when the machine is not running, so
    // this is always safe to call unconditionally.
    const events = this.machine.advance(dtHours * hazardMultiplier, 1, this.#wearRng);
    if (events.length > 0) this.#maintenanceDue = true;

    const fullConditions = new Map(conditions);
    if (this.#maintenanceAlarmId) fullConditions.set(this.#maintenanceAlarmId, this.#maintenanceDue);
    this.#alarmGroup.evaluate(fullConditions, tick);

    return events;
  }

  tagViews(): readonly TagView[] {
    return this.machine.tagNames().map((name) => {
      const definition = this.machine.tagDefinition(name);
      const value = this.machine.getTag(name);
      return {
        id: name,
        label: TAG_LABELS[name] ?? name,
        unit: definition.unit,
        value,
        setpoint: definition.kind === 'setpoint' ? value : null,
        rangeLow: definition.min,
        rangeHigh: definition.max,
      };
    });
  }
}

const MIXER_DEFINITION: MachineDefinition = {
  type: 'mixing-bowl',
  maintenanceIntervalHours: 400,
  tags: [
    { name: 'mix-speed-rpm', unit: 'rpm', kind: 'setpoint', min: 0, max: 200, initial: 60 },
    { name: 'batch-mass-kg', unit: 'kg', kind: 'measurement', min: 0, max: 2000, initial: 0 },
  ],
  components: [
    { kind: 'bearing', label: 'mixer bearing', wearRatePerHour: 0.0025, dutyExponent: 1.3 } satisfies ComponentDefinition,
  ],
};

const OVEN_DEFINITION: MachineDefinition = {
  type: 'deck-oven',
  maintenanceIntervalHours: 800,
  tags: [
    { name: 'bake-temp-setpoint-c', unit: 'C', kind: 'setpoint', min: 20, max: 260, initial: 180 },
    { name: 'bake-temp-c', unit: 'C', kind: 'measurement', min: 0, max: 300, initial: 20 },
  ],
  components: [
    { kind: 'heating-element', label: 'oven heating element', wearRatePerHour: 0.0018, dutyExponent: 1.5 } satisfies ComponentDefinition,
  ],
};

export const MIXER_ALARMS: readonly AlarmDefinition[] = [
  { id: 'hopper-low', label: 'Hopper low', priority: 3, latching: false },
  { id: 'maintenance-due', label: 'Bearing service due', priority: 2, latching: true },
];

export const OVEN_ALARMS: readonly AlarmDefinition[] = [
  { id: 'over-temp', label: 'Over-temperature', priority: 1, latching: true },
  { id: 'maintenance-due', label: 'Element service due', priority: 2, latching: true },
];

export function createMixerRig(wearSeed: number): MachineRig {
  return new MachineRig({
    id: 'mixer-1',
    label: 'Mixing bowl',
    definition: MIXER_DEFINITION,
    alarmDefinitions: MIXER_ALARMS,
    maintenanceAlarmId: 'maintenance-due',
    wearSeed,
  });
}

export function createOvenRig(wearSeed: number): MachineRig {
  return new MachineRig({
    id: 'oven-1',
    label: 'Deck oven',
    definition: OVEN_DEFINITION,
    alarmDefinitions: OVEN_ALARMS,
    maintenanceAlarmId: 'maintenance-due',
    wearSeed,
  });
}
