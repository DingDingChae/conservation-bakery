/**
 * The navigation rail: one button per machine, grouped by process stage, plus a filter
 * and Ancestry, Balance and Settings.
 *
 * The plant this rail lists grew from two machines to eleven (see
 * `sim-worker/plant.ts`'s doc comment: a mill, a creamery, a refinery, a mixer, three
 * differently-mechanised ovens, a cooling tunnel, a wrapper, a QA lab, a sales office),
 * and is intended to keep growing. A flat list of eleven-plus buttons stops being
 * scannable fast, so this module does two things the two-machine rail never needed:
 *
 * - **Groups** machines by process stage (`shell/logic.ts`'s `groupMachines`), each
 *   group a labelled `<section>` with its own `<h3>` heading, so "which oven was I
 *   looking at" is a glance at one short list, not the whole plant.
 * - **Filters** the list from a text field (`matchesMachineFilter`), with the match
 *   count announced to assistive technology on every keystroke, so a player who knows
 *   a machine's name does not have to scan groups to find it. Filtering never removes
 *   Ancestry, Balance or Settings — only machines are ever hidden.
 *
 * It also registers one command-palette entry per machine (`context.registerCommands`)
 * so the same "find a machine by name" job is available from the palette too — the
 * palette already exists (`palette/palette.ts`) and already has its own fuzzy search;
 * this rail does not reimplement that, it just hands the palette real entries to search.
 *
 * Selecting a machine or Ancestry hands off to `layout.ts` via `onSelect`, which owns
 * what actually mounts in the main area — this module only ever renders the list and
 * reports a click, exactly the "shell owns layout" split `context.ts` describes.
 * Balance is not a screen (the balance panel is always visible — see `layout.ts`), so
 * its entry calls `onJumpToBalance` (owned by `layout.ts`, which alone knows where the
 * balance panel actually sits) rather than a screen-changing `onSelect`.
 */

import type { MachineSnapshot, WorldSnapshot } from '../../shared/ipc.js';
import type { Disposable, PaletteEntry, RendererContext } from '../context.js';
import { el } from '../kit/dom.js';
import {
  groupMachines,
  machineGroupCatalogueKey,
  matchesMachineFilter,
  screenEquals,
  screenNavId,
  type ScreenId,
} from './logic.js';

export interface NavRailHandle {
  /** Update which entry is shown as current — called by `layout.ts` whenever the
   * active screen changes for any reason, including one a nav click did not cause
   * (a `reveal()` from the command palette, or the global annunciator). */
  readonly setActive: (screen: ScreenId) => void;
  readonly dispose: Disposable;
}

interface NavEntry {
  readonly screen: ScreenId;
  readonly button: HTMLButtonElement;
  /** `null` for Ancestry/Settings — the filter never hides them, only machines. */
  readonly li: HTMLLIElement | null;
  readonly label: string;
}

