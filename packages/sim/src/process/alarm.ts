/**
 * The alarm state machine that drives the annunciator tiles.
 *
 * States: normal -> active-unacknowledged -> active-acknowledged -> cleared -> (reset)
 * -> normal. An alarm always requires an operator to acknowledge it, even if the
 * underlying condition has already gone away by the time they look — that is what
 * `active-unacknowledged` continuing to hold means. A latching alarm additionally
 * requires an explicit `reset()` once it has cleared before it returns to normal;
 * a non-latching alarm returns to normal on its own as soon as it is both
 * acknowledged and its condition has gone away.
 */

import type { CommandResult } from './result.js';
import { accepted, refused } from './result.js';

export type AlarmState = 'normal' | 'active-unacknowledged' | 'active-acknowledged' | 'cleared';

export interface AlarmDefinition {
  readonly id: string;
  readonly label: string;
  /** Lower is more urgent, e.g. 1 is the most urgent tile on the annunciator. */
  readonly priority: number;
  /** A latching alarm needs an explicit reset() after it clears before it goes normal. */
  readonly latching: boolean;
}

export class Alarm {
  readonly definition: AlarmDefinition;
  #state: AlarmState = 'normal';
  #conditionActive = false;
  #trippedAtTick: number | undefined;
  #isFirstOut = false;

  constructor(definition: AlarmDefinition) {
    this.definition = definition;
  }

  get id(): string {
    return this.definition.id;
  }

  get priority(): number {
    return this.definition.priority;
  }

  get state(): AlarmState {
    return this.#state;
  }

  get isFirstOut(): boolean {
    return this.#isFirstOut;
  }

  /** The tick this alarm last tripped, cleared once it returns fully to normal. */
  get trippedAtTick(): number | undefined {
    return this.#trippedAtTick;
  }

  /**
   * Feed this alarm's underlying condition for the current scan. Call every tick,
   * whether or not the condition changed — this is the only way state advances.
   */
  evaluate(conditionActive: boolean, tick: number): void {
    if (conditionActive && !this.#conditionActive) {
      this.#conditionActive = true;
      if (this.#state === 'normal') {
        this.#state = 'active-unacknowledged';
        this.#trippedAtTick = tick;
      }
    } else if (!conditionActive && this.#conditionActive) {
      this.#conditionActive = false;
      if (this.#state === 'active-acknowledged') {
        this.#advanceFromAcknowledged();
      }
      // If still active-unacknowledged, it stays that way: an operator must still
      // see and acknowledge that the condition occurred, even though it has since
      // gone away on its own.
    }
  }

  acknowledge(): CommandResult {
    if (this.#state !== 'active-unacknowledged') {
      return refused(`alarm "${this.id}" is ${this.#state}, not active-unacknowledged`);
    }
    this.#state = 'active-acknowledged';
    if (!this.#conditionActive) {
      this.#advanceFromAcknowledged();
    }
    return accepted();
  }

  /** Only legal once an alarm has cleared (latching alarms wait here for the operator). */
  reset(): CommandResult {
    if (this.#state !== 'cleared') {
      return refused(`alarm "${this.id}" is ${this.#state}, not cleared`);
    }
    this.#state = 'normal';
    this.#clearRecord();
    return accepted();
  }

  /** @internal — set by AlarmGroup when this is the first alarm to trip in a burst. */
  markFirstOut(): void {
    this.#isFirstOut = true;
  }

  #advanceFromAcknowledged(): void {
    if (this.definition.latching) {
      this.#state = 'cleared';
    } else {
      this.#state = 'normal';
      this.#clearRecord();
    }
  }

  #clearRecord(): void {
    this.#trippedAtTick = undefined;
    this.#isFirstOut = false;
  }
}

/**
 * A group of alarms sharing one first-out record: within a burst (from the first
 * trip until every alarm in the group is back to normal), only the alarm that
 * tripped first is flagged `isFirstOut`. This is what lets an annunciator show the
 * operator which alarm actually started the cascade.
 */
export class AlarmGroup {
  readonly #alarms: readonly Alarm[];
  #firstOutId: string | undefined;

  constructor(alarms: readonly Alarm[]) {
    this.#alarms = alarms;
  }

  get firstOutId(): string | undefined {
    return this.#firstOutId;
  }

  alarms(): readonly Alarm[] {
    return this.#alarms;
  }

  /** `conditions` maps alarm id to whether its underlying condition is active this scan. */
  evaluate(conditions: ReadonlyMap<string, boolean>, tick: number): void {
    for (const alarm of this.#alarms) {
      const previousState = alarm.state;
      alarm.evaluate(conditions.get(alarm.id) ?? false, tick);
      const currentState = alarm.state;
      if (
        previousState === 'normal' &&
        currentState === 'active-unacknowledged' &&
        this.#firstOutId === undefined
      ) {
        this.#firstOutId = alarm.id;
        alarm.markFirstOut();
      }
    }
    if (this.#alarms.every((alarm) => alarm.state === 'normal')) {
      this.#firstOutId = undefined;
    }
  }
}
