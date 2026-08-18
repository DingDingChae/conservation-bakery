/**
 * Staff: workers as tracked individuals, with skills, shifts, rest and wages.
 *
 * Absence is modelled as scheduling and availability only — a worker is
 * either rostered onto a shift or not, resting between shifts as their
 * contract requires, or marked as an unscheduled absence for a shift they
 * were rostered onto. None of that is ever a medical event: see CONTRACT.md
 * rule 2, restated at the top of every file in this module that could
 * plausibly brush up against it.
 *
 * While on shift, a worker breathes the same tracked atmosphere every other
 * biological process in this simulation does, via `world/exchange.ts`'s own
 * `respire()` — the same function `agri/livestock.ts` uses for a cow or a
 * hen. Their metabolism is approximated as pure glucose oxidation, exactly
 * the same simplification the rest of this simulation already makes for crop
 * and livestock biomass; this file does not invent a second convention.
 */

import type { Micrograms } from '../core/commodity.js';
import { ENERGY, elementCommodity, roundHalfEven } from '../core/commodity.js';
import type { AccountId, AppliedPosting, Entry, Ledger, Posting } from '../core/ledger.js';
import { MOLAR_MASS, WORLD_ACCOUNTS, splitMolecule } from '../world/accounts.js';
import { respire } from '../world/exchange.js';

export type Skill = 'mixing' | 'oven' | 'packing' | 'quality' | 'maintenance';

export interface Worker {
  readonly id: string;
  readonly name: string;
  readonly skills: readonly Skill[];
  readonly hourlyWageMinorUnits: bigint;
}

export interface ShiftDefinition {
  readonly workerId: string;
  readonly startTick: number;
  /** Exclusive. */
  readonly endTick: number;
  /** Minimum gap, in hours, this worker needs before their next shift. */
  readonly restHoursRequired: number;
}

export type UnavailabilityReason = 'not-rostered' | 'rest-period-required' | 'unscheduled-absence';

export interface AvailabilityCheck {
  readonly available: boolean;
  readonly reason?: UnavailabilityReason;
}

export class UnknownWorkerError extends Error {
  constructor(readonly workerId: string) {
    super(`no worker "${workerId}" on this roster`);
    this.name = 'UnknownWorkerError';
  }
}

export class ShiftOverlapError extends Error {
  constructor(readonly workerId: string) {
    super(`a shift for worker "${workerId}" overlaps a shift already on the roster`);
    this.name = 'ShiftOverlapError';
  }
}

/**
 * A roster of workers and their shifts. Pure scheduling data — it never
 * touches a `Ledger` itself (see `staffRespiration` below for the one part of
 * this module that does, kept separate because it needs a real biomass/heat
 * account, not just a schedule).
 */
export class StaffRoster {
  readonly ticksPerHour: number;
  readonly #workers = new Map<string, Worker>();
  readonly #shifts: ShiftDefinition[] = [];
  readonly #absences = new Set<string>();

  constructor(ticksPerHour = 1) {
    if (!(ticksPerHour > 0)) throw new RangeError('ticksPerHour must be positive');
    this.ticksPerHour = ticksPerHour;
  }

  hire(worker: Worker): void {
    this.#workers.set(worker.id, worker);
  }

  worker(id: string): Worker | undefined {
    return this.#workers.get(id);
  }

