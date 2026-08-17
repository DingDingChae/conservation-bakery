/**
 * The bilingual, two-register translation catalogue.
 *
 * Four catalogues exist: English panel, English Kid, Cantonese panel, Cantonese Kid —
 * see `en-panel.ts`, `en-kid.ts`, `yue-panel.ts`, `yue-kid.ts`. This module owns the
 * key type every one of them is checked against, the interpolation syntax, the lookup
 * that turns `(register, language, key)` into a string, and the `'both'` language mode.
 *
 * The panel register is the real engineering vocabulary — the same words a control
 * room actually uses (`AUTO`, `Priority 2`, `Residual`). The Kid register is a genuine
 * rewrite into plain language with every number explained, never the same sentence
 * with shorter words — see `en-kid.ts`'s module comment for the standard this file
 * holds every Kid entry to.
 *
 * ## Key naming
 *
 * Keys are flat, dot-namespaced strings (`'alarm.state.cleared'`), not nested objects,
 * so the four catalogues can be plain `Record<CatalogueKey, string>` literals and
 * `catalogue.spec.ts` can diff their key sets with a single `Object.keys` call each.
 *
 * ## Interpolation
 *
 * A template may contain `{name}` placeholders. `interpolate()` replaces each one with
 * `String(values.name)`. A placeholder with no matching value is left untouched (the
 * literal `{name}` stays in the output) rather than silently dropped — a missing value
 * is a caller bug, and leaving the brace text visible makes that bug obvious in the
 * running app instead of hiding it as an empty gap.
 *
 * ## `'both'` language mode
 *
 * When `LanguageMode` is `'both'`, `createTranslate` renders *both* languages at once
 * for the active register, stacked as two lines joined by `'\n'`: the English line
 * first, the Cantonese line second. This applies identically to the panel register
 * (whose components can afford a secondary readout line, e.g. under a label strip) and
 * to the Kid register (whose components can afford a second line of friendly prose
 * underneath the first) — both registers get the same two-line treatment, because
 * `'both'` is a language decision, orthogonal to which register is active. A panel that
 * wants to render the two lines as separate DOM nodes (rather than one text node with a
 * line break) can `split('\n')` the result; a plain-text context (an `aria-label`, a
 * `title` attribute) renders the embedded newline as whitespace, which still reads as
 * "English, then Cantonese" rather than losing either language.
 */

import type { LanguageMode, Register } from '../../shared/ipc.js';
import type { Translate } from '../context.js';
import { enKid } from './en-kid.js';
import { enPanel } from './en-panel.js';
import { yueKid } from './yue-kid.js';
import { yuePanel } from './yue-panel.js';

/**
 * Every translation key in the product, in one place. `en-panel.ts`, `en-kid.ts`,
 * `yue-panel.ts` and `yue-kid.ts` each declare `Record<CatalogueKey, string>` against
 * this list, so TypeScript's excess-property check on their object literals already
 * catches an orphaned key (present in one catalogue, absent from this list) and a
 * missing key (present in this list, absent from a catalogue) at compile time.
 * `catalogue.spec.ts` re-checks the same invariant at runtime with `Object.keys`, so
 * the guarantee holds even if a catalogue file ever stops being a plain object literal.
 */
