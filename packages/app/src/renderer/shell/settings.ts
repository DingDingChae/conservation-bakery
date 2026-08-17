/**
 * The settings surface: register (Panel / Kid), language (English / Cantonese /
 * both), reduced motion, mute, a difficulty reference, and the call-a-supplier action.
 *
 * Register and language write straight through `RendererContext.setPreferences` —
 * every panel that reads `context.t()` or subscribes to `context.onPreferences` picks
 * the change up on its own; this screen's own job is only to offer the control and let
 * the running world keep running underneath it, per CLAUDE.md's "switch live, without
 * a reload and without losing state."
 *
 * ## The difficulty gap
 *
 * `shared/ipc.ts`'s `Command` union has no `setDifficulty` case — `world.ts`'s own
 * `SimWorld.setDifficulty` method says so directly in its doc comment: "there is, as
 * yet, no `Command` ... that reaches this from the renderer — that is a gap in the
 * shared contract, not in this method." `WorldSnapshot` likewise carries no difficulty
 * field, so this screen cannot show the *current* difficulty either. Rather than build
 * knob controls that silently do nothing when pressed — the one thing this product's
 * whole refusal-surfacing discipline exists to prevent — this screen shows the four
 * presets as plain reference text only, with no control that pretends to change them.
 * The one difficulty-gated action the wire contract *does* carry, `callSupplier`, is
 * wired for real below.
 */

import type { Command } from '../../shared/ipc.js';
import type { Disposable, RendererContext } from '../context.js';
import { el } from '../kit/dom.js';
import { parseWholeGramsToMicrograms } from './logic.js';

const REGISTERS: readonly { readonly value: 'panel' | 'kid'; readonly key: string }[] = [
  { value: 'panel', key: 'settings.register.panel' },
  { value: 'kid', key: 'settings.register.kid' },
];

const LANGUAGES: readonly { readonly value: 'en' | 'yue' | 'both'; readonly key: string }[] = [
  { value: 'en', key: 'settings.language.en' },
  { value: 'yue', key: 'settings.language.yue' },
  { value: 'both', key: 'settings.language.both' },
];

const DIFFICULTY_PRESET_KEYS = ['difficulty.freePlay', 'difficulty.easy', 'difficulty.realistic', 'difficulty.punishing'];
const DIFFICULTY_KNOB_KEYS = [
  'difficulty.knob.yield',
  'difficulty.knob.price',
  'difficulty.knob.tolerance',
  'difficulty.knob.breakdownRate',
  'difficulty.knob.help',
];

/** A small, real set of substances `packages/data` actually carries — see
 * `sim-worker/difficulty.ts`'s own `BASE_PRICE_MINOR_PER_KG` table, which prices
 * exactly this list. Shown verbatim as the option text (the same convention
 * `sim-worker/world.ts`'s own provenance labelling already uses for a substance with
 * no player-facing display name of its own). */
const CALL_SUPPLIER_SUBSTANCES: readonly string[] = [
  'wheat-flour-white',
  'butter',
  'sucrose',
  'sodium-bicarbonate',
  'hen-egg-whole',
  'water-liquid',
  'cardboard',
  'polypropylene-film',
  'sugar-beet',
];

