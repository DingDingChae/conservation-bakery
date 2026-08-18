/**
 * The interactive world: everything the worker's message loop drives.
 *
 * Two things run on one shared `Ledger`:
 *
 * - `FirstChainScenario` (see `packages/sim/src/scenario/firstChain.ts`), the
 *   proven sunlight-to-shipped-cake chain, advanced one of its own steps per
 *   world tick, in the background — never skipped, never fast-forwarded.
 * - The real, player-controllable `Plant` (see `plant.ts`): a flour mill, a
 *   creamery, a sugar refinery, a batter mixer, three differently-mechanised
 *   ovens, a cooling tunnel, a flow wrapper, a QA lab and a sales office,
 *   fed by `callSupplier` deliveries and moving material only through real
 *   `plant/`/`bake/`-exported physics or `moveElementalMassUpTo`.
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
  FirstChainScenario,
  Journal,
  Rng,
  WORLD_ACCOUNTS,
  cashCommodity,
  defaultSubstanceRegistry,
  digest as computeDigest,
  elementCommodity,
  isSpeed,
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

import type {
  DifficultyChangeRecord,
  DifficultyKnobs,
  DifficultyPresetName,
  DifficultySettings,
} from './difficulty.js';
import {
  DIFFICULTY_PRESETS,
  presetSettings,
  startingCashMinor,
  supplierCallsPermitted,
  supplierLeadTimeTicks,
  supplierPriceMinor,
  withKnobs,
} from './difficulty.js';
import type { MachineRig, SimCommandResult } from './machines.js';
import { Plant, deliveryAccountFor } from './plant.js';

export type { DifficultyChangeRecord };

// ---------------------------------------------------------------------------
// The plant's own top-level accounts. The equipment itself — mill, creamery,
// refinery, mixer, ovens, cooler, wrapper, QA lab, sales office — and every
// account it needs beyond these is built and opened by `Plant` (`plant.ts`).
// ---------------------------------------------------------------------------

const CASH_CURRENCY = 'USD';
export const PLANT_CASH_COMMODITY = cashCommodity(CASH_CURRENCY);
/** This module's own account ids, exported so tests (and any future save
 * inspector) can name them without duplicating the literal strings. */
export const PLANT_CASH: AccountId = 'plant.cash';
/** The generic receiving dock: any substance a `callSupplier` delivery names
 * that `plant.ts`'s `deliveryAccountFor` does not route to a dedicated
 * staging account (e.g. flour bought directly rather than milled on site, as
 * `world.spec.ts` still does) lands here, exactly as before this module grew
 * the bigger plant. */
export const PLANT_RECEIVING: AccountId = 'plant.receiving';
/** The plant's own operating line of credit — an external counterparty this
 * world opens for itself, exactly the way `WORLD_ACCOUNTS.marketSuppliers`
 * and friends already do: real, sourced, and free to go negative because it
 * is the auditable record of outside capital, not an escape hatch. */
export const MARKET_BANK: AccountId = 'market.bank';

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

export class SimWorld {
  readonly seed: number;
  readonly startInstantMs: number;

  readonly #scenario: FirstChainScenario;
  readonly #registry = defaultSubstanceRegistry();
  readonly #plant: Plant;
  readonly #cashCommodity = cashCommodity(CASH_CURRENCY);
  readonly #journal: Journal;
  readonly #initialDifficulty: DifficultySettings;

  #difficulty: DifficultySettings;
  #difficultyChanges: DifficultyChangeRecord[] = [];
  #speed: SpeedMultiplier = 1;
  #tick = 0;
  #pendingDeliveries: PendingDelivery[] = [];
  /**
   * A single monotonic counter shared by every accepted command and every
   * difficulty change, so `save.ts`'s `replay()` can recover the *real*
   * relative order two of them happened in when they land on the same tick
   * — without it, a command whose behaviour reads the current difficulty
   * (`callSupplier`'s price and lead time) would replay against whichever
   * knobs a same-tick difficulty change left behind, regardless of which one
   * actually happened first live. See `DifficultyChangeRecord.seq` and
   * `#commandSeqs` below.
   */
  #eventSeq = 0;
  /** `#commandSeqs[i]` is the `#eventSeq` value the *i*-th accepted command
   * in `#journal` was recorded at — a parallel array rather than a field on
   * the journal entry itself because `Journal`/`Command` are `packages/sim`'s
   * own types, not owned by this task. */
  #commandSeqs: number[] = [];

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

