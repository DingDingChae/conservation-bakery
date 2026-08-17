/**
 * The command palette — Ctrl+Shift+F, the one way to find anything.
 *
 * Mirrors the markup and class names of
 * packages/design/components/command-palette.html, wired against the real renderer
 * seam instead of a static command list. A native `<dialog>` is used specifically so
 * focus trapping, an inert background, and Escape-to-close come from the platform
 * (`showModal()`), not from hand-rolled focus management.
 *
 * Filtering has two layers: `match.ts`'s plain-text ranked search is the default, and
 * flipping "use a pattern" hands filtering to `regex.ts`'s anchored builder instead,
 * with its own live preview and its own error/backtracking surface. Either way this
 * module never learns *how* an entry accomplishes what it says — that is entirely
 * `PaletteEntry.run`'s business, registered by whichever panel owns the target.
 */

import type { Disposable, PaletteEntry, RendererContext } from '../context.js';
import { el } from '../kit/dom.js';

import { builtinPaletteEntries } from './commands.js';
import { rankEntries } from './match.js';
import { buildPattern, previewMatches, type PatternMode } from './regex.js';

const PATTERN_MODES: readonly { readonly mode: PatternMode; readonly translationKey: string }[] = [
  { mode: 'contains', translationKey: 'palette.patternMode.contains' },
  { mode: 'literal', translationKey: 'palette.patternMode.literal' },
  { mode: 'prefix', translationKey: 'palette.patternMode.prefix' },
  { mode: 'suffix', translationKey: 'palette.patternMode.suffix' },
  { mode: 'wholeWord', translationKey: 'palette.patternMode.wholeWord' },
  { mode: 'regex', translationKey: 'palette.patternMode.regex' },
];

interface ResultGroup {
  readonly group: string;
  readonly entries: readonly PaletteEntry[];
}

/**
 * Groups an already-ranked list by `entry.group` without re-sorting: the group holding
 * the best-ranked entry keeps appearing first, and entries keep their relative rank
 * order within their group. Group headers are visual separators only, never a
 * selectable option.
 */
function groupResults(ranked: readonly PaletteEntry[]): readonly ResultGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, PaletteEntry[]>();
  for (const entry of ranked) {
    const existing = byGroup.get(entry.group);
    if (existing) {
      existing.push(entry);
    } else {
      byGroup.set(entry.group, [entry]);
      order.push(entry.group);
    }
  }
  return order.map((group) => ({ group, entries: byGroup.get(group) ?? [] }));
}

function optionId(entryId: string): string {
  return `cb-palette-option-${entryId}`;
}

