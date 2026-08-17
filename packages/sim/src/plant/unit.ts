/**
 * The shared unit-operation abstraction.
 *
 * Every machine in `plant/` (mill, creamery, refinery) turns one or more exact
 * input parcels into one or more exact output parcels plus declared losses. This
 * module is the one place that guarantee is written: `buildProcessPosting` will
 * not hand back a `Posting` unless every commodity it touches — every tracked
 * element and energy itself — sums to exactly zero across inputs, outputs and
 * losses. A process that over- or under-declares an output is rejected here,
 * with a message naming exactly which commodity and by how much, before it ever
 * reaches `Ledger.post` (which would also reject it, but with less context about
 * which declared stream is responsible). See CONTRACT.md rule 1.
 *
 * `splitByProfile` is the other piece every unit operation shares: the technique
 * (borrowed from `world/accounts.ts`'s `splitMolecule`/`splitByShare`) of using
 * `partition()` to divide an *exact* input composition across several output
 * streams by relative concentration, so the split is correct by construction —
 * the streams' compositions always sum back to the input exactly, never merely
 * approximately, regardless of how the concentration ratios fall.
 */

import type { CommodityId, Composition, Element, Micrograms, Microjoules } from '../core/commodity.js';
import { ENERGY, compositionMass, elementCommodity, partition } from '../core/commodity.js';
import type { AccountId, Entry, Posting } from '../core/ledger.js';
import type { Interlock } from '../process/interlock.js';
import { evaluateInterlocks } from '../process/interlock.js';
import { Machine, type MachineDefinition } from '../process/machine.js';
import type { CommandResult } from '../process/result.js';
import { refused } from '../process/result.js';
import type { LotCreationSpec } from '../provenance/lot.js';
import { encodeLotCreations } from '../provenance/lot.js';

/** An exact movement of elemental mass into or out of one account. */
export interface ProcessFlow {
  readonly account: AccountId;
  readonly composition: Composition;
}

/** An exact movement of energy into or out of one account. */
export interface EnergyFlow {
  readonly account: AccountId;
  readonly amount: Microjoules;
}

/**
 * Provenance metadata for a process step: the lots it creates, in the shape
 * `provenance/lot.ts` already defines (`LotCreationSpec` names each output's
 * parents and declared losses by mass). Optional — a step that does not care
 * about lot ancestry (a pure energy transfer, a test fixture) simply omits it,
 * and no lot is recorded.
 */
export interface LotDeclaration {
  readonly outputs: readonly LotCreationSpec[];
}

/**
 * One unit operation's declared material and energy balance. `inputs` are
 * consumed from their accounts; `outputs` and `losses` are both credited to
 * theirs — the only difference between the two is which account a loss lands
 * in (typically a reservoir like the atmosphere) and how it reads in
 * diagnostics. Both count identically toward the balance check.
 */
export interface ProcessStep {
  /** Which unit operation is responsible. Used verbatim in diagnostics. */
  readonly process: string;
  readonly inputs: readonly ProcessFlow[];
  readonly outputs: readonly ProcessFlow[];
  readonly losses?: readonly ProcessFlow[];
  readonly energyInputs?: readonly EnergyFlow[];
  readonly energyOutputs?: readonly EnergyFlow[];
  readonly lots?: LotDeclaration;
  /**
   * Free-text diagnostic, exactly like `Posting.note`. Ignored if `lots` is
   * given, because `Posting.note` is also where lot creations are encoded (see
   * `provenance/lot.ts`) and a step cannot carry both.
   */
  readonly note?: string;
}

/**
 * Thrown by `buildProcessPosting` when a step's declared outputs and losses do
 * not reconcile with its declared inputs, for at least one commodity. This is
 * the structural guarantee this file exists to provide: it is not possible to
 * obtain a `Posting` from a `ProcessStep` whose books do not already close.
 */
export class UnbalancedProcessError extends Error {
  constructor(
    readonly process: string,
    readonly commodity: CommodityId,
    readonly totalIn: bigint,
    readonly totalOut: bigint,
  ) {
    const over = totalOut > totalIn;
    const residual = over ? totalOut - totalIn : totalIn - totalOut;
    super(
      `process "${process}" declared outputs that do not reconcile with its inputs: ` +
        `commodity ${commodity} has ${totalIn} in but ${totalOut} out ` +
        `(${over ? 'over' : 'under'}-declared by ${residual}). ` +
        `Nothing comes from nothing — see CONTRACT.md rule 1.`,
    );
    this.name = 'UnbalancedProcessError';
  }
}