  workers(): readonly Worker[] {
    return [...this.#workers.values()];
  }

  shiftsFor(workerId: string): readonly ShiftDefinition[] {
    return this.#shifts.filter((shift) => shift.workerId === workerId);
  }

  /** Roster a shift, refusing an overlap with any shift already on the
   * roster for the same worker. Does not itself check the rest-period rule —
   * two shifts can legally be adjacent with no rest between them scheduled;
   * `availability()` is what actually enforces the rest requirement at query
   * time, against whatever shift immediately preceded the tick in question. */
  scheduleShift(shift: ShiftDefinition): void {
    if (!this.#workers.has(shift.workerId)) throw new UnknownWorkerError(shift.workerId);
    for (const existing of this.shiftsFor(shift.workerId)) {
      const overlaps = shift.startTick < existing.endTick && existing.startTick < shift.endTick;
      if (overlaps) throw new ShiftOverlapError(shift.workerId);
    }
    this.#shifts.push(shift);
  }

  /** Mark a rostered shift as an unscheduled absence — the worker simply did
   * not report for a shift they were rostered onto. A scheduling fact only. */
  markAbsent(workerId: string, shiftStartTick: number): void {
    this.#absences.add(absenceKey(workerId, shiftStartTick));
  }

  /** Whether this worker is actually available to work at `tick`: rostered
   * onto a shift covering it, not marked absent for that shift, and not
   * still within the mandated rest period after their previous shift. */
  availability(workerId: string, tick: number): AvailabilityCheck {
    const shifts = this.shiftsFor(workerId);
    const current = shifts.find((shift) => tick >= shift.startTick && tick < shift.endTick);
    if (!current) return { available: false, reason: 'not-rostered' };
    if (this.#absences.has(absenceKey(workerId, current.startTick))) {
      return { available: false, reason: 'unscheduled-absence' };
    }

    const priorShifts = shifts.filter((shift) => shift.endTick <= tick);
    for (const prior of priorShifts) {
      const requiredTicks = Math.round(prior.restHoursRequired * this.ticksPerHour);
      if (tick - prior.endTick < requiredTicks) {
        return { available: false, reason: 'rest-period-required' };
      }
    }
    return { available: true };
  }

  /** Every rostered worker with `skill` who is actually available at `tick` —
   * what a production line would consult before assuming full staffing.
   * Absence simply shortens this list; this module does not itself decide
   * what a short-staffed tick means for any particular line. */
  availableWithSkill(tick: number, skill: Skill): readonly Worker[] {
    return this.workers().filter(
      (worker) => worker.skills.includes(skill) && this.availability(worker.id, tick).available,
    );
  }
}

function absenceKey(workerId: string, shiftStartTick: number): string {
  return `${workerId}:${shiftStartTick}`;
}

// ---------------------------------------------------------------------------
// Wages.
// ---------------------------------------------------------------------------

export function shiftHours(shift: ShiftDefinition, ticksPerHour: number): number {
  return (shift.endTick - shift.startTick) / ticksPerHour;
}

/** The exact cash amount owed for one shift, rounded once — the amount
 * `ledgerAccounts.ts`'s `payWages` should post. */
export function wagesOwedMinorUnits(worker: Worker, shift: ShiftDefinition, ticksPerHour: number): bigint {
  const hours = shiftHours(shift, ticksPerHour);
  return roundHalfEven(hours * Number(worker.hourlyWageMinorUnits));
}

// ---------------------------------------------------------------------------
// Respiration: staff breathe the tracked atmosphere while on shift.
// ---------------------------------------------------------------------------

/**
 * Typical metabolic power for light industrial / production-floor work:
 * roughly 2.5-3.5 MET, i.e. ~175-245 W for a representative 70 kg adult
 * (Ainsworth et al., 2011, "Compendium of Physical Activities"). This module
 * uses a single representative figure rather than tracking each worker's own
 * body mass (which this simulation does not model) — an explicit,
 * order-of-magnitude approximation, not a fitted physiological model.
 */
const WORKER_METABOLIC_POWER_W = 180;

const SECONDS_PER_HOUR = 3_600;
const UG_PER_G = 1_000_000;

const GLUCOSE_FORMULA = [
  { element: 'C', atoms: 6 },
  { element: 'H', atoms: 12 },
  { element: 'O', atoms: 6 },
] as const;

/** Matches `world/exchange.ts`'s own cited standard enthalpy of combustion for
 * glucose (~2,803 kJ/mol) — duplicated locally because that module does not
 * export its internal constants, the same reason `scenario/firstChain.ts`
 * keeps its own local copy. */
const GLUCOSE_COMBUSTION_J_PER_MOL = 2_803_000;
const GLUCOSE_MOLAR_MASS = 6 * MOLAR_MASS.C + 12 * MOLAR_MASS.H + 6 * MOLAR_MASS.O;

/** The glucose-equivalent mass a given headcount metabolises over `hours` of
 * work, from real metabolic power and real combustion energy — the input
 * `staffRespiration` hands to `respire()`. */
export function staffGlucoseEquivalentMass(workerCount: number, hours: number): Micrograms {
  if (workerCount <= 0 || hours <= 0) return 0n;
  const energyJ = WORKER_METABOLIC_POWER_W * hours * SECONDS_PER_HOUR * workerCount;
  const massG = energyJ / (GLUCOSE_COMBUSTION_J_PER_MOL / GLUCOSE_MOLAR_MASS);
  return roundHalfEven(massG * UG_PER_G);
}

export interface StaffRespirationParams {
  /** The account funding staff metabolism's glucose-equivalent mass and its
   * stored chemical energy — see `stockProvisions` below. */
  readonly provisionsAccount: AccountId;
  readonly atmosphereAccount?: AccountId;
  /** Where the released metabolic heat is credited — an `external` sink,
   * exactly like `agri/livestock.ts`'s `heatAccount`. */
  readonly heatAccount: AccountId;
  readonly workerCount: number;
  readonly hours: number;
  readonly process?: string;
}

/** Build (but do not post) the balanced respiration posting for a headcount
 * working a span of hours. Returns `undefined` if there is nothing to
 * respire (no workers, or no time), rather than a no-op posting. */
export function staffRespiration(params: StaffRespirationParams): Posting | undefined {
  const glucoseMass = staffGlucoseEquivalentMass(params.workerCount, params.hours);
  if (glucoseMass <= 0n) return undefined;
  return respire({
    biomassAccount: params.provisionsAccount,
    atmosphereAccount: params.atmosphereAccount ?? WORLD_ACCOUNTS.atmosphere,
    heatAccount: params.heatAccount,
    glucoseMass,
    process: params.process ?? 'econ:staff-respiration',
  });
}

export interface StockProvisionsParams {
  readonly account: AccountId;
  readonly massUg: Micrograms;
  readonly process?: string;
}

/**
 * Fund a provisions account with a real, sourced mass of glucose-equivalent
 * food energy and its stored chemical energy, delivered from
 * `market.suppliers` — the same pattern `agri/livestock.ts`'s `stockRation`
 * uses to fund an ongoing operational input from a real counterparty rather
 * than genesis. Applies the posting itself, for the same reason
 * `stockRation` does: a real delivery is a completed transaction, not a
 * draft a caller might choose not to apply.
 */
export function stockProvisions(ledger: Ledger, params: StockProvisionsParams): AppliedPosting {
  const composition = splitMolecule(params.massUg, GLUCOSE_FORMULA);
  const energyUg = roundHalfEven(
    Number(params.massUg) * (GLUCOSE_COMBUSTION_J_PER_MOL / GLUCOSE_MOLAR_MASS),
  );

  const entries: Entry[] = [];
  for (const [element, amount] of composition) {
    if (amount === 0n) continue;
    entries.push({ account: params.account, commodity: elementCommodity(element), delta: amount });
    entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity(element), delta: -amount });
  }
  if (energyUg > 0n) {
    entries.push({ account: params.account, commodity: ENERGY, delta: energyUg });
    entries.push({ account: WORLD_ACCOUNTS.marketSuppliers, commodity: ENERGY, delta: -energyUg });
  }

  return ledger.post({ process: params.process ?? 'econ:stock-provisions', entries });
}