export function mountPalette(root: HTMLElement, context: RendererContext): Disposable {
  const title = el('p', {
    class: 'cb-command-palette__title',
    attrs: { id: 'cb-palette-title' },
    text: context.t('palette.title'),
  });

  // The input's placeholder text also serves as its accessible name (via the hidden
  // label below) — one string, one key, rather than a second near-duplicate to keep in
  // sync with it.
  const placeholderText = context.t('palette.placeholder');

  const inputLabel = el('label', {
    class: 'cb-visually-hidden',
    attrs: { for: 'cb-palette-input' },
    text: placeholderText,
  });

  const input = el('input', {
    class: 'cb-command-palette__input',
    attrs: {
      type: 'text',
      id: 'cb-palette-input',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'cb-palette-list',
      'aria-autocomplete': 'list',
      autocomplete: 'off',
      placeholder: placeholderText,
    },
  });

  const patternToggle = el('input', { attrs: { type: 'checkbox', id: 'cb-palette-pattern-toggle' } });
  const patternToggleLabel = el('label', {
    children: [patternToggle, el('span', { text: context.t('palette.usePattern') })],
  });

  const patternLegend = el('legend', {
    class: 'cb-visually-hidden',
    text: context.t('palette.patternMode.legend'),
  });

  const modeInputs = new Map<PatternMode, HTMLInputElement>();
  const modeLabels = PATTERN_MODES.map(({ mode, translationKey }) => {
    const radio = el('input', { attrs: { type: 'radio', name: 'cb-palette-pattern-mode', value: mode } });
    radio.checked = mode === 'contains';
    modeInputs.set(mode, radio);
    return el('label', { children: [radio, el('span', { text: context.t(translationKey) })] });
  });

  const caseToggle = el('input', { attrs: { type: 'checkbox', id: 'cb-palette-pattern-case' } });
  const caseLabel = el('label', {
    children: [caseToggle, el('span', { text: context.t('palette.caseSensitive') })],
  });

  const patternControls = el('fieldset', {
    class: 'cb-command-palette__pattern-controls',
    attrs: { id: 'cb-palette-pattern-controls' },
    children: [patternLegend, ...modeLabels, caseLabel],
  });
  patternControls.hidden = true;

  const patternRow = el('div', {
    class: 'cb-command-palette__pattern',
    children: [patternToggleLabel, patternControls],
  });

  const status = el('p', {
    class: 'cb-command-palette__status',
    attrs: { id: 'cb-palette-status', 'data-error': 'false' },
  });

  const header = el('div', {
    class: 'cb-command-palette__header',
    children: [title, inputLabel, input, patternRow, status],
  });

  const list = el('ul', {
    class: 'cb-command-palette__list',
    attrs: { id: 'cb-palette-list', role: 'listbox', 'aria-labelledby': 'cb-palette-title' },
  });

  const hint = el('p', { class: 'cb-command-palette__hint', text: context.t('palette.hint') });
  const closeButton = el('button', {
    class: 'cb-command-palette__close',
    attrs: { type: 'button' },
    text: context.t('palette.close'),
  });
  const footer = el('div', { class: 'cb-command-palette__footer', children: [hint, closeButton] });

  const dialog = el('dialog', {
    class: 'cb-command-palette',
    attrs: { 'aria-labelledby': 'cb-palette-title' },
    children: [header, list, footer],
  });
  root.appendChild(dialog);

  let activeId: string | null = null;
  let visible: readonly PaletteEntry[] = [];
  let lastFocused: Element | null = null;

  function currentPatternMode(): PatternMode {
    for (const [mode, radio] of modeInputs) {
      if (radio.checked) return mode;
    }
    return 'contains';
  }

  function optionIds(): readonly string[] {
    return Array.from(list.querySelectorAll<HTMLLIElement>('[role="option"]')).map((option) => option.id);
  }

  function setActive(id: string | null): void {
    activeId = id;
    for (const option of list.querySelectorAll<HTMLLIElement>('[role="option"]')) {
      option.setAttribute('aria-selected', String(option.id === id));
    }
    if (id) {
      input.setAttribute('aria-activedescendant', id);
      document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function moveActive(delta: 1 | -1): void {
    const ids = optionIds();
    if (ids.length === 0) return;
    const currentIndex = activeId ? ids.indexOf(activeId) : -1;
    const nextIndex =
      currentIndex === -1 ? (delta === 1 ? 0 : ids.length - 1) : (currentIndex + delta + ids.length) % ids.length;
    setActive(ids[nextIndex] ?? null);
  }

  function moveToEdge(edge: 'first' | 'last'): void {
    const ids = optionIds();
    if (ids.length === 0) return;
    setActive(edge === 'first' ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null));
  }

  function buildOption(entry: PaletteEntry, id: string): HTMLLIElement {
    const option = el('li', {
      class: 'cb-command-palette__option',
      attrs: { id, role: 'option', 'aria-selected': String(id === activeId) },
      text: entry.label,
    });
    option.addEventListener('click', () => runEntry(entry));
    return option;
  }

  function renderList(ranked: readonly PaletteEntry[]): void {
    const groups = groupResults(ranked);
    const flat = groups.flatMap((group) => group.entries);
    const first = flat[0];
    activeId = first ? optionId(first.id) : null;

    const items: HTMLLIElement[] =
      groups.length === 0
        ? [el('li', { class: 'cb-command-palette__empty', text: context.t('palette.noResults') })]
        : groups.flatMap((group) => [
            el('li', {
              class: 'cb-command-palette__group',
              attrs: { role: 'presentation' },
              text: group.group,
            }),
            ...group.entries.map((entry) => buildOption(entry, optionId(entry.id))),
          ]);

    list.replaceChildren(...items);

    if (activeId) {
      input.setAttribute('aria-activedescendant', activeId);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function render(): void {
    const all = [...context.paletteEntries(), ...builtinPaletteEntries(context)];
    const usePattern = patternToggle.checked;
    let ranked: readonly PaletteEntry[];
    let statusText: string;
    let isError = false;

    if (usePattern) {
      const result = buildPattern(input.value, {
        mode: currentPatternMode(),
        caseSensitive: caseToggle.checked,
      });
      if (result.ok) {
        ranked = previewMatches(all, result.regex);
        statusText = context.t('palette.resultCount', { count: ranked.length });
      } else {
        ranked = [];
        statusText = result.reason;
        isError = true;
      }
    } else {
      ranked = rankEntries(all, input.value);
      statusText = context.t('palette.resultCount', { count: ranked.length });
    }

    visible = ranked;
    status.textContent = statusText;
    status.setAttribute('data-error', String(isError));
    context.announce(statusText, isError ? 'assertive' : 'polite');

    renderList(ranked);
  }

  function runEntry(entry: PaletteEntry): void {
    close();
    void Promise.resolve(entry.run()).catch(() => {
      context.announce(context.t('palette.runFailed', { label: entry.label }), 'assertive');
    });
  }

  function resetControls(): void {
    input.value = '';
    patternToggle.checked = false;
    patternControls.hidden = true;
    caseToggle.checked = false;
    for (const [mode, radio] of modeInputs) {
      radio.checked = mode === 'contains';
    }
  }

  function open(): void {
    if (dialog.open) return;
    lastFocused = document.activeElement;
    resetControls();
    dialog.showModal();
    render();
    input.focus();
  }

  function close(): void {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
    lastFocused = null;
  });

  closeButton.addEventListener('click', close);

  input.addEventListener('input', render);
  patternToggle.addEventListener('change', () => {
    patternControls.hidden = !patternToggle.checked;
    render();
  });
  caseToggle.addEventListener('change', render);
  for (const modeInput of modeInputs.values()) {
    modeInput.addEventListener('change', render);
  }

  input.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        moveToEdge('first');
        break;
      case 'End':
        event.preventDefault();
        moveToEdge('last');
        break;
      case 'Enter': {
        event.preventDefault();
        const entry = visible.find((candidate) => optionId(candidate.id) === activeId);
        if (entry) runEntry(entry);
        break;
      }
      default:
        break;
    }
  });

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.shiftKey && (event.key === 'F' || event.key === 'f')) {
      event.preventDefault();
      open();
    }
  }
  document.addEventListener('keydown', handleGlobalKeydown);

  return () => {
    document.removeEventListener('keydown', handleGlobalKeydown);
    close();
    dialog.remove();
  };
}
