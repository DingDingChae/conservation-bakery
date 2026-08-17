/**
 * A command result: either accepted, or refused with a human-readable reason.
 *
 * Used everywhere in the process layer that an operator or a program can ask a
 * machine to do something — a mode change, an interlocked command, an alarm
 * acknowledgement — so a refusal always explains itself instead of failing silently
 * or throwing. Throwing is reserved for programmer error (an unknown tag, a
 * negative timestep); a refusal is an ordinary, expected outcome of plant state.
 */
export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export function accepted(): CommandResult {
  return { ok: true };
}

export function refused(reason: string): CommandResult {
  return { ok: false, reason };
}
