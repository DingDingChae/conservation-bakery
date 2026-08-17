import { describe, expect, it } from 'vitest';

import type { Command, CommandResult, WorldSnapshot } from '../../shared/ipc.js';
import type { RendererContext } from '../context.js';
import { createTranslate } from '../i18n/index.js';

import { builtinPaletteEntries } from './commands.js';

/** A minimal, real `RendererContext` — real `t` against the real catalogues (so a
 * label typo or a bad interpolation key shows up exactly the way it would for a
 * player), a fixed snapshot, and instrumented `send`/`announce` so a test can assert
 * what a command actually requested and what got announced. Every member this module
 * does not use throws, so a future call this test does not expect fails loudly rather
 * than silently returning `undefined`. */
function fakeContext(options: {
  readonly speed?: WorldSnapshot['speed'] | null;
  readonly sendResult?: CommandResult;
}): { readonly context: RendererContext; readonly sent: Command[]; readonly announced: string[] } {
  const sent: Command[] = [];
  const announced: string[] = [];
  const snapshot: WorldSnapshot | null =
    options.speed === null
      ? null
      : {
          tick: 0,
          simulatedTime: '2026-01-01T00:00:00.000Z',
          speed: options.speed ?? 1,
          machines: [],
          balance: [],
          balanceOk: true,
          digest: 'x',
        };

  const context: RendererContext = {
    snapshot: () => snapshot,
    subscribe: () => () => undefined,
    send: async (command: Command) => {
      sent.push(command);
      return options.sendResult ?? { accepted: true };
    },
    provenance: () => {
      throw new Error('not used by this test');
    },
    t: createTranslate(() => ({ register: 'panel', language: 'en' })),
    announce: (message) => {
      announced.push(message);
    },
    preferences: () => {
      throw new Error('not used by this test');
    },
    setPreferences: () => {
      throw new Error('not used by this test');
    },
    onPreferences: () => () => undefined,
    reveal: () => {
      throw new Error('not used by this test');
    },
    registerRevealHandler: () => () => undefined,
    registerCommands: () => () => undefined,
    paletteEntries: () => [],
  };

  return { context, sent, announced };
}

describe('builtinPaletteEntries: speed', () => {
  it('labels the currently active running speed with speed.current, and every other option with command.setSpeed', () => {
    const { context } = fakeContext({ speed: 5 });
    const entries = builtinPaletteEntries(context);
    const bySpeedId = (speed: number) => entries.find((entry) => entry.id === `palette:speed:${speed}`);

    expect(bySpeedId(5)?.label).toBe('Running at 5×');
    expect(bySpeedId(1)?.label).toBe('Set speed to 1×');
    expect(bySpeedId(60)?.label).toBe('Set speed to 60×');
    expect(bySpeedId(0)?.label).toBe('Set speed to 0×');
  });

  it('labels the currently active paused speed with speed.currentPaused, not a literal "Running at 0×"', () => {
    const { context } = fakeContext({ speed: 0 });
    const entries = builtinPaletteEntries(context);
    expect(entries.find((entry) => entry.id === 'palette:speed:0')?.label).toBe('Paused');
  });

  it('groups every speed entry under palette.groupSpeed', () => {
    const { context } = fakeContext({ speed: 1 });
    const speedEntries = builtinPaletteEntries(context).filter((entry) => entry.id.startsWith('palette:speed:'));
    expect(speedEntries).toHaveLength(4);
    for (const entry of speedEntries) expect(entry.group).toBe('Speed');
  });

  it('sends the real setSpeed command when run', async () => {
    const { context, sent } = fakeContext({ speed: 1 });
    const entry = builtinPaletteEntries(context).find((candidate) => candidate.id === 'palette:speed:60');
    await entry?.run();
    expect(sent).toEqual([{ kind: 'setSpeed', speed: 60 }]);
  });
});

describe('builtinPaletteEntries: difficulty presets', () => {
  it('registers all four presets, grouped under palette.groupDifficulty, sending a real setDifficulty command', async () => {
    const { context, sent } = fakeContext({ speed: 1 });
    const entries = builtinPaletteEntries(context).filter((entry) => entry.id.startsWith('palette:difficulty:'));
    expect(entries.map((entry) => entry.id).sort()).toEqual(
      ['palette:difficulty:easy', 'palette:difficulty:freePlay', 'palette:difficulty:punishing', 'palette:difficulty:realistic'].sort(),
    );
    for (const entry of entries) expect(entry.group).toBe('Difficulty');

    const easy = entries.find((entry) => entry.id === 'palette:difficulty:easy');
    expect(easy?.label).toBe('Easy');
    await easy?.run();
    expect(sent).toEqual([{ kind: 'setDifficulty', preset: 'easy' }]);
  });
});

describe('builtinPaletteEntries: call a supplier', () => {
  it('registers one entry per curated substance, sending a real, positive-mass callSupplier command', async () => {
    const { context, sent } = fakeContext({ speed: 1 });
    const entries = builtinPaletteEntries(context).filter((entry) => entry.id.startsWith('palette:supplier:'));
    expect(entries.length).toBeGreaterThan(0);

    const flour = entries.find((entry) => entry.id === 'palette:supplier:wheat-flour-white');
    expect(flour?.label).toBe('Call supplier for wheat-flour-white');
    await flour?.run();
    expect(sent).toHaveLength(1);
    const command = sent[0];
    expect(command?.kind).toBe('callSupplier');
    if (command?.kind === 'callSupplier') {
      expect(command.substanceId).toBe('wheat-flour-white');
      expect(BigInt(command.massUg)).toBeGreaterThan(0n);
    }
  });
});

describe('builtinPaletteEntries: refusal announcement', () => {
  it('announces a refused command with refusal.title as a heading, using real bilingual copy', async () => {
    const { context, announced } = fakeContext({
      speed: 1,
      sendResult: { accepted: false, reason: 'The simulation is not running.' },
    });
    const entry = builtinPaletteEntries(context).find((candidate) => candidate.id === 'palette:speed:5');
    await entry?.run();
    expect(announced).toEqual(['Command refused — The simulation is not running']);
  });

  it('announces nothing when the command is accepted', async () => {
    const { context, announced } = fakeContext({ speed: 1, sendResult: { accepted: true } });
    const entry = builtinPaletteEntries(context).find((candidate) => candidate.id === 'palette:speed:5');
    await entry?.run();
    expect(announced).toEqual([]);
  });
});