    // Every rig's wear stream draws from the same seeded sequence
    // (`rng.nextUint32()`), exactly as the two-machine plant this replaced
    // already did — deterministic and replay-safe, never `Math.random`. The
    // sales office's order arrivals get their own, independently seeded
    // stream so a difficulty or plant change cannot shift which orders
    // arrive by consuming a different number of wear seeds first.
    const rng = Rng.fromSeed(options.seed);
    const orderRng = Rng.fromSeed(rng.nextUint32());
    this.#plant = new Plant(ledger, { next: () => rng.nextUint32() }, orderRng);

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

  /** `save.ts`'s own parallel sequence array — see `#commandSeqs`'s doc
   * comment. Indices line up 1:1 with `journalRecord().commands`. */
  commandSequenceNumbers(): readonly number[] {
    return this.#commandSeqs;
  }

  /**
   * Difficulty may change mid-run (see `difficulty.ts`), via the
   * `setDifficulty` `Command` (see `#dispatch` below) or, for a test or an
   * internal caller, directly. Replay-safe (`save.ts` records every change
   * by tick and by `#eventSeq`) and can never let a knob move mass, energy
   * or money on its own; only the numbers `applyCommand` later multiplies by.
   */
  setDifficulty(patch: Partial<DifficultyKnobs>): DifficultySettings {
    this.#difficulty = withKnobs(this.#difficulty, patch);
    this.#difficultyChanges.push({ tick: this.#tick, knobs: this.#difficulty.knobs, seq: this.#eventSeq });
    this.#eventSeq += 1;
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
    this.#plant.advance(ledger, this.#tick, this.#difficulty.knobs);

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
      this.#commandSeqs.push(this.#eventSeq);
      this.#eventSeq += 1;
    }
    return result;
  }

  snapshot(): WorldSnapshot {
    const ledger = this.#scenario.ledger;
    return {
      tick: this.#tick,
      simulatedTime: new Date(this.startInstantMs + this.#tick * 1000).toISOString(),
      speed: this.#speed,
      machines: this.#plant.allRigs().map((rig) => this.#machineSnapshot(rig)),
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

    const machines: Digestible = this.#plant.allRigs().map((rig) => ({
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

    // `Plant`'s own state that is not already reachable by walking the
    // ledger's own accounts (moisture budgets mid-bake, the last QA reading,
    // the order queue) — see `plant.ts`'s `digestParts()`.
    const plant: Digestible = this.#plant.digestParts();

    return computeDigest({
      tick: this.#tick,
      speed: this.#speed,
      accounts,
      machines,
      deliveries,
      plant,
      postingCount: ledger.postingCount,
    });
  }

  // -------------------------------------------------------------------
  // Command dispatch.
  // -------------------------------------------------------------------

  // Checked against the preset table itself rather than a second hand-written list, so
  // adding a preset cannot leave a validator quietly out of date.
  static #isPreset(value: string): value is DifficultyPresetName {
    return Object.prototype.hasOwnProperty.call(DIFFICULTY_PRESETS, value);
  }

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
      case 'setDifficulty': {
        // A preset is a starting position, not a lock: a command may name a preset, a
        // set of knobs, or both, and knobs applied alongside a preset win. Difficulty
        // changes only prices, lead times, tolerances and help — never mass or energy —
        // so there is nothing here that could create a gram, whatever is asked for.
        if (command.preset !== undefined && !SimWorld.#isPreset(command.preset)) {
          return refusedIpc(`"${command.preset}" is not a difficulty preset`);
        }
        if (command.preset !== undefined) {
          this.#difficulty = presetSettings(command.preset);
        }
        if (command.knobs !== undefined) {
          for (const [name, value] of Object.entries(command.knobs)) {
            if (typeof value === 'number' && !Number.isFinite(value)) {
              return refusedIpc(`knob "${name}" must be a finite value`);
            }
          }
          this.setDifficulty(command.knobs as Partial<DifficultyKnobs>);
        }
        if (command.preset === undefined && command.knobs === undefined) {
          return refusedIpc('a difficulty change must name a preset, some knobs, or both');
        }
        return { accepted: true };
      }
    }
  }

  #rig(machineId: string): MachineRig | undefined {
    return this.#plant.rig(machineId);
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
      const destination = deliveryAccountFor(delivery.substanceId, PLANT_RECEIVING);
      const entries: Entry[] = [];
      for (const [element, amount] of composition) {
        if (amount === 0n) continue;
        entries.push({ account: destination, commodity: elementCommodity(element), delta: amount });
        entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity(element), delta: -amount });
      }
      if (entries.length > 0) {
        ledger.post({ process: `market:call-supplier:deliver:${delivery.substanceId}`, entries });
      }
    }
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
