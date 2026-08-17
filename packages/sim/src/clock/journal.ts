/**
 * The input log.
 *
 * A run of the simulation is fully determined by three things: the seed handed to
 * the root RNG, the instant the simulated clock started at, and the ordered list of
 * player commands applied along the way. This module is the third of those, plus
 * the container that ties all three together so a run can be written out and
 * played back exactly.
 */

/**
 * A single player action, stamped with the tick it takes effect on.
 *
 * `type` and `payload` are deliberately generic: this module does not know what a
 * "command" means to the bakery, only that it is a plain, JSON-serialisable value
 * applied at a specific tick. Conserved quantities inside a payload must already be
 * encoded as JSON-safe values (a decimal string, typically) — `bigint` itself is
 * not valid JSON and this module does not smuggle it through `JSON.stringify`.
 */
export interface Command<TType extends string = string, TPayload = unknown> {
  readonly type: TType;
  readonly tick: number;
  readonly payload: TPayload;
}

export interface RunHeader {
  /** The seed the run's root RNG was created from. */
  readonly seed: number;
  /** Milliseconds since the epoch that simulated tick 0 corresponds to. */
  readonly startInstantMs: number;
}

export interface RunRecord<TCommand extends Command = Command> extends RunHeader {
  readonly commands: readonly TCommand[];
}

function isCommand(value: unknown): value is Command {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['type'] === 'string' &&
    typeof record['tick'] === 'number' &&
    Number.isInteger(record['tick']) &&
    'payload' in record
  );
}

/**
 * An append-only log of commands for one run, plus the seed and start instant
 * that, together with the log, fully determine that run's outcome.
 */
export class Journal<TCommand extends Command = Command> {
  readonly #seed: number;
  readonly #startInstantMs: number;
  readonly #commands: TCommand[] = [];

  constructor(header: RunHeader) {
    this.#seed = header.seed;
    this.#startInstantMs = header.startInstantMs;
  }

  get seed(): number {
    return this.#seed;
  }

  get startInstantMs(): number {
    return this.#startInstantMs;
  }

  get commands(): readonly TCommand[] {
    return this.#commands;
  }

  /**
   * Record a command. Commands must be appended in non-decreasing tick order: the
   * journal is a log of what happened, in the order it happened, and an
   * out-of-order append is almost always a sign the caller computed the wrong
   * tick rather than something the journal should silently accept.
   */
  append(command: TCommand): void {
    const last = this.#commands[this.#commands.length - 1];
    if (last !== undefined && command.tick < last.tick) {
      throw new RangeError(
        `command for tick ${command.tick} appended after tick ${last.tick}; ` +
          'the journal must be recorded in non-decreasing tick order',
      );
    }
    this.#commands.push(command);
  }

  /** All commands stamped for exactly this tick, in the order they were appended. */
  at(tick: number): readonly TCommand[] {
    return this.#commands.filter((command) => command.tick === tick);
  }

  toRecord(): RunRecord<TCommand> {
    return {
      seed: this.#seed,
      startInstantMs: this.#startInstantMs,
      commands: [...this.#commands],
    };
  }

  serialize(): string {
    return JSON.stringify(this.toRecord());
  }

  static fromRecord<TCommand extends Command = Command>(
    record: RunRecord<TCommand>,
  ): Journal<TCommand> {
    const journal = new Journal<TCommand>({
      seed: record.seed,
      startInstantMs: record.startInstantMs,
    });
    for (const command of record.commands) journal.append(command);
    return journal;
  }

  static deserialize<TCommand extends Command = Command>(json: string): Journal<TCommand> {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new TypeError('journal JSON must decode to an object');
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record['seed'] !== 'number' || typeof record['startInstantMs'] !== 'number') {
      throw new TypeError('journal JSON is missing a numeric seed or startInstantMs');
    }
    const commands = record['commands'];
    if (!Array.isArray(commands) || !commands.every(isCommand)) {
      throw new TypeError('journal JSON has a malformed command list');
    }
    return Journal.fromRecord<TCommand>({
      seed: record['seed'],
      startInstantMs: record['startInstantMs'],
      commands: commands as TCommand[],
    });
  }
}