export function mountNavRail(
  root: HTMLElement,
  context: RendererContext,
  onSelect: (screen: ScreenId) => void,
  onJumpToBalance: () => void,
): NavRailHandle {
  const nav = el('nav', { class: 'cb-shell-nav', attrs: { 'aria-label': context.t('shell.nav.title') } });
  const heading = el('p', { class: 'cb-shell-nav__heading' });
  const searchLabel = el('label', { attrs: { for: 'cb-shell-nav-search' } });
  const searchInput = el('input', {
    attrs: { type: 'search', id: 'cb-shell-nav-search', autocomplete: 'off' },
  }) as HTMLInputElement;
  const searchStatus = el('p', { attrs: { 'aria-live': 'polite' } });
  const groupsContainer = el('div', { class: 'cb-shell-nav__groups' });
  const otherList = el('ul', { class: 'cb-shell-nav__list' });
  nav.append(heading, searchLabel, searchInput, searchStatus, groupsContainer, otherList);
  root.append(nav);

  let entries: NavEntry[] = [];
  let knownMachineIds: readonly string[] | null = null;
  let active: ScreenId = { kind: 'settings' };
  let filterQuery = '';
  let unregisterPalette: Disposable | null = null;

  function buildButton(screen: ScreenId, label: string): HTMLButtonElement {
    const button = el('button', {
      class: 'cb-shell-nav__button',
      attrs: { type: 'button', id: `nav-${screenNavId(screen)}` },
      text: label,
    }) as HTMLButtonElement;
    button.addEventListener('click', () => onSelect(screen));
    return button;
  }

  function applyFilter(): void {
    let visibleCount = 0;
    for (const entry of entries) {
      if (!entry.li) continue; // Ancestry/Settings are never filtered out.
      const visible = matchesMachineFilter(entry.label, filterQuery);
      entry.li.hidden = !visible;
      if (visible) visibleCount += 1;
    }
    for (const section of groupsContainer.querySelectorAll<HTMLElement>('[data-cb-nav-group]')) {
      const anyVisible = [...section.querySelectorAll('li')].some((li) => !(li as HTMLLIElement).hidden);
      section.hidden = !anyVisible;
    }
    searchStatus.textContent =
      filterQuery.trim().length > 0 ? context.t('shell.nav.search.resultsCount', { count: visibleCount }) : '';
  }

  function buildMachineButtons(snapshot: WorldSnapshot | null): void {
    groupsContainer.replaceChildren();
    const machineEntries: NavEntry[] = [];

    for (const { group, machines } of groupMachines(snapshot?.machines ?? [])) {
      const headingId = `cb-shell-nav-group-${group}`;
      const groupHeading = el('h3', {
        class: 'cb-shell-nav__heading',
        attrs: { id: headingId },
        text: context.t(machineGroupCatalogueKey(group)),
      });
      const list = el('ul', { class: 'cb-shell-nav__list' });
      for (const machine of machines) {
        const screen: ScreenId = { kind: 'machine', machineId: machine.id };
        const button = buildButton(screen, machine.label);
        const li = el('li', { children: [button] }) as HTMLLIElement;
        list.append(li);
        machineEntries.push({ screen, button, li, label: machine.label });
      }
      const section = el('section', {
        attrs: { 'aria-labelledby': headingId, 'data-cb-nav-group': group },
        children: [groupHeading, list],
      });
      groupsContainer.append(section);
    }

    entries = [...machineEntries, ...otherEntries()];
    applyActive();
    applyFilter();
    registerPaletteEntries(snapshot?.machines ?? []);
  }

  function registerPaletteEntries(machines: readonly MachineSnapshot[]): void {
    unregisterPalette?.();
    const paletteEntries: PaletteEntry[] = machines.map((machine) => ({
      id: `nav:machine:${machine.id}`,
      label: context.t('shell.nav.openMachine', { machine: machine.label }),
      group: context.t('palette.groupMachines'),
      keywords: [machine.id],
      run: () => onSelect({ kind: 'machine', machineId: machine.id }),
    }));
    unregisterPalette = context.registerCommands(paletteEntries);
  }

  let ancestryButton: HTMLButtonElement | null = null;
  let settingsButton: HTMLButtonElement | null = null;
  let balanceButton: HTMLButtonElement | null = null;

  function otherEntries(): NavEntry[] {
    const list: NavEntry[] = [];
    if (ancestryButton) list.push({ screen: { kind: 'provenance-tree' }, button: ancestryButton, li: null, label: '' });
    if (settingsButton) list.push({ screen: { kind: 'settings' }, button: settingsButton, li: null, label: '' });
    return list;
  }

  function buildStaticButtons(): void {
    otherList.replaceChildren();
    ancestryButton = buildButton({ kind: 'provenance-tree' }, context.t('shell.nav.ancestry'));
    settingsButton = buildButton({ kind: 'settings' }, context.t('shell.nav.settings'));
    balanceButton = el('button', {
      class: 'cb-shell-nav__button',
      attrs: { type: 'button' },
      text: context.t('shell.nav.balance'),
    }) as HTMLButtonElement;
    balanceButton.addEventListener('click', () => onJumpToBalance());
    otherList.append(
      el('li', { children: [ancestryButton] }),
      el('li', { children: [settingsButton] }),
      el('li', { children: [balanceButton] }),
    );
  }

  function applyActive(): void {
    for (const entry of entries) {
      const isActive = screenEquals(entry.screen, active);
      entry.button.setAttribute('aria-current', isActive ? 'page' : 'false');
      entry.button.classList.toggle('cb-shell-nav__button--active', isActive);
    }
  }

  function applyCopy(): void {
    heading.textContent = context.t('shell.nav.title');
    nav.setAttribute('aria-label', context.t('shell.nav.title'));
    searchLabel.textContent = context.t('shell.nav.search.label');
    searchInput.setAttribute('placeholder', context.t('shell.nav.search.placeholder'));
    buildStaticButtons();
    buildMachineButtons(context.snapshot());
  }

  function machineIdsChanged(snapshot: WorldSnapshot | null): boolean {
    const ids = snapshot?.machines.map((machine) => machine.id) ?? [];
    if (!knownMachineIds || knownMachineIds.length !== ids.length) return true;
    return !knownMachineIds.every((id, index) => id === ids[index]);
  }

  searchInput.addEventListener('input', () => {
    filterQuery = searchInput.value;
    applyFilter();
  });

  const unsubscribeSnapshot = context.subscribe((snapshot) => {
    if (machineIdsChanged(snapshot)) {
      knownMachineIds = snapshot.machines.map((machine) => machine.id);
      buildMachineButtons(snapshot);
    }
  });
  const unsubscribePreferences = context.onPreferences(() => applyCopy());

  applyCopy();
  knownMachineIds = context.snapshot()?.machines.map((machine) => machine.id) ?? [];

  return {
    setActive: (screen: ScreenId) => {
      active = screen;
      applyActive();
    },
    dispose: () => {
      unsubscribeSnapshot();
      unsubscribePreferences();
      unregisterPalette?.();
      nav.remove();
    },
  };
}
