/**
 * The process layer: the framework every machine faceplate is driven by. Model
 * only — no UI, no DOM, no Electron.
 */

export type { CommandResult } from './result.js';
export { accepted, refused } from './result.js';

export type { MachineMode, TagKind, TagDefinition, MachineDefinition } from './machine.js';
export { Machine } from './machine.js';

export type { PidGains, PidLimits, PidMode } from './pid.js';
export { PidController } from './pid.js';

export type { InterlockCondition, Interlock } from './interlock.js';
export { evaluateInterlock, evaluateInterlocks } from './interlock.js';

export type { AlarmState, AlarmDefinition } from './alarm.js';
export { Alarm, AlarmGroup } from './alarm.js';

export type { TrendSample } from './trend.js';
export { TrendBuffer } from './trend.js';

export type { ComponentKind, ComponentDefinition, EquipmentEvent, Rng } from './failure.js';
export { WearComponent, createSeededRng } from './failure.js';
