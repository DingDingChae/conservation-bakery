/**
 * The interactive world: everything the worker's message loop drives.
 *
 * Two things run on one shared `Ledger`:
 *
 * - `FirstChainScenario` (see `packages/sim/src/scenario/firstChain.ts`), the
 *   proven sunlight-to-shipped-cake chain, advanced one of its own steps per
 *   world tick, in the background — never skipped, never fast-forwarded.
 * - Two real, player-controllable `Machine`s (see `machines.ts`) that an
 *   operator actually drives: a mixing bowl and a deck oven, fed by
 *   `callSupplier` deliveries and moving material only through
 *   `moveElementalMassUpTo`.
 *
 * `SimWorld` is deliberately the only class in this package that mutates
 * anything — `worker.ts` is a thin message adapter around it, and `save.ts`
 * only ever rebuilds a fresh one and replays a command journal into it.
 */

import type {
  AccountId,
  Command as SimJournalCommand,
  Digestible,
  Entry,
  Ledger,
  RunRecord,
} from '@conservation-bakery/sim';
import {
  ENERGY,
  FirstChainScenario,
  Journal,
  Rng,
  WORLD_ACCOUNTS,
  cashCommodity,
  defaultSubstanceRegistry,
  digest as computeDigest,
  elementCommodity,
  isSpeed,
  joules,
  roundHalfEven,
} from '@conservation-bakery/sim';

import type {
  AlarmSnapshot,
  BalanceRow,
  Command,
  CommandResult,
  MachineSnapshot,
  ProvenanceNode,
  SpeedMultiplier,
  WorldSnapshot,
} from '../shared/ipc.js';
import { fromExact, toExact } from '../shared/ipc.js';

import type { DifficultyChangeRecord, DifficultyKnobs, DifficultySettings } from './difficulty.js';
import {
  breakdownHazardMultiplier,
  startingCashMinor,
  supplierCallsPermitted,
  supplierLeadTimeTicks,
  supplierPriceMinor,
  withKnobs,
} from './difficulty.js';
import type { MachineRig, SimCommandResult } from './machines.js';
import { createMixerRig, createOvenRig, moveElementalMassUpTo } from './machines.js';

export type { DifficultyChangeRecord };

// ---------------------------------------------------------------------------
// The plant's own accounts and constants. Everything here is a deliberate
// simplification of real oven/mixer physics (see the module doc comment on
// `machines.ts`) chosen so the control loop is genuinely real — modes,
// setpoints and alarms that do something, backed by a real balanced
// `Posting` for every conserved quantity that moves — without reproducing
// `bake/` and `plant/`'s full chemistry a second time.
// ---------------------------------------------------------------------------

const CASH_CURRENCY = 'USD';
export const PLANT_CASH_COMMODITY = cashCommodity(CASH_CURRENCY);
/** This module's own account ids, exported so tests (and any future save
 * inspector) can name them without duplicating the literal strings. */
export const PLANT_CASH: AccountId = 'plant.cash';
export const PLANT_RECEIVING: AccountId = 'plant.receiving';
export const PLANT_BATTER: AccountId = 'plant.batter';
export const PLANT_OUTPUT: AccountId = 'plant.output';
/** The plant's own operating line of credit — an external counterparty this
 * world opens for itself, exactly the way `WORLD_ACCOUNTS.marketSuppliers`
 * and friends already do: real, sourced, and free to go negative because it
 * is the auditable record of outside capital, not an escape hatch. */
export const MARKET_BANK: AccountId = 'market.bank';

const MIXER_MAX_RATE_G_PER_TICK = 80;
const OVEN_MAX_RATE_G_PER_TICK = 50;
const OVEN_BAKE_TOLERANCE_C = 5;
const OVEN_OVER_TEMP_MARGIN_C = 40;
const AMBIENT_TEMP_C = 20;
/** A deliberately simplified thermal mass: how much real energy (never
 * created, always drawn from `market.utilities` and dissipated to `space`,
 * exactly as `plant/creamery.ts`'s `pasteurize` already does) it costs the
 * oven to move its measured temperature by one degree. Not a real oven's
 * heat-transfer model — see `bake/oven.ts` for that — just enough to make
 * "the setpoint costs real energy" true. */
const ENERGY_PER_DEGREE_C = joules(20_000);

const PROVENANCE_MAX_DEPTH = 500;
const PROVENANCE_MAX_NODES = 5_000;