export const CATALOGUE_KEYS = [
  // -- Machine mode (MachineMode from shared/ipc.ts) --------------------------------
  'mode.off',
  'mode.manual',
  'mode.auto',
  'mode.service',
  'mode.label',
  'mode.legend',
  'mode.commissioned',
  'mode.notCommissioned',
  'mode.running',
  'mode.stopped',
  'mode.runHours',
  'mode.serviceDue',

  // -- Alarm state (AlarmState from shared/ipc.ts) -----------------------------------
  'alarm.state.normal',
  'alarm.state.activeUnacknowledged',
  'alarm.state.activeAcknowledged',
  'alarm.state.cleared',
  'alarm.acknowledge',
  'alarm.reset',
  'alarm.priority',
  'alarm.firstOut',
  'alarm.raisedAtTick',
  'alarm.announceRaised',
  'alarm.announceCleared',
  'alarm.announceAcknowledged',
  'alarm.title',
  'alarm.none',

  // -- Balance panel ------------------------------------------------------------------
  'balance.title',
  'balance.commodity',
  'balance.residual',
  'balance.ok',
  'balance.notOk',
  'balance.row',
  'balance.tick',

  // -- Provenance tree ------------------------------------------------------------------
  'provenance.title',
  'provenance.root',
  'provenance.process',
  'provenance.tick',
  'provenance.mass',
  'provenance.truncated',
  'provenance.empty',
  'provenance.lot',

  // -- Speed controls (SpeedMultiplier from shared/ipc.ts) -----------------------------
  'speed.label',
  'speed.pause',
  'speed.x1',
  'speed.x5',
  'speed.x60',
  'speed.current',
  'speed.currentPaused',

  // -- Difficulty presets and knobs -----------------------------------------------------
  'difficulty.title',
  'difficulty.freePlay',
  'difficulty.easy',
  'difficulty.realistic',
  'difficulty.punishing',
  'difficulty.knob.yield',
  'difficulty.knob.price',
  'difficulty.knob.tolerance',
  'difficulty.knob.breakdownRate',
  'difficulty.knob.help',
  'difficulty.callSupplier',
  'difficulty.callSupplierHint',

  // -- Command palette --------------------------------------------------------------
  'palette.title',
  'palette.placeholder',
  'palette.noResults',
  'palette.hint',
  'palette.groupMachines',
  'palette.groupAlarms',
  'palette.groupSpeed',
  'palette.groupDifficulty',
  'palette.groupProvenance',
  'palette.resultCount',

  // -- Command labels (Command from shared/ipc.ts), for palette entries and buttons --
  'command.setSpeed',
  'command.setMode',
  'command.setSetpoint',
  'command.acknowledgeAlarm',
  'command.resetAlarm',
  'command.callSupplier',

  // -- Command refusal reasons (CommandResult.reason from shared/ipc.ts) --------------
  'refusal.title',
  'refusal.generic',
  'refusal.notCommissioned',
  'refusal.modeTransition',
  'refusal.alarmNotUnacknowledged',
  'refusal.alarmNotCleared',
  'refusal.interlock',
  'refusal.outOfRange',
  'refusal.simulationNotRunning',

  // -- Units ----------------------------------------------------------------------------
  'unit.celsius',
  'unit.kilogram',
  'unit.gram',
  'unit.hour',
  'unit.minute',
  'unit.second',
  'unit.percent',
  'unit.perHour',
  'unit.tick',

  // -- Language/register settings (Preferences from renderer/context.ts) --------------
  'settings.register.panel',
  'settings.register.kid',
  'settings.language.en',
  'settings.language.yue',
  'settings.language.both',
  'settings.reducedMotion',
  'settings.muted',
] as const;

export type CatalogueKey = (typeof CATALOGUE_KEYS)[number];

/** One language's one register: every key mapped to its template string. */
export type Catalogue = Readonly<Record<CatalogueKey, string>>;

export type InterpolationValues = Readonly<Record<string, string | number>>;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/**
 * Substitute `{name}` placeholders in `template` with `values.name`. A placeholder
 * whose name is absent from `values` — or whose value is `undefined`, which
 * `exactOptionalPropertyTypes` still allows a caller to pass explicitly — is left as
 * the literal `{name}` text rather than silently erased.
 */
export function interpolate(template: string, values?: InterpolationValues): string {
  if (!values) return template;
  return template.replace(PLACEHOLDER_PATTERN, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/** The two concrete languages a single catalogue lookup ever resolves to. `'both'`
 * (see the module comment) is handled one level up, by combining a lookup in each. */
type ConcreteLanguage = 'en' | 'yue';

const CATALOGUES: Readonly<Record<ConcreteLanguage, Readonly<Record<Register, Catalogue>>>> = {
  en: { panel: enPanel, kid: enKid },
  yue: { panel: yuePanel, kid: yueKid },
};

/**
 * Raw (pre-interpolation) lookup for one concrete language and register. `key` is
 * typed as plain `string` — not `CatalogueKey` — because `Translate` (the shape every
 * caller across the renderer seam actually holds) declares `key: string`, so a typo or
 * a key built from a dynamic string arrives here without a compile-time guarantee.
 * Rather than throw and take a panel down over one bad key, an unknown key renders as
 * a visibly-broken placeholder that still names the key, so the mistake is obvious in
 * the running app and in a screenshot, not silently blank.
 */
function rawLookup(language: ConcreteLanguage, register: Register, key: string): string {
  const catalogue = CATALOGUES[language][register];
  return key in catalogue ? catalogue[key as CatalogueKey] : `⟦missing:${key}⟧`;
}

/**
 * The full lookup: register, language (including `'both'`), key and interpolation
 * values in; the string a panel actually renders out. Exported directly (as well as
 * via `createTranslate`) so a caller that already tracks register/language itself
 * (a test, a non-reactive render) does not need to build a closure just to call it once.
 */
export function translate(
  register: Register,
  language: LanguageMode,
  key: string,
  values?: InterpolationValues,
): string {
  if (language === 'both') {
    const en = interpolate(rawLookup('en', register, key), values);
    const yue = interpolate(rawLookup('yue', register, key), values);
    return `${en}\n${yue}`;
  }
  return interpolate(rawLookup(language, register, key), values);
}

/**
 * Build a `Translate` function (the exact shape `RendererContext.t` holds) bound to a
 * live source of the current register and language. `getPreferences` is called on
 * every translation, not cached, so a preference change (register or language flipped
 * mid-session) is reflected on the very next render without the caller having to
 * rebuild the translator.
 */
export function createTranslate(
  getPreferences: () => { readonly register: Register; readonly language: LanguageMode },
): Translate {
  return (key, values) => {
    const preferences = getPreferences();
    return translate(preferences.register, preferences.language, key, values);
  };
}