export const mountSettings: (root: HTMLElement, context: RendererContext) => Disposable = (root, context) => {
  const section = el('section', {
    class: 'cb-panel-frame cb-shell-settings',
    attrs: { 'aria-labelledby': 'shell-settings-title' },
  });
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    section.append(
      el('span', { class: ['cb-panel-frame__fastener', `cb-panel-frame__fastener--${corner}`], attrs: { 'aria-hidden': 'true' } }),
    );
  }
  const title = el('h2', { class: 'cb-panel-frame__title', attrs: { id: 'shell-settings-title' } });
  section.append(title);

  // --- Register ------------------------------------------------------------
  const registerFieldset = el('fieldset', { class: 'cb-mode-selector' });
  const registerLegend = el('legend', { class: 'cb-mode-selector__legend' });
  const registerTrack = el('div', { class: 'cb-mode-selector__track' });
  const registerInputs = new Map<'panel' | 'kid', HTMLInputElement>();
  for (const { value, key } of REGISTERS) {
    const inputId = `settings-register-${value}`;
    const input = el('input', { attrs: { type: 'radio', name: 'settings-register', value, id: inputId } }) as HTMLInputElement;
    const label = el('label', { class: 'cb-mode-selector__option', attrs: { for: inputId }, dataset: { key } });
    label.append(input, el('span', {}));
    registerTrack.append(label);
    registerInputs.set(value, input);
    input.addEventListener('change', () => context.setPreferences({ register: value }));
  }
  registerFieldset.append(registerLegend, registerTrack);

  // --- Language --------------------------------------------------------------
  const languageFieldset = el('fieldset', { class: 'cb-mode-selector' });
  const languageLegend = el('legend', { class: 'cb-mode-selector__legend' });
  const languageTrack = el('div', { class: 'cb-mode-selector__track' });
  const languageInputs = new Map<'en' | 'yue' | 'both', HTMLInputElement>();
  for (const { value, key } of LANGUAGES) {
    const inputId = `settings-language-${value}`;
    const input = el('input', { attrs: { type: 'radio', name: 'settings-language', value, id: inputId } }) as HTMLInputElement;
    const label = el('label', { class: 'cb-mode-selector__option', attrs: { for: inputId }, dataset: { key } });
    label.append(input, el('span', {}));
    languageTrack.append(label);
    languageInputs.set(value, input);
    input.addEventListener('change', () => context.setPreferences({ language: value }));
  }
  languageFieldset.append(languageLegend, languageTrack);

  // --- Reduced motion / mute -------------------------------------------------
  const reducedMotionInput = el('input', { attrs: { type: 'checkbox', id: 'settings-reduced-motion' } }) as HTMLInputElement;
  const reducedMotionLabel = el('label', { attrs: { for: 'settings-reduced-motion' } });
  reducedMotionLabel.append(reducedMotionInput, el('span', {}));
  reducedMotionInput.addEventListener('change', () => context.setPreferences({ reducedMotion: reducedMotionInput.checked }));

  const mutedInput = el('input', { attrs: { type: 'checkbox', id: 'settings-muted' } }) as HTMLInputElement;
  const mutedLabel = el('label', { attrs: { for: 'settings-muted' } });
  mutedLabel.append(mutedInput, el('span', {}));
  mutedInput.addEventListener('change', () => context.setPreferences({ muted: mutedInput.checked }));

  const togglesRow = el('div', { class: 'cb-shell-settings__toggles', children: [reducedMotionLabel, mutedLabel] });

  // --- Difficulty reference (read-only — see module doc comment) -------------
  const difficultySection = el('div', { class: 'cb-faceplate__section' });
  const difficultyTitle = el('p', { class: 'cb-faceplate__section-title' });
  const difficultyNote = el('p', { class: 'cb-numeric-entry__hint' });
  const presetList = el('ul', { class: 'cb-shell-settings__difficulty-list' });
  const knobList = el('ul', { class: 'cb-shell-settings__difficulty-list' });
  difficultySection.append(difficultyTitle, difficultyNote, presetList, knobList);

  // --- Call a supplier ---------------------------------------------------------
  const supplierForm = el('form', { class: 'cb-shell-settings__supplier' });
  const supplierTitle = el('p', { class: 'cb-faceplate__section-title' });
  const supplierHint = el('p', { class: 'cb-numeric-entry__hint' });
  const substanceLabel = el('label', { attrs: { for: 'settings-supplier-substance' } });
  const substanceSelect = el('select', { attrs: { id: 'settings-supplier-substance' } }) as HTMLSelectElement;
  for (const substanceId of CALL_SUPPLIER_SUBSTANCES) {
    substanceSelect.append(el('option', { attrs: { value: substanceId }, text: substanceId }));
  }
  const massLabel = el('label', { attrs: { for: 'settings-supplier-mass' } });
  const massInput = el('input', {
    attrs: { type: 'number', id: 'settings-supplier-mass', min: '1', step: '1', inputmode: 'numeric' },
  }) as HTMLInputElement;
  const submit = el('button', { class: 'cb-provenance-tree__submit', attrs: { type: 'submit' } });
  const supplierStatus = el('p', { class: 'cb-numeric-entry__error', attrs: { role: 'alert' } });
  supplierForm.append(supplierTitle, supplierHint, substanceLabel, substanceSelect, massLabel, massInput, submit, supplierStatus);

  section.append(registerFieldset, languageFieldset, togglesRow, difficultySection, supplierForm);
  root.append(section);

  function applyCopy(): void {
    title.textContent = context.t('shell.nav.settings');
    registerLegend.textContent = context.t('shell.settings.registerLabel');
    languageLegend.textContent = context.t('shell.settings.languageLabel');
    for (const label of registerTrack.querySelectorAll<HTMLElement>('label')) {
      const key = label.dataset.key;
      const span = label.querySelector('span');
      if (key && span) span.textContent = context.t(key);
    }
    for (const label of languageTrack.querySelectorAll<HTMLElement>('label')) {
      const key = label.dataset.key;
      const span = label.querySelector('span');
      if (key && span) span.textContent = context.t(key);
    }
    const reducedMotionSpan = reducedMotionLabel.querySelector('span');
    if (reducedMotionSpan) reducedMotionSpan.textContent = context.t('settings.reducedMotion');
    const mutedSpan = mutedLabel.querySelector('span');
    if (mutedSpan) mutedSpan.textContent = context.t('settings.muted');

    difficultyTitle.textContent = context.t('difficulty.title');
    difficultyNote.textContent = context.t('shell.settings.difficultyNote');
    presetList.replaceChildren(...DIFFICULTY_PRESET_KEYS.map((key) => el('li', { text: context.t(key) })));
    knobList.replaceChildren(...DIFFICULTY_KNOB_KEYS.map((key) => el('li', { text: context.t(key) })));

    supplierTitle.textContent = context.t('difficulty.callSupplier');
    supplierHint.textContent = context.t('difficulty.callSupplierHint');
    substanceLabel.textContent = context.t('shell.settings.callSupplierSubstance');
    massLabel.textContent = context.t('shell.settings.callSupplierMass', { unit: context.t('unit.gram') });
    submit.textContent = context.t('difficulty.callSupplier');
  }

  function render(): void {
    const preferences = context.preferences();
    for (const [value, input] of registerInputs) input.checked = value === preferences.register;
    for (const [value, input] of languageInputs) input.checked = value === preferences.language;
    reducedMotionInput.checked = preferences.reducedMotion;
    mutedInput.checked = preferences.muted;
  }

  supplierForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleCallSupplier();
  });

  async function handleCallSupplier(): Promise<void> {
    const massUg = parseWholeGramsToMicrograms(massInput.value);
    if (massUg === null || massUg <= 0n) {
      const message = context.t('shell.settings.callSupplierInvalidMass');
      supplierStatus.textContent = message;
      context.announce(message, 'assertive');
      return;
    }
    const substanceId = substanceSelect.value;
    const command: Command = { kind: 'callSupplier', substanceId, massUg: massUg.toString(10) };
    const result = await context.send(command);
    if (!result.accepted) {
      const message = context.t('refusal.generic', { reason: result.reason ?? '' });
      supplierStatus.textContent = message;
      context.announce(message, 'assertive');
      return;
    }
    supplierStatus.textContent = context.t('shell.settings.callSupplierAccepted', { substance: substanceId });
    context.announce(supplierStatus.textContent, 'polite');
  }

  const unsubscribePreferences = context.onPreferences(() => {
    applyCopy();
    render();
  });

  applyCopy();
  render();

  return () => {
    unsubscribePreferences();
    section.remove();
  };
};
