/**
 * The control room header: the simulated clock, the speed control (pause / 1x / 5x /
 * 60x), and the global alarm annunciator — one tile standing for every alarm on every
 * machine, so a player on the Settings screen still sees a cascade the instant it
 * starts. Built from `packages/design`'s own components (the label strip for the
 * clock, the mode-selector track for speed, the annunciator tile for the alarm
 * summary) — see `packages/design/README.md`: no second visual language.
 *
 * This module only observes `RendererContext.subscribe` and requests `setSpeed`; it
 * never mutates simulation state directly. Clicking the annunciator tile calls
 * `context.reveal({ kind: 'alarm', ... })` for the single most urgent alarm — the
 * shell's own reveal handler (`layout.ts`) does the work of switching the main area to
 * that machine before the alarm itself is focused.
 */

import type { Command, SpeedMultiplier, WorldSnapshot } from '../../shared/ipc.js';
import type { Disposable, RendererContext } from '../context.js';
import { el } from '../kit/dom.js';
import { aggregateAlarms, formatSimulatedClock, speedCatalogueKey, SPEED_OPTIONS } from './logic.js';

const ALARM_ICON: Readonly<Record<string, string>> = {
  normal: '○',
  'active-unacknowledged': '▲',
  'active-acknowledged': '■',
  cleared: '◆',
};

export function mountHeader(root: HTMLElement, context: RendererContext): Disposable {
  const bar = el('header', { class: 'cb-shell-header', attrs: { role: 'banner' } });

  const titleStrip = el('div', { class: 'cb-label-strip' });
  const titleText = el('span', { class: 'cb-label-strip__text' });
  titleStrip.append(titleText);

  const clock = el('p', { class: 'cb-shell-header__clock', attrs: { 'aria-live': 'off' } });

  const speedFieldset = el('fieldset', { class: ['cb-mode-selector', 'cb-shell-header__speed'] });
  const speedLegend = el('legend', { class: 'cb-mode-selector__legend' });
  const speedTrack = el('div', { class: 'cb-mode-selector__track' });
  const speedInputs = new Map<SpeedMultiplier, HTMLInputElement>();
  for (const speed of SPEED_OPTIONS) {
    const inputId = `shell-speed-${speed}`;
    const input = el('input', {
      attrs: { type: 'radio', name: 'shell-speed', value: String(speed), id: inputId },
    }) as HTMLInputElement;
    const label = el('label', { class: 'cb-mode-selector__option', attrs: { for: inputId } });
    const captionSpan = el('span', {});
    label.append(input, captionSpan);
    speedTrack.append(label);
    speedInputs.set(speed, input);
    input.addEventListener('change', () => {
      void handleSpeedChange(speed);
    });
  }
  speedFieldset.append(speedLegend, speedTrack);
  const speedStatus = el('p', { class: 'cb-numeric-entry__error', attrs: { role: 'alert' } });

  const annunciator = el('button', {
    class: 'cb-annunciator-tile cb-shell-header__annunciator',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  const annunciatorIcon = el('span', { class: 'cb-annunciator-tile__icon', attrs: { 'aria-hidden': 'true' } });
  const annunciatorLabel = el('span', { class: 'cb-annunciator-tile__label' });
  const annunciatorState = el('span', { class: 'cb-annunciator-tile__state' });
  annunciator.append(annunciatorIcon, annunciatorLabel, annunciatorState);

  bar.append(titleStrip, clock, speedFieldset, speedStatus, annunciator);
  root.append(bar);

  let speedRefusalText: string | null = null;

  async function handleSpeedChange(speed: SpeedMultiplier): Promise<void> {
    const command: Command = { kind: 'setSpeed', speed };
    const result = await context.send(command);
    if (!result.accepted) {
      speedRefusalText = context.t('refusal.generic', { reason: result.reason ?? '' });
      speedStatus.textContent = speedRefusalText;
      speedStatus.hidden = false;
      context.announce(speedRefusalText, 'assertive');
      const current = context.snapshot()?.speed ?? 1;
      const stillCurrent = speedInputs.get(current);
      if (stillCurrent) stillCurrent.checked = true;
    } else {
      speedRefusalText = null;
      speedStatus.hidden = true;
    }
  }

  function applyCopy(): void {
    titleText.textContent = context.t('shell.appTitle');
    speedLegend.textContent = context.t('speed.label');
    annunciatorLabel.textContent = context.t('shell.header.annunciatorLabel');
    for (const [speed, input] of speedInputs) {
      const caption = input.nextElementSibling;
      if (caption) caption.textContent = context.t(speedCatalogueKey(speed));
    }
    speedStatus.textContent = speedRefusalText ?? '';
    speedStatus.hidden = !speedRefusalText;
  }

  function render(snapshot: WorldSnapshot | null): void {
    if (!snapshot) {
      clock.textContent = context.t('shell.header.noSnapshot');
      return;
    }
    const clockText = formatSimulatedClock(snapshot.simulatedTime);
    clock.textContent = context.t('shell.header.clock', { time: clockText, tick: snapshot.tick });

    for (const [speed, input] of speedInputs) input.checked = speed === snapshot.speed;

    const aggregate = aggregateAlarms(snapshot.machines);
    const state = aggregate.worst?.state ?? 'normal';
    annunciator.dataset.state = state;
    annunciatorIcon.textContent = ALARM_ICON[state] ?? ALARM_ICON['normal']!;
    const stateText = aggregate.worst
      ? context.t('shell.header.annunciatorActive', {
          machine: aggregate.worst.machineId,
          label: aggregate.worst.label,
          count: aggregate.activeUnacknowledgedCount + aggregate.activeAcknowledgedCount,
        })
      : context.t('shell.header.annunciatorOk');
    annunciatorState.textContent = stateText;
    annunciator.setAttribute('aria-label', `${context.t('shell.header.annunciatorLabel')}: ${stateText}`);
    annunciator.disabled = aggregate.worst === null;
  }

  annunciator.addEventListener('click', () => {
    const snapshot = context.snapshot();
    if (!snapshot) return;
    const aggregate = aggregateAlarms(snapshot.machines);
    if (!aggregate.worst) return;
    context.reveal({ kind: 'alarm', machineId: aggregate.worst.machineId, alarmId: aggregate.worst.id });
  });

  const unsubscribeSnapshot = context.subscribe((snapshot) => render(snapshot));
  const unsubscribePreferences = context.onPreferences(() => {
    applyCopy();
    render(context.snapshot());
  });

  applyCopy();
  render(context.snapshot());

  return () => {
    unsubscribeSnapshot();
    unsubscribePreferences();
    bar.remove();
  };
}