interface PendingDelivery {
  readonly substanceId: string;
  readonly massUg: bigint;
  readonly dueAtTick: number;
}

export interface SimWorldOptions {
  readonly seed: number;
  readonly startInstantMs: number;
  readonly difficulty: DifficultySettings;
}

function toIpcResult(result: SimCommandResult): CommandResult {
  return result.ok ? { accepted: true } : { accepted: false, reason: result.reason };
}

function refusedIpc(reason: string): CommandResult {
  return { accepted: false, reason };
}

/** Every element commodity currently held by `account`, summed. */
function accountElementalMass(ledger: Ledger, account: AccountId): bigint {
  let total = 0n;
  for (const [commodity, amount] of ledger.balances(account)) {
    if (commodity.startsWith('el:')) total += amount;
  }
  return total;
}

export class SimWorld {
  readonly seed: number;
  readonly startInstantMs: number;

  readonly #scenario: FirstChainScenario;
  readonly #registry = defaultSubstanceRegistry();
  readonly #mixer: MachineRig;
  readonly #oven: MachineRig;
  readonly #cashCommodity = cashCommodity(CASH_CURRENCY);
  readonly #journal: Journal;
  readonly #initialDifficulty: DifficultySettings;

  #difficulty: DifficultySettings;
  #difficultyChanges: DifficultyChangeRecord[] = [];
  #speed: SpeedMultiplier = 1;
  #tick = 0;
  #pendingDeliveries: PendingDelivery[] = [];

