/**
 * The navigation rail: one button per machine, plus Ancestry, Balance and Settings.
 * Selecting a machine or Ancestry hands off to `layout.ts` via `onSelect`, which owns
 * what actually mounts in the main area — this module only ever renders the list and
 * reports a click, exactly the "shell owns layout" split `context.ts` describes.
 * Balance is not a screen (the balance panel is always visible — see `layout.ts`), so
 * its entry calls `onJumpToBalance` (owned by `layout.ts`, which alone knows where the
 * balance panel actually sits) rather than a screen-changing `onSelect`.
 */

import type { WorldSnapshot } from '../../shared/ipc.js';
import type { Disposable, RendererContext } from '../context.js';
import { el } from '../kit/dom.js';
import { screenEquals, screenNavId, type ScreenId } from './logic.js';

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
}

export function mountNavRail(
  root: HTMLElement,
  context: RendererContext,
  onSelect: (screen: ScreenId) => void,
  onJumpToBalance: () => void,
): NavRailHandle {
  const nav = el('nav', { class: 'cb-shell-nav', attrs: { 'aria-label': context.t('shell.nav.title') } });
  const heading = el('p', { class: 'cb-shell-nav__heading' });
  const machineList = el('ul', { class: 'cb-shell-nav__list' });
  const otherList = el('ul', { class: 'cb-shell-nav__list' });
  nav.append(heading, machineList, otherList);
  root.append(nav);

  let entries: NavEntry[] = [];
  let knownMachineIds: readonly string[] | null = null;
  let active: ScreenId = { kind: 'settings' };

  function buildButton(screen: ScreenId, label: string): HTMLButtonElement {
    const button = el('button', {
      class: 'cb-shell-nav__button',
      attrs: { type: 'button', id: `nav-${screenNavId(screen)}` },
      text: label,
    }) as HTMLButtonElement;
    button.addEventListener('click', () => onSelect(screen));
    return button;
  }

  function buildMachineButtons(snapshot: WorldSnapshot | null): void {
    machineList.replaceChildren();
    const next: NavEntry[] = [];
    for (const machine of snapshot?.machines ?? []) {
      const screen: ScreenId = { kind: 'machine', machineId: machine.id };
      const button = buildButton(screen, machine.label);
      const li = el('li', { children: [button] });
      machineList.append(li);
      next.push({ screen, button });
    }
    entries = [...next, ...otherEntries()];
    applyActive();
  }

  let ancestryButton: HTMLButtonElement | null = null;
  let settingsButton: HTMLButtonElement | null = null;
  let balanceButton: HTMLButtonElement | null = null;

  function otherEntries(): NavEntry[] {
    const list: NavEntry[] = [];
    if (ancestryButton) list.push({ screen: { kind: 'provenance-tree' }, button: ancestryButton });
    if (settingsButton) list.push({ screen: { kind: 'settings' }, button: settingsButton });
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
    buildStaticButtons();
    buildMachineButtons(context.snapshot());
  }

  function machineIdsChanged(snapshot: WorldSnapshot | null): boolean {
    const ids = snapshot?.machines.map((machine) => machine.id) ?? [];
    if (!knownMachineIds || knownMachineIds.length !== ids.length) return true;
    return !knownMachineIds.every((id, index) => id === ids[index]);
  }

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
      nav.remove();
    },
  };
}