function addComposition(
  totals: Map<CommodityId, bigint>,
  flows: readonly ProcessFlow[],
): void {
  for (const flow of flows) {
    for (const [element, amount] of flow.composition) {
      if (amount === 0n) continue;
      const commodity = elementCommodity(element);
      totals.set(commodity, (totals.get(commodity) ?? 0n) + amount);
    }
  }
}

function addEnergy(totals: Map<CommodityId, bigint>, flows: readonly EnergyFlow[]): void {
  for (const flow of flows) {
    if (flow.amount === 0n) continue;
    totals.set(ENERGY, (totals.get(ENERGY) ?? 0n) + flow.amount);
  }
}

function pushCompositionEntries(
  entries: Entry[],
  flows: readonly ProcessFlow[],
  sign: 1n | -1n,
): void {
  for (const flow of flows) {
    for (const [element, amount] of flow.composition) {
      if (amount === 0n) continue;
      entries.push({ account: flow.account, commodity: elementCommodity(element), delta: amount * sign });
    }
  }
}

function pushEnergyEntries(entries: Entry[], flows: readonly EnergyFlow[], sign: 1n | -1n): void {
  for (const flow of flows) {
    if (flow.amount === 0n) continue;
    entries.push({ account: flow.account, commodity: ENERGY, delta: flow.amount * sign });
  }
}

/**
 * Build the one balanced `Posting` a unit operation emits, or throw
 * `UnbalancedProcessError`. This function only builds — exactly like
 * `world/exchange.ts`'s reaction builders, it never touches a `Ledger` — so a
 * unit operation's arithmetic is testable without a live ledger, and the caller
 * decides when (or whether) to `ledger.post()` the result.
 */
export function buildProcessPosting(step: ProcessStep): Posting {
  const losses = step.losses ?? [];
  const energyInputs = step.energyInputs ?? [];
  const energyOutputs = step.energyOutputs ?? [];

  const totalIn = new Map<CommodityId, bigint>();
  addComposition(totalIn, step.inputs);
  addEnergy(totalIn, energyInputs);

  const totalOut = new Map<CommodityId, bigint>();
  addComposition(totalOut, step.outputs);
  addComposition(totalOut, losses);
  addEnergy(totalOut, energyOutputs);

  // Deterministic order: insertion order of totalIn first (the order inputs and
  // energyInputs were declared), then any commodity that only appears on the
  // output side. Map iteration is insertion-ordered in JS, so this is stable.
  const commodities = new Set<CommodityId>([...totalIn.keys(), ...totalOut.keys()]);
  for (const commodity of commodities) {
    const inAmount = totalIn.get(commodity) ?? 0n;
    const outAmount = totalOut.get(commodity) ?? 0n;
    if (inAmount !== outAmount) {
      throw new UnbalancedProcessError(step.process, commodity, inAmount, outAmount);
    }
  }

  const entries: Entry[] = [];
  pushCompositionEntries(entries, step.inputs, -1n);
  pushCompositionEntries(entries, step.outputs, 1n);
  pushCompositionEntries(entries, losses, 1n);
  pushEnergyEntries(entries, energyInputs, -1n);
  pushEnergyEntries(entries, energyOutputs, 1n);

  const note = step.lots ? encodeLotCreations(step.lots.outputs) : step.note;
  return note === undefined
    ? { process: step.process, entries }
    : { process: step.process, entries, note };
}

/**
 * A weighting profile for one stream of a `splitByProfile` split: how strongly
 * this stream pulls each element, and its target share of the total relative to
 * the other streams in the same call. `elements` is typically a
 * `SubstanceRecord.elements` table (micrograms per kilogram) straight from the
 * registry, but any non-negative per-element weighting is legal — see mill.ts
 * for a stream that is given a substance's *own* profile because no dedicated
 * registry entry exists for what remains after the named streams are removed.
 */
export interface StreamProfile {
  /** Identifies this stream in diagnostics only. */
  readonly id: string;
  readonly elements: Readonly<Partial<Record<Element, number>>>;
  /**
   * Relative target mass share among the streams passed to one `splitByProfile`
   * call. Only the ratio between streams matters — they need not sum to 1 — but
   * choosing values that do sum to 1 keeps each stream's actual yield close to
   * its intended share.
   */
  readonly targetShare: number;
}