  constructor(options: SimWorldOptions) {
    this.seed = options.seed;
    this.startInstantMs = options.startInstantMs;
    this.#difficulty = options.difficulty;
    this.#initialDifficulty = options.difficulty;
    this.#journal = new Journal({ seed: options.seed, startInstantMs: options.startInstantMs });

    this.#scenario = new FirstChainScenario({ seed: options.seed });
    const ledger = this.#scenario.ledger;

    for (const [id, kind] of [
      [PLANT_CASH, 'stock'],
      [PLANT_RECEIVING, 'stock'],
      [PLANT_BATTER, 'stock'],
      [PLANT_OUTPUT, 'stock'],
      [MARKET_BANK, 'external'],
    ] as const) {
      ledger.openAccount({ id, kind, label: id });
    }

    const opening = startingCashMinor(this.#difficulty.knobs);
    if (opening > 0n) {
      ledger.post({
        process: 'genesis:plant-capital',
        entries: [
          { account: PLANT_CASH, commodity: this.#cashCommodity, delta: opening },
          { account: MARKET_BANK, commodity: this.#cashCommodity, delta: -opening },
        ],
      });
    }

    const rng = Rng.fromSeed(options.seed);
    this.#mixer = createMixerRig(rng.nextUint32());
    this.#oven = createOvenRig(rng.nextUint32());
    this.#mixer.machine.commission();
    this.#oven.machine.commission();

    // This *is* the scenario's own first step (see firstChain.ts: nothing
    // yields until after `seedWorld` has opened and sealed every planetary
    // account), run here rather than deferred so a command sent before the
    // first `step()` still finds a real market to deal with.
    this.#scenario.tick();
  }

  get tick(): number {
    return this.#tick;
  }

  get speed(): SpeedMultiplier {
    return this.#speed;
  }

  get difficulty(): DifficultySettings {
    return this.#difficulty;
  }

  get initialDifficulty(): DifficultySettings {
    return this.#initialDifficulty;
  }

  get difficultyChanges(): readonly DifficultyChangeRecord[] {
    return this.#difficultyChanges;
  }

  /** Exposed for tests and for `save.ts`'s replay loop only — nothing else
   * should reach past this class into ledger internals. */
  get ledger(): Ledger {
    return this.#scenario.ledger;
  }

  journalRecord(): RunRecord {
    return this.#journal.toRecord();
  }

  /**
   * Difficulty may change mid-run (see `difficulty.ts`). There is, as yet, no
   * `Command` in `shared/ipc.ts` that reaches this from the renderer — that
   * is a gap in the shared contract, not in this method — but the world
   * itself already supports it, is replay-safe (`save.ts` records every
   * change by tick) and can never let a knob move mass, energy or money on
   * its own; only the numbers `applyCommand` later multiplies by.
   */
  setDifficulty(patch: Partial<DifficultyKnobs>): DifficultySettings {
    this.#difficulty = withKnobs(this.#difficulty, patch);
    this.#difficultyChanges.push({ tick: this.#tick, knobs: this.#difficulty.knobs });
    return this.#difficulty;
  }

  /**
   * Advance by exactly one fixed simulated second. Always runs the
   * background scenario and both machines in full — the caller (`worker.ts`)
   * decides *how many* of these to run per real second from `speed`, never
   * whether a given one runs partially or is skipped.
   */
  step(): void {
    this.#tick += 1;
    const ledger = this.#scenario.ledger;
    ledger.setTick(this.#tick);

    if (!this.#scenario.done) this.#scenario.tick();

    this.#releaseDeliveries();
    this.#advanceMixer();
    this.#advanceOven();

    // A conservation failure is not recoverable — see CONTRACT.md rule 1 and
    // `simulationHost.ts`'s fault contract. This throws, and `worker.ts`
    // posts a fault and stops rather than continuing to advance a world
    // whose books no longer close.
    ledger.assertBalanced(`world tick ${this.#tick}`);
  }

  applyCommand(command: Command): CommandResult {
    const result = this.#dispatch(command);
    if (result.accepted) {
      this.#journal.append({ type: command.kind, tick: this.#tick, payload: command } as SimJournalCommand);
    }
    return result;
  }

  snapshot(): WorldSnapshot {
    const ledger = this.#scenario.ledger;
    return {
      tick: this.#tick,
      simulatedTime: new Date(this.startInstantMs + this.#tick * 1000).toISOString(),
      speed: this.#speed,
      machines: [this.#machineSnapshot(this.#mixer), this.#machineSnapshot(this.#oven)],
      balance: this.#balanceRows(ledger),
      balanceOk: ledger.audit().ok,
      digest: this.digest(),
    };
  }

  provenance(lotId: string): ProvenanceNode {
    return this.#buildProvenanceNode(lotId, 0, { budget: PROVENANCE_MAX_NODES });
  }

  /** A stable digest of every part of the world's state that can differ
   * between two runs — including the plant machines and pending deliveries,
   * which `packages/sim`'s own `digestFirstChainState` knows nothing about.
   * Pure function of world state, never of wall-clock time: identical after
   * the same number of `step()` calls regardless of how many snapshots were
   * published along the way. */
  digest(): string {
    const ledger = this.#scenario.ledger;
    const accounts = new Map<string, Digestible>();
    for (const accountId of ledger.accountIds()) {
      const balances = ledger.balances(accountId);
      if (balances.size === 0) continue;
      const perCommodity = new Map<string, Digestible>();
      for (const [commodity, amount] of balances) perCommodity.set(commodity, amount);
      accounts.set(accountId, perCommodity);
    }

    const machines: Digestible = [this.#mixer, this.#oven].map((rig) => ({
      id: rig.id,
      mode: rig.machine.mode,
      runHours: rig.machine.runHours,
      serviceDueInHours: rig.machine.maintenanceDueInHours,
      tags: rig.tagViews().map((tag) => ({ id: tag.id, value: tag.value })),
      alarms: rig.alarms.map((alarm) => ({ id: alarm.id, state: alarm.state })),
    }));

    const deliveries: Digestible = this.#pendingDeliveries.map((delivery) => ({
      substanceId: delivery.substanceId,
      massUg: delivery.massUg,
      dueAtTick: delivery.dueAtTick,
    }));

    return computeDigest({
      tick: this.#tick,
      speed: this.#speed,
      accounts,
      machines,
      deliveries,
      postingCount: ledger.postingCount,
    });
  }

  // -------------------------------------------------------------------
  // Command dispatch.
  // -------------------------------------------------------------------

  #dispatch(command: Command): CommandResult {
    switch (command.kind) {
      case 'setSpeed': {
        if (!isSpeed(command.speed)) return refusedIpc(`${command.speed} is not a legal speed`);
        this.#speed = command.speed;
        return { accepted: true };
      }
      case 'setMode': {
        const rig = this.#rig(command.machineId);
        if (!rig) return refusedIpc(`unknown machine "${command.machineId}"`);
        return toIpcResult(rig.requestMode(command.mode));
      }
      case 'setSetpoint': {
        const rig = this.#rig(command.machineId);
        if (!rig) return refusedIpc(`unknown machine "${command.machineId}"`);
        return toIpcResult(rig.setSetpoint(command.tagId, command.value));
      }
      case 'acknowledgeAlarm': {
        const rig = this.#rig(command.machineId);
        if (!rig) return refusedIpc(`unknown machine "${command.machineId}"`);
        return toIpcResult(rig.acknowledgeAlarm(command.alarmId));
      }
      case 'resetAlarm': {
        const rig = this.#rig(command.machineId);
        if (!rig) return refusedIpc(`unknown machine "${command.machineId}"`);
        return toIpcResult(rig.resetAlarm(command.alarmId));
      }
      case 'callSupplier':
        return this.#callSupplier(command.substanceId, command.massUg);
    }
  }

  #rig(machineId: string): MachineRig | undefined {
    if (machineId === this.#mixer.id) return this.#mixer;
    if (machineId === this.#oven.id) return this.#oven;
    return undefined;
  }

  #callSupplier(substanceId: string, massUgExact: string): CommandResult {
    const knobs = this.#difficulty.knobs;
    if (!supplierCallsPermitted(knobs)) {
      return refusedIpc('call-a-supplier is not available at this difficulty');
    }
    const ledger = this.#scenario.ledger;
    if (!ledger.hasAccount(WORLD_ACCOUNTS.marketSuppliers)) {
      return refusedIpc('the market has not opened yet');
    }
    if (!this.#registry.has(substanceId)) {
      return refusedIpc(`unknown substance "${substanceId}"`);
    }

    let massUg: bigint;
    try {
      massUg = fromExact(massUgExact);
    } catch {
      return refusedIpc(`"${massUgExact}" is not a valid exact mass`);
    }
    if (massUg <= 0n) return refusedIpc('delivery mass must be greater than zero');

    const cost = supplierPriceMinor(substanceId, massUg, knobs);
    const cashOnHand = ledger.balance(PLANT_CASH, this.#cashCommodity);
    if (cashOnHand < cost) {
      return refusedIpc(
        `insufficient funds: this delivery costs ${cost.toString()} and the plant holds ${cashOnHand.toString()}`,
      );
    }

    ledger.post({
      process: `market:call-supplier:charge:${substanceId}`,
      entries: [
        { account: PLANT_CASH, commodity: this.#cashCommodity, delta: -cost },
        { account: WORLD_ACCOUNTS.marketSuppliers, commodity: this.#cashCommodity, delta: cost },
      ],
    });

    const leadTimeTicks = supplierLeadTimeTicks(knobs);
    this.#pendingDeliveries.push({ substanceId, massUg, dueAtTick: this.#tick + leadTimeTicks });
    return { accepted: true };
  }

  // -------------------------------------------------------------------
  // Per-tick physics. See the constants above for what is, and is
  // deliberately not, modelled here.
  // -------------------------------------------------------------------

  #releaseDeliveries(): void {
    if (this.#pendingDeliveries.length === 0) return;
    const due = this.#pendingDeliveries.filter((delivery) => delivery.dueAtTick <= this.#tick);
    if (due.length === 0) return;
    this.#pendingDeliveries = this.#pendingDeliveries.filter((delivery) => delivery.dueAtTick > this.#tick);

    const ledger = this.#scenario.ledger;
    for (const delivery of due) {
      const composition = this.#registry.getComposition(delivery.substanceId, delivery.massUg);
      const entries: Entry[] = [];
      for (const [element, amount] of composition) {
        if (amount === 0n) continue;
        entries.push({ account: PLANT_RECEIVING, commodity: elementCommodity(element), delta: amount });
        entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity(element), delta: -amount });
      }
      if (entries.length > 0) {
        ledger.post({ process: `market:call-supplier:deliver:${delivery.substanceId}`, entries });
      }
    }
  }

  #advanceMixer(): void {
    const ledger = this.#scenario.ledger;
    const running = this.#mixer.machine.running;

    if (running) {
      const rpm = this.#mixer.machine.getTag('mix-speed-rpm');
      const maxMassUg = BigInt(Math.round((rpm / 200) * MIXER_MAX_RATE_G_PER_TICK * 1_000_000));
      moveElementalMassUpTo(ledger, PLANT_RECEIVING, PLANT_BATTER, maxMassUg, 'plant:mixer:transfer');
    }

    const batterMassUg = accountElementalMass(ledger, PLANT_BATTER);
    this.#mixer.machine.setTag('batch-mass-kg', Number(batterMassUg) / 1_000_000_000);

    const hopperEmpty = accountElementalMass(ledger, PLANT_RECEIVING) <= 0n;
    const hazard = breakdownHazardMultiplier(this.#difficulty.knobs);
    this.#mixer.advance(this.#tick, 1 / 3600, hazard, new Map([['hopper-low', running && hopperEmpty]]));
  }

  #advanceOven(): void {
    const ledger = this.#scenario.ledger;
    const running = this.#oven.machine.running;
    const setpoint = this.#oven.machine.getTag('bake-temp-setpoint-c');
    let temp = this.#oven.machine.getTag('bake-temp-c');

    if (running) {
      const nextTemp = temp + (setpoint - temp) * 0.05;
      const deltaC = Math.abs(nextTemp - temp);
      if (deltaC > 0) {
        const energyUj = roundHalfEven(deltaC * Number(ENERGY_PER_DEGREE_C));
        if (energyUj > 0n) {
          ledger.post({
            process: 'plant:oven:heat',
            entries: [
              { account: WORLD_ACCOUNTS.marketUtilities, commodity: ENERGY, delta: -energyUj },
              { account: WORLD_ACCOUNTS.space, commodity: ENERGY, delta: energyUj },
            ],
          });
        }
      }
      temp = nextTemp;

      if (temp >= setpoint - OVEN_BAKE_TOLERANCE_C) {
        const maxMassUg = BigInt(OVEN_MAX_RATE_G_PER_TICK * 1_000_000);
        moveElementalMassUpTo(ledger, PLANT_BATTER, PLANT_OUTPUT, maxMassUg, 'plant:oven:bake');
      }
    } else {
      temp += (AMBIENT_TEMP_C - temp) * 0.02;
    }
    this.#oven.machine.setTag('bake-temp-c', temp);

    const overTemp = temp > setpoint + OVEN_OVER_TEMP_MARGIN_C;
    const hazard = breakdownHazardMultiplier(this.#difficulty.knobs);
    this.#oven.advance(this.#tick, 1 / 3600, hazard, new Map([['over-temp', overTemp]]));
  }

  // -------------------------------------------------------------------
  // Snapshot / provenance building. Pure reads — never a `Ledger` mutation.
  // -------------------------------------------------------------------

  #machineSnapshot(rig: MachineRig): MachineSnapshot {
    const alarms: readonly AlarmSnapshot[] = rig.alarms.map((alarm) => ({
      id: alarm.id,
      label: alarm.definition.label,
      state: alarm.state,
      priority: alarm.priority,
      firstOut: alarm.isFirstOut,
      raisedAtTick: alarm.trippedAtTick ?? 0,
    }));
    return {
      id: rig.id,
      label: rig.label,
      mode: rig.machine.mode,
      commissioned: rig.machine.commissioned,
      running: rig.machine.running,
      runHours: rig.machine.runHours,
      serviceDueInHours: rig.machine.maintenanceDueInHours,
      tags: rig.tagViews(),
      alarms,
    };
  }

  #balanceRows(ledger: Ledger): readonly BalanceRow[] {
    const sums = new Map<string, bigint>();
    for (const accountId of ledger.accountIds()) {
      for (const [commodity, amount] of ledger.balances(accountId)) {
        sums.set(commodity, (sums.get(commodity) ?? 0n) + amount);
      }
    }
    return [...sums.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([commodity, residual]) => ({ commodity, residual: toExact(residual) }));
  }

  #buildProvenanceNode(lotId: string, depth: number, ctx: { budget: number }): ProvenanceNode {
    const lot = this.#scenario.graph.getLot(lotId);
    if (!lot) throw new Error(`unknown lot "${lotId}"`);

    if (depth >= PROVENANCE_MAX_DEPTH || ctx.budget <= 0) {
      return {
        lotId: lot.id,
        substanceId: lot.substance,
        label: lot.substance,
        mass: toExact(lot.mass),
        tick: lot.tick,
        process: lot.process,
        children: [],
        truncated: true,
      };
    }
    ctx.budget -= 1;

    const children = lot.parents.map((parent) => this.#buildProvenanceNode(parent.lotId, depth + 1, ctx));
    return {
      lotId: lot.id,
      substanceId: lot.substance,
      label: lot.substance,
      mass: toExact(lot.mass),
      tick: lot.tick,
      process: lot.process,
      children,
    };
  }
}
