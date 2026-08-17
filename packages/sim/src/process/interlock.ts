/**
 * Declarative interlocks.
 *
 * An interlock refuses a specific command and says why, because the command would
 * compromise equipment or product integrity — it never models anything happening
 * to a person. A door open means the bake profile cannot be held, so the "hold
 * profile" command is refused; the oven itself is described only as unable to
 * hold its profile with the door open. See CONTRACT.md rule 2.
 */

import type { CommandResult } from './result.js';
import { accepted, refused } from './result.js';

export interface InterlockCondition {
  readonly id: string;
  /** Why the command is refused when this condition is not satisfied, e.g. "door open". */
  readonly description: string;
  /** True means the plant state is safe for the command to proceed. */
  readonly isSatisfied: () => boolean;
}

export interface Interlock {
  readonly id: string;
  readonly label: string;
  /** What this interlock protects — always equipment or product, never a person. */
  readonly protects: string;
  readonly conditions: readonly InterlockCondition[];
}

/** Evaluate one interlock. Refuses on the first unsatisfied condition, in order. */
export function evaluateInterlock(interlock: Interlock): CommandResult {
  for (const condition of interlock.conditions) {
    if (!condition.isSatisfied()) {
      return refused(
        `${interlock.label} refused: ${condition.description} (protects ${interlock.protects})`,
      );
    }
  }
  return accepted();
}

/** Evaluate a set of interlocks that all gate the same command. Refuses on the first hit. */
export function evaluateInterlocks(interlocks: readonly Interlock[]): CommandResult {
  for (const interlock of interlocks) {
    const result = evaluateInterlock(interlock);
    if (!result.ok) return result;
  }
  return accepted();
}