/** Fixed-point precision for turning a real (share x concentration) weight into
 * an integer `partition()` weight. Only the *ratio* between streams for a given
 * element matters, so this only needs to be precise enough that two streams
 * with a meaningfully different pull are never rounded to the same weight. */
const WEIGHT_PRECISION = 1_000_000;

function streamWeight(stream: StreamProfile, element: Element): bigint {
  const perKg = stream.elements[element] ?? 0;
  if (perKg === 0 || stream.targetShare <= 0) return 0n;
  return BigInt(Math.round(stream.targetShare * perKg * WEIGHT_PRECISION));
}

/**
 * Split an exact input composition across `streams`, in the mass ratio each
 * stream's profile implies for every element, with the whole input accounted
 * for. This is `world/accounts.ts`'s `splitMolecule` technique generalised from
 * "atoms of a formula" to "elemental concentration profiles of a set of
 * candidate output substances": the *ratio* of pull between streams is real
 * arithmetic, `partition()` then assigns every microgram of the exact input to
 * a stream using that ratio as weights, so the returned compositions always sum
 * to exactly the input, element by element, regardless of how unevenly the
 * profiles diverge.
 *
 * Throws if some element present in `input` has zero weight across every
 * stream — there is nowhere for that element to go, which is a genuine
 * modelling gap in the caller's chosen profiles, not something this function
 * can paper over.
 */
export function splitByProfile(
  input: Composition,
  streams: readonly StreamProfile[],
): Composition[] {
  if (streams.length === 0) {
    if (compositionMass(input) !== 0n) {
      throw new RangeError('cannot split a non-empty composition across zero streams');
    }
    return [];
  }

  const results: Map<Element, Micrograms>[] = streams.map(() => new Map());

  for (const [element, amount] of input) {
    if (amount === 0n) continue;
    const weights = streams.map((stream) => streamWeight(stream, element));

    let shares: bigint[];
    try {
      shares = partition(amount, weights);
    } catch (error) {
      const streamIds = streams.map((s) => s.id).join(', ');
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `cannot split element "${element}" (${amount} ug) across streams [${streamIds}]: ` +
          `every stream has zero weight for it. ${reason}`,
      );
    }

    shares.forEach((share, index) => {
      if (share === 0n) return;
      results[index]!.set(element, share);
    });
  }

  return results;
}

/**
 * A unit operation's machine: the same `Machine` every other piece of equipment
 * in this simulation uses (modes, setpoints, interlocks, alarms, wear), plus
 * the interlocks that gate whether this unit may run a batch right now. `Machine`
 * itself already gates OFF/SERVICE from running and enforces commissioning; the
 * interlocks here add unit-specific equipment/product-integrity conditions (a
 * feed hopper interlock, a pasteurisation-hold interlock) on top of that.
 */
export interface ProcessUnitConfig {
  readonly id: string;
  readonly label: string;
  readonly definition: MachineDefinition;
  /** Built lazily against the machine, since a condition typically reads one of
   * the machine's own tags. */
  readonly interlocks?: (machine: Machine) => readonly Interlock[];
}

export class ProcessUnit {
  readonly machine: Machine;
  readonly #interlocks: readonly Interlock[];

  constructor(config: ProcessUnitConfig) {
    this.machine = new Machine(config.id, config.label, config.definition);
    this.#interlocks = config.interlocks ? config.interlocks(this.machine) : [];
  }

  /** Would a batch be accepted right now? Never mutates. */
  canRun(): CommandResult {
    if (!this.machine.running) {
      return refused(`"${this.machine.id}" is ${this.machine.mode}, not running`);
    }
    return evaluateInterlocks(this.#interlocks);
  }

  /**
   * Build the balanced posting for one batch. Throws if the machine cannot run
   * right now (wrong mode, or an interlock refuses) or if the step's own
   * declared balance does not reconcile (`UnbalancedProcessError`) — either way
   * a caller that wants to avoid the exception should check `canRun()` first.
   */
  buildBatch(step: ProcessStep): Posting {
    const gate = this.canRun();
    if (!gate.ok) {
      throw new Error(`"${this.machine.id}" refused batch "${step.process}": ${gate.reason}`);
    }
    return buildProcessPosting(step);
  }
}
