/**
 * The regulator: inspections against a HACCP plan and its temperature
 * record, findings, and enforcement that can stop a line.
 *
 * An inspection never touches material or the ledger — it only reads a
 * temperature log through `quality.ts`'s own conformance evaluation and
 * decides, deterministically from an injected seeded `Rng`, which readings
 * an inspector actually sampled and how strict this run's enforcement is.
 * Enforcement is advisory or strict by difficulty, exactly as CONTRACT.md
 * describes for Free Play, Easy, Realistic and Punishing — none of those
 * difficulties may create or destroy material, and this module never gives
 * any of them a reason to try; the only thing "difficulty" changes here is
 * how forgiving a finding is allowed to be.
 */

import type { Rng } from '../clock/rng.js';
import type { HaccpPlan, TemperatureLogEntry } from './quality.js';
import { evaluateTemperatureLog } from './quality.js';

export type Difficulty = 'free-play' | 'easy' | 'realistic' | 'punishing';

export interface InspectionFinding {
  readonly ccpId: string;
  readonly tick: number;
  readonly valueC: number;
  readonly description: string;
}

export interface InspectionResult {
  readonly tick: number;
  readonly sampledEntries: number;
  readonly findings: readonly InspectionFinding[];
  readonly passed: boolean;
  /** Enforcement: true when a finding was severe enough, under this
   * difficulty's rules, to stop the line until it is addressed. */
  readonly lineStopped: boolean;
}

/** Realistic and Punishing enforce findings by stopping the line; Free Play
 * and Easy report them advisory-only, matching CONTRACT.md's own description
 * of how difficulty may vary help and tolerance without ever bending rule 1
 * or rule 2. */
function enforcesLineStop(difficulty: Difficulty): boolean {
  return difficulty === 'realistic' || difficulty === 'punishing';
}

/** How much of the log a real inspection actually reviews — an inspector
 * samples the record, they do not re-check every single reading. Stricter
 * difficulties sample more of it, which is also the honest reason stricter
 * difficulties catch more real findings: they look harder, not because the
 * underlying process is modelled any differently. */
function inspectionSampleFraction(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'free-play':
      return 0.25;
    case 'easy':
      return 0.4;
    case 'realistic':
      return 0.7;
    case 'punishing':
      return 1;
  }
}

function sampleSize(difficulty: Difficulty, totalEntries: number): number {
  const fraction = inspectionSampleFraction(difficulty);
  return Math.min(totalEntries, Math.max(1, Math.round(totalEntries * fraction)));
}

/** Deterministically draw `count` distinct indices from `[0, total)`, in
 * ascending order, via a partial Fisher-Yates-style draw against `rng` — the
 * same seed and the same total/count always produce the same sample. */
function sampleIndices(rng: Rng, total: number, count: number): readonly number[] {
  const pool = Array.from({ length: total }, (_, index) => index);
  const picked: number[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const drawIndex = rng.nextInt(pool.length);
    const value = pool[drawIndex];
    if (value === undefined) continue;
    picked.push(value);
    pool.splice(drawIndex, 1);
  }
  return picked.sort((a, b) => a - b);
}

/**
 * Run one inspection at `tick`: sample the temperature log per this
 * difficulty's thoroughness, evaluate every sampled reading against the
 * plan's own limits, and decide whether any out-of-limit finding is severe
 * enough under this difficulty to stop the line. Deterministic in `rng`: the
 * exact same plan, log, difficulty, `rng` state and tick always produce the
 * exact same result.
 */
export function inspect(
  plan: HaccpPlan,
  log: readonly TemperatureLogEntry[],
  difficulty: Difficulty,
  rng: Rng,
  tick: number,
): InspectionResult {
  if (log.length === 0) {
    return { tick, sampledEntries: 0, findings: [], passed: true, lineStopped: false };
  }

  const count = sampleSize(difficulty, log.length);
  const indices = sampleIndices(rng, log.length, count);
  const sampledLog = indices.map((index) => log[index]).filter((entry): entry is TemperatureLogEntry => entry !== undefined);

  const findings: InspectionFinding[] = evaluateTemperatureLog(plan, sampledLog)
    .filter((evaluation) => !evaluation.withinLimit)
    .map((evaluation) => ({
      ccpId: evaluation.ccpId,
      tick: evaluation.tick,
      valueC: evaluation.valueC,
      description: `critical control point "${evaluation.ccpId}" recorded ${evaluation.valueC}C, outside its specified limit`,
    }));

  const passed = findings.length === 0;
  return { tick, sampledEntries: sampledLog.length, findings, passed, lineStopped: !passed && enforcesLineStop(difficulty) };
}
