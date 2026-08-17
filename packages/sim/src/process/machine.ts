/**
 * The machine model every faceplate is driven by.
 *
 * Machines are data-driven: a `MachineDefinition` supplies the tag list, engineering
 * ranges and wear components, and `Machine` is the single class that runs any of
 * them. There is deliberately no subclass per physical machine — a proofer and an
 * extruder differ only in their definition, not in code.
 */

import type { ComponentDefinition, EquipmentEvent, Rng } from './failure.js';
import { WearComponent } from './failure.js';
import type { CommandResult } from './result.js';
import { accepted, refused } from './result.js';

export type MachineMode = 'OFF' | 'MANUAL' | 'AUTO' | 'SERVICE';

const RUNNING_MODES: ReadonlySet<MachineMode> = new Set<MachineMode>(['MANUAL', 'AUTO']);

/**
 * Legal next modes from each mode. AUTO cannot jump straight to SERVICE — closed-loop
 * control must first be handed back to MANUAL (or dropped to OFF) before an operator
 * can take the machine out of service, so a service entry is always a deliberate,
 * already-stopped-or-manual action, never a surprise mid-cycle.
 */
const LEGAL_TRANSITIONS: Readonly<Record<MachineMode, readonly MachineMode[]>> = {
  OFF: ['MANUAL', 'SERVICE'],
  MANUAL: ['OFF', 'AUTO', 'SERVICE'],
  AUTO: ['OFF', 'MANUAL'],
  SERVICE: ['OFF'],
};

export type TagKind = 'measurement' | 'setpoint';

export interface TagDefinition {
  readonly name: string;
  readonly unit: string;
  readonly kind: TagKind;
  readonly min: number;
  readonly max: number;
  readonly initial: number;
}

export interface MachineDefinition {
  readonly type: string;
  readonly tags: readonly TagDefinition[];
  /** Run-hours between scheduled maintenance. */
  readonly maintenanceIntervalHours: number;
  readonly components?: readonly ComponentDefinition[];
}

interface TagState {
  readonly definition: TagDefinition;
  value: number;
}

export class Machine {
  readonly id: string;
  readonly label: string;
  readonly definition: MachineDefinition;

  #mode: MachineMode = 'OFF';
  #commissioned = false;
  #runHours = 0;
  #maintenanceDueInHours: number;
  readonly #tags = new Map<string, TagState>();
  readonly #components: readonly WearComponent[];

  constructor(id: string, label: string, definition: MachineDefinition) {
    this.id = id;
    this.label = label;
    this.definition = definition;
    for (const tag of definition.tags) {
      this.#tags.set(tag.name, { definition: tag, value: tag.initial });
    }
    this.#components = (definition.components ?? []).map((component) => new WearComponent(component));
    this.#maintenanceDueInHours = definition.maintenanceIntervalHours;
  }

  get mode(): MachineMode {
    return this.#mode;
  }

  /** A machine that has not been delivered and commissioned cannot enter a running mode. */
  get commissioned(): boolean {
    return this.#commissioned;
  }

  get runHours(): number {
    return this.#runHours;
  }

  get maintenanceDueInHours(): number {
    return this.#maintenanceDueInHours;
  }

  get maintenanceDue(): boolean {
    return this.#maintenanceDueInHours <= 0;
  }

  get running(): boolean {
    return RUNNING_MODES.has(this.#mode);
  }

  get components(): readonly WearComponent[] {
    return this.#components;
  }

  /** Overall wear state: the worst-worn component, or 0 for a machine with none. */
  get wear(): number {
    let worst = 0;
    for (const component of this.#components) worst = Math.max(worst, component.wear);
    return worst;
  }

  commission(): void {
    this.#commissioned = true;
  }

  /** Would `next` be accepted right now? Never mutates. */
  canTransition(next: MachineMode): CommandResult {
    const legal = LEGAL_TRANSITIONS[this.#mode];
    if (!legal.includes(next)) {
      return refused(`"${this.id}" cannot go from ${this.#mode} to ${next}`);
    }
    if (RUNNING_MODES.has(next) && !this.#commissioned) {
      return refused(`"${this.id}" has not been commissioned and cannot run`);
    }
    return accepted();
  }

  /** Attempt the transition, applying it only if legal. */
  requestMode(next: MachineMode): CommandResult {
    const result = this.canTransition(next);
    if (!result.ok) return result;
    this.#mode = next;
    return accepted();
  }

  tagNames(): readonly string[] {
    return [...this.#tags.keys()];
  }

  tagDefinition(name: string): TagDefinition {
    return this.#requireTag(name).definition;
  }

  getTag(name: string): number {
    return this.#requireTag(name).value;
  }

  /** Sets a tag, clamped to its engineering range — a faceplate cannot enter garbage. */
  setTag(name: string, value: number): number {
    const tag = this.#requireTag(name);
    const clamped = Math.min(tag.definition.max, Math.max(tag.definition.min, value));
    tag.value = clamped;
    return clamped;
  }

  #requireTag(name: string): TagState {
    const tag = this.#tags.get(name);
    if (!tag) throw new RangeError(`machine "${this.id}" has no tag "${name}"`);
    return tag;
  }

  /**
   * Advance run hours and equipment wear by a fixed, caller-supplied timestep. Only
   * accrues while in a running mode — a stopped machine does not rack up run hours.
   * `duty` is the load factor (0..1) passed straight through to the wear model;
   * `rng` is the seeded source for any failure chance, see failure.ts.
   */
  advance(hours: number, duty: number, rng: Rng): readonly EquipmentEvent[] {
    if (hours < 0) throw new RangeError(`cannot advance by negative hours ${hours}`);
    if (!this.running) return [];

    this.#runHours += hours;
    this.#maintenanceDueInHours = Math.max(0, this.#maintenanceDueInHours - hours);

    const events: EquipmentEvent[] = [];
    for (const component of this.#components) {
      const event = component.advance(hours, duty, rng, this.#runHours);
      if (event) events.push(event);
    }
    return events;
  }

  /** Scheduled maintenance: reset the counter and every worn component. */
  performMaintenance(): void {
    this.#maintenanceDueInHours = this.definition.maintenanceIntervalHours;
    for (const component of this.#components) component.replace();
  }
}
