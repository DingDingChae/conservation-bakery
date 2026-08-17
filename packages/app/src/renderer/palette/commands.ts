/**
 * Built-in command-palette entries the palette itself always offers, independent of
 * whichever panel happens to be mounted: speed control, the difficulty presets, and
 * call-a-supplier. Unlike a panel's own `context.registerCommands` entries (registered
 * once, at mount time — see `faceplate/render.ts`'s `registerPalette`), these are
 * rebuilt on every `palette.ts` `render()` call, so the "currently selected" speed
 * label always reflects the live snapshot even though `shell/layout.ts` only remounts
 * the palette itself on a register/language change, not on every tick.
 *
 * `shared/ipc.ts`'s `Command` union carries `setSpeed` and `setDifficulty`, so both are
 * real, sourced, ledgered requests to the simulation — never a value invented here. A
 * call-a-supplier entry still needs a mass the palette has no follow-up numeric prompt
 * to collect (`shell/settings.ts` owns the real form, with its own mass field); this
 * module uses one fixed, round, real quantity per entry rather than leaving the command
 * permanently unreachable from the palette.
 */

import type { Command, DifficultyPresetName, SpeedMultiplier } from '../../shared/ipc.js';
import type { PaletteEntry, RendererContext } from '../context.js';
import { describeRefusal } from '../faceplate/logic.js';

const SPEED_OPTIONS: readonly SpeedMultiplier[] = [0, 1, 5, 60];
const SPEED_LABEL_KEY: Readonly<Record<SpeedMultiplier, string>> = {
  0: 'speed.pause',
  1: 'speed.x1',
  5: 'speed.x5',
  60: 'speed.x60',
};

const DIFFICULTY_PRESETS: readonly { readonly preset: DifficultyPresetName; readonly key: string }[] = [
  { preset: 'freePlay', key: 'difficulty.freePlay' },
  { preset: 'easy', key: 'difficulty.easy' },
  { preset: 'realistic', key: 'difficulty.realistic' },
  { preset: 'punishing', key: 'difficulty.punishing' },
];

/** A small, real subset of the substances `sim-worker/difficulty.ts`'s own
 * `BASE_PRICE_MINOR_PER_KG` table prices, and `shell/settings.ts`'s call-a-supplier
 * form already lists — not every substance that table carries, just enough that the
 * palette can reach the most commonly restocked ingredients directly. */
const SUPPLIER_SUBSTANCES: readonly string[] = [
  'wheat-flour-white',
  'butter',
  'sucrose',
  'sodium-bicarbonate',
  'hen-egg-whole',
  'water-liquid',
];

/** One round, real call-a-supplier delivery: 100 kg, in exact micrograms — a
 * representative restock quantity, not a fabricated one; the ledger sources, costs and
 * records it exactly like any other delivery `#callSupplier` (`sim-worker/world.ts`)
 * accepts. */
const SUPPLIER_DEFAULT_MASS_UG = (100_000n * 1_000_000n).toString(10);

/** Runs `command` and, on refusal, announces it with `refusal.title` as a heading — the
 * palette dialog has already closed by the time an entry's `run()` executes
 * (`palette.ts`'s own `runEntry`), so nothing on screen still names which command this
 * refusal belongs to; the announcement has to say so itself. */
async function runAndAnnounceRefusal(context: RendererContext, command: Command): Promise<void> {
  const result = await context.send(command);
  if (result.accepted) return;
  context.announce(`${context.t('refusal.title')} — ${describeRefusal(context.t, result.reason)}`, 'assertive');
}

/**
 * Speed, difficulty-preset and call-a-supplier entries — every one a real command the
 * palette can drive the plant with directly, not a reveal to somewhere else.
 * `context.snapshot()` is read fresh here so the currently-active speed's label
 * (`speed.current`/`speed.currentPaused`) never goes stale between palette renders.
 */
export function builtinPaletteEntries(context: RendererContext): readonly PaletteEntry[] {
  const currentSpeed = context.snapshot()?.speed ?? null;
  const speedGroup = context.t('palette.groupSpeed');

  const speedEntries: PaletteEntry[] = SPEED_OPTIONS.map((speed) => {
    const isCurrent = currentSpeed === speed;
    const label = isCurrent
      ? context.t(speed === 0 ? 'speed.currentPaused' : 'speed.current', { speed })
      : context.t('command.setSpeed', { speed });
    return {
      id: `palette:speed:${speed}`,
      label,
      group: speedGroup,
      keywords: [String(speed), context.t(SPEED_LABEL_KEY[speed])],
      run: () => runAndAnnounceRefusal(context, { kind: 'setSpeed', speed }),
    };
  });

  const difficultyGroup = context.t('palette.groupDifficulty');

  const difficultyEntries: PaletteEntry[] = DIFFICULTY_PRESETS.map(({ preset, key }) => ({
    id: `palette:difficulty:${preset}`,
    label: context.t(key),
    group: difficultyGroup,
    keywords: [preset],
    run: () => runAndAnnounceRefusal(context, { kind: 'setDifficulty', preset }),
  }));

  // Grouped with the difficulty presets, not a group of its own: call-a-supplier is
  // the difficulty-gated economic lever CONTRACT.md discusses in the same breath as
  // the presets themselves ("Easy mode is generous... and a call-a-supplier action").
  const supplierEntries: PaletteEntry[] = SUPPLIER_SUBSTANCES.map((substanceId) => ({
    id: `palette:supplier:${substanceId}`,
    label: context.t('command.callSupplier', { substance: substanceId }),
    group: difficultyGroup,
    keywords: [substanceId, 'supplier', 'delivery'],
    run: () =>
      runAndAnnounceRefusal(context, { kind: 'callSupplier', substanceId, massUg: SUPPLIER_DEFAULT_MASS_UG }),
  }));

  return [...speedEntries, ...difficultyEntries, ...supplierEntries];
}
