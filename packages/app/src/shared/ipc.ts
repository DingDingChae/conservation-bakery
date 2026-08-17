/**
 * The contract between the main process, the simulation worker, and the renderer.
 *
 * This file is the seam's paperwork. The renderer *observes* simulation state and
 * *requests* commands; it never holds canonical state and never mutates the world
 * directly. Everything that crosses a process boundary is declared here so that a
 * change to the simulation cannot silently change what the window believes.
 *
 * Conserved quantities cross the boundary as decimal strings, never as `number`.
 * Structured clone can carry a real `bigint`, but the moment a value is JSON-encoded
 * for a log, a save file or an export it would silently become a float and lose
 * exactness. Serialising as a string at the boundary makes that impossible.
 */

/** A conserved quantity in transit: an exact integer written in base 10. */
export type ExactString = string;

export function toExact(value: bigint): ExactString {
  return value.toString(10);
}

export function fromExact(value: ExactString): bigint {
  return BigInt(value);
}

export type SpeedMultiplier = 0 | 1 | 5 | 60;

/** Which register the interface is speaking in. Purely presentational. */
export type Register = 'panel' | 'kid';

export type LanguageMode = 'en' | 'yue' | 'both';

export interface TagSnapshot {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly setpoint: number | null;
  readonly rangeLow: number;
  readonly rangeHigh: number;
}

export type AlarmState =
  | 'normal'
  | 'active-unacknowledged'
  | 'active-acknowledged'
  | 'cleared';

export interface AlarmSnapshot {
  readonly id: string;
  readonly label: string;
  readonly state: AlarmState;
  readonly priority: number;
  /** True for the alarm that tripped first in the current cascade. */
  readonly firstOut: boolean;
  readonly raisedAtTick: number;
}

export type MachineMode = 'OFF' | 'MANUAL' | 'AUTO' | 'SERVICE';

export interface MachineSnapshot {
  readonly id: string;
  readonly label: string;
  readonly mode: MachineMode;
  readonly commissioned: boolean;
  readonly running: boolean;
  readonly runHours: number;
  readonly serviceDueInHours: number;
  readonly tags: readonly TagSnapshot[];
  readonly alarms: readonly AlarmSnapshot[];
}

/**
 * The balance panel's payload. `residual` must be "0" for every commodity, every tick.
 * It is carried explicitly rather than assumed so the interface can *show* that the
 * books close instead of merely asserting it in a test the player never sees.
 */
export interface BalanceRow {
  readonly commodity: string;
  readonly residual: ExactString;
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly simulatedTime: string;
  readonly speed: SpeedMultiplier;
  readonly machines: readonly MachineSnapshot[];
  readonly balance: readonly BalanceRow[];
  readonly balanceOk: boolean;
  readonly digest: string;
}

export interface ProvenanceNode {
  readonly lotId: string;
  readonly substanceId: string;
  readonly label: string;
  readonly mass: ExactString;
  readonly tick: number;
  readonly process: string;
  readonly children: readonly ProvenanceNode[];
  /** Set when the walk was capped, so the interface can say so rather than imply completeness. */
  readonly truncated?: boolean;
}

/** Commands the renderer may request. The simulation decides whether they are legal. */
export type Command =
  | { readonly kind: 'setSpeed'; readonly speed: SpeedMultiplier }
  | { readonly kind: 'setMode'; readonly machineId: string; readonly mode: MachineMode }
  | { readonly kind: 'setSetpoint'; readonly machineId: string; readonly tagId: string; readonly value: number }
  | { readonly kind: 'acknowledgeAlarm'; readonly machineId: string; readonly alarmId: string }
  | { readonly kind: 'resetAlarm'; readonly machineId: string; readonly alarmId: string }
  | { readonly kind: 'callSupplier'; readonly substanceId: string; readonly massUg: ExactString };

/**
 * A command may be refused. A refusal is a first-class result carrying a reason the
 * interface can show verbatim — an interlock that silently does nothing is worse than
 * no interlock, because the player learns the control is broken rather than protected.
 */
export interface CommandResult {
  readonly accepted: boolean;
  readonly reason?: string;
}

export interface RendererApi {
  readonly getSnapshot: () => Promise<WorldSnapshot>;
  readonly onSnapshot: (listener: (snapshot: WorldSnapshot) => void) => () => void;
  readonly send: (command: Command) => Promise<CommandResult>;
  readonly getProvenance: (lotId: string) => Promise<ProvenanceNode>;
}

export const IPC = {
  snapshotRequest: 'sim:snapshot:request',
  snapshotPush: 'sim:snapshot:push',
  command: 'sim:command',
  provenance: 'sim:provenance',
} as const;
