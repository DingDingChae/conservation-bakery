/**
 * Faceplate: DOM rendering.
 *
 * Builds the machine faceplate described in `packages/design/components/faceplate.html`
 * out of the same component markup and the same class names as every other design
 * preview — a panel frame, a label strip, an annunciator strip, a mode selector, one
 * setpoint/process-value readout and one trend recorder per tag, and a numeric entry
 * for every tag that has a setpoint. Nothing here invents a second visual language;
 * see `packages/design/README.md`.
 *
 * Copy: wherever `renderer/i18n/catalogue.ts` already defines the right key —
 * `mode.*`, `alarm.*`, `refusal.*`, `palette.group*` — this module uses it, so a mode
 * name or an alarm state reads identically on every faceplate and every other panel
 * that shows one. The setpoint/process-value readout and the trend recorder have no
 * equivalent shared keys yet (checked against `CATALOGUE_KEYS` in `catalogue.ts` at
 * the time this was written), so this module defines its own `faceplate.*` keys the
 * same way `renderer/palette/palette.ts` already does for keys the shared catalogue
 * does not yet carry (e.g. `palette.filterLabel`) — every one of them still goes
 * through `context.t`, so Kid-register and Cantonese copy can be added to the four
 * catalogue files later without touching this module. `tag.label`/`machine.label`
 * themselves arrive over `shared/ipc.ts` as plain, already-rendered English text with
 * no per-register variant available at this seam, so they are shown as-is in every
 * register — see this task's final report for why a per-tag Kid rewrite (CLAUDE.md's
 * "TOP HEAT SP" example) is not implemented here.
 *
 * DOM rendering in this module is not unit-tested directly, but it is exercised for
 * real by `renderer/__smoke__/mount.spec.ts` (`happy-dom`, added to this repository
 * since this module was first written), which mounts the real shell — this faceplate
 * included — for every register/language combination and fails on a thrown error or a
 * `⟦missing:…⟧` placeholder anywhere in the tree. Every piece of logic that *can* be
 * tested without a DOM at all — formatting, range validation, mode-transition
 * legality, alarm ordering, unit and refusal-reason translation, trend geometry —
 * still lives in `logic.ts` and is exercised directly by `logic.spec.ts`.
 */

import type {
  AlarmSnapshot,
  AlarmState,
  Command,
  CommandResult,
  MachineMode,
  MachineSnapshot,
  TagSnapshot,
  WorldSnapshot,
} from '../../shared/ipc.js';
import type { Disposable, Panel, PaletteEntry, RendererContext, RevealTarget } from '../context.js';
import { el } from '../kit/dom.js';
import { focusVisibly } from '../kit/focus.js';
import {
  alarmStateCatalogueKey,
  alarmTransitionAnnouncement,
  availableAlarmAction,
  barMarkerPercent,
  describeRefusal,
  deviationStatus,
  formatEngineeringValue,
  formatRange,
  modeCatalogueKey,
  modeTransitionRefusal,
  MODE_ORDER,
  orderAlarms,
  pointsAttribute,
  pushTrendSample,
  sanitizeDomId,
  scaleTrendSeries,
  trendDomain,
  unitCatalogueKey,
  validateSetpointInput,
  type ModeRefusal,
  type SetpointValidation,
  type TrendSample,
} from './logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TREND_MAX_SAMPLES = 60;
const TREND_VIEWPORT = { width: 460, height: 160, topPadding: 10, bottomPadding: 10 } as const;

/** CSS-free visibility hiding for text meant for assistive technology only.
 * `packages/design` ships `cb-visually-hidden` only inside its preview harness
 * stylesheet (`components/shared/preview.css`'s own header says explicitly that file
 * "is NOT part of the design language") — not a component stylesheet a real build is
 * guaranteed to load — so the faceplate applies the identical, well-known technique
 * inline instead of depending on a class that may not exist at runtime. */
function hideVisually(element: HTMLElement): void {
  element.style.position = 'absolute';
  element.style.width = '1px';
  element.style.height = '1px';
  element.style.padding = '0';
  element.style.margin = '-1px';
  element.style.overflow = 'hidden';
  element.style.clip = 'rect(0, 0, 0, 0)';
  element.style.whiteSpace = 'nowrap';
  element.style.border = '0';
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

/**
 * Renders the faceplate for one specific machine, regardless of what else is on
 * screen — the factory for a shell that already knows which machine a given screen
 * belongs to.
 */
export function createFaceplatePanel(machineId: string): Panel {
  return (root, context) => mountFaceplate(root, context, machineId);
}

/**
 * The default faceplate `Panel`: shows the first machine in the current snapshot,
 * and follows a `reveal({ kind: 'machine', ... })` request to any other machine —
 * for a shell slot that does not know ahead of time which machine belongs there
 * (e.g. the one the command palette teleports into).
 */
export const faceplatePanel: Panel = (root, context) => {
  let disposeCurrent: Disposable | null = null;
  let currentMachineId: string | null = null;

  function mount(machineId: string): void {
    if (machineId === currentMachineId) return;
    disposeCurrent?.();
    currentMachineId = machineId;
    disposeCurrent = mountFaceplate(root, context, machineId);
  }

  function pickInitialMachine(snapshot: WorldSnapshot | null): void {
    if (currentMachineId !== null || !snapshot) return;
    const first = snapshot.machines[0];
    if (first) mount(first.id);
  }

  pickInitialMachine(context.snapshot());
  const unsubscribe = context.subscribe(pickInitialMachine);

  const unregisterReveal = context.registerRevealHandler((target: RevealTarget) => {
    if (target.kind !== 'machine') return false;
    const snapshot = context.snapshot();
    if (!snapshot?.machines.some((machine) => machine.id === target.machineId)) return false;
    mount(target.machineId);
    return true;
  });

  return () => {
    unsubscribe();
    unregisterReveal();
    disposeCurrent?.();
  };
};

// ---------------------------------------------------------------------------
// The real work: one mounted faceplate for one machine id.
// ---------------------------------------------------------------------------

interface TagRow {
  readonly setpointDd: HTMLElement;
  readonly pvDd: HTMLElement;
  readonly marker: HTMLElement;
  readonly status: HTMLElement;
  readonly rangeHint: HTMLElement;
}
interface EntryRow {
  readonly input: HTMLInputElement;
  readonly hint: HTMLElement;
  readonly error: HTMLElement;
}
interface TrendRow {
  readonly svg: SVGSVGElement;
  readonly title: SVGTitleElement;
  readonly desc: SVGDescElement;
  readonly pvLine: SVGPolylineElement;
  readonly spLine: SVGPolylineElement;
  readonly tableBody: HTMLElement;
}
interface AlarmRow {
  readonly wrapper: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly icon: HTMLElement;
  readonly stateText: HTMLElement;
  readonly actionLabel: HTMLElement;
  readonly meta: HTMLElement;
  readonly reason: HTMLElement;
}

const ALARM_ICON: Readonly<Record<AlarmState, string>> = {
  normal: '○',
  'active-unacknowledged': '▲',
  'active-acknowledged': '■',
  cleared: '◆',
};

function mountFaceplate(root: HTMLElement, context: RendererContext, machineId: string): Disposable {
  const domId = sanitizeDomId(machineId);
  const trendHistory = new Map<string, readonly TrendSample[]>();
  const alarmRefusals = new Map<string, string>();
  const previousAlarmStates = new Map<string, AlarmState>();
  let modeRefusalText: string | null = null;
  let paletteRegistered = false;
  let unregisterCommands: Disposable | null = null;

  /** A tag's unit as it should be shown to the player: routed through the catalogue's
   * `unit.*` keys (`logic.ts`'s `unitCatalogueKey`) for a symbol the catalogue knows —
   * `°C` reads as "degrees" in the Kid register — and the raw symbol unchanged for one
   * it does not (`rpm`, `fraction`), so an unmapped unit is never hidden or invented. */
  function localizedUnit(rawUnit: string): string {
    const key = unitCatalogueKey(rawUnit);
    return key ? context.t(key) : rawUnit;
  }

  const container = el('section', {
    class: 'cb-panel-frame',
    attrs: { 'aria-labelledby': `faceplate-${domId}-title` },
  });
  container.append(
    el('span', { class: ['cb-panel-frame__fastener', 'cb-panel-frame__fastener--tl'], attrs: { 'aria-hidden': 'true' } }),
    el('span', { class: ['cb-panel-frame__fastener', 'cb-panel-frame__fastener--tr'], attrs: { 'aria-hidden': 'true' } }),
    el('span', { class: ['cb-panel-frame__fastener', 'cb-panel-frame__fastener--bl'], attrs: { 'aria-hidden': 'true' } }),
    el('span', { class: ['cb-panel-frame__fastener', 'cb-panel-frame__fastener--br'], attrs: { 'aria-hidden': 'true' } }),
  );

  const header = el('div', { class: 'cb-faceplate__header' });
  const labelStrip = el('div', { class: 'cb-label-strip' });
  const titleSpan = el('span', { class: 'cb-label-strip__text', attrs: { id: `faceplate-${domId}-title` }, text: machineId });
  labelStrip.append(titleSpan);
  const runInfo = el('p', { class: 'cb-numeric-entry__hint' });
  header.append(labelStrip, runInfo);
  container.append(header);

  const notFoundNotice = el('p', {
    class: 'cb-numeric-entry__error',
    attrs: { role: 'alert' },
    text: context.t('faceplate.notFound', { machine: machineId }),
  });
  notFoundNotice.hidden = true;
  container.append(notFoundNotice);

  // --- Alarms -------------------------------------------------------------
  const alarmsSection = el('div', { class: 'cb-faceplate__section' });
  alarmsSection.append(el('p', { class: 'cb-faceplate__section-title', text: context.t('alarm.title') }));
  const alarmsRow = el('div', { class: 'cb-faceplate__row', attrs: { role: 'list' } });
  const alarmsEmpty = el('p', { class: 'cb-numeric-entry__hint', text: context.t('alarm.none') });
  alarmsSection.append(alarmsRow, alarmsEmpty);
  container.append(alarmsSection);

  // --- Mode + one setpoint/process-value readout per tag -------------------
  const modeAndSpvRow = el('div', { class: ['cb-faceplate__section', 'cb-faceplate__row'] });
  const modeColumn = el('div', {});
  modeColumn.append(el('p', { class: 'cb-faceplate__section-title', text: context.t('mode.label') }));
  const modeFieldset = el('fieldset', { class: 'cb-mode-selector' });
  const modeLegend = el('legend', { class: 'cb-mode-selector__legend', text: context.t('mode.legend', { machine: machineId }) });
  const modeTrack = el('div', { class: 'cb-mode-selector__track' });
  const modeInputs = new Map<MachineMode, HTMLInputElement>();
  for (const mode of MODE_ORDER) {
    const inputId = `faceplate-${domId}-mode-${mode}`;
    const input = el('input', {
      attrs: { type: 'radio', name: `faceplate-${domId}-mode`, value: mode, id: inputId },
    }) as HTMLInputElement;
    const label = el('label', { class: 'cb-mode-selector__option', attrs: { for: inputId } });
    label.append(input, el('span', { text: context.t(modeCatalogueKey(mode)) }));
    modeTrack.append(label);
    modeInputs.set(mode, input);
    input.addEventListener('change', () => {
      void handleModeChange(mode);
    });
  }
  modeFieldset.append(modeLegend, modeTrack);
  const modeStatus = el('p', { class: 'cb-numeric-entry__error', attrs: { role: 'alert' } });
  modeColumn.append(modeFieldset, modeStatus);
  modeAndSpvRow.append(modeColumn);
  container.append(modeAndSpvRow);

  const spvSection = el('div', { class: 'cb-faceplate__row' });
  modeAndSpvRow.append(spvSection);

  // --- One numeric entry per tag with a setpoint ---------------------------
  const entrySection = el('div', { class: 'cb-faceplate__section' });
  entrySection.append(el('p', { class: 'cb-faceplate__section-title', text: context.t('faceplate.setpoint.title') }));
  const entryRow = el('div', { class: 'cb-faceplate__row' });
  entrySection.append(entryRow);
  container.append(entrySection);

  // --- One trend recorder per tag ------------------------------------------
  const trendSection = el('div', { class: 'cb-faceplate__section' });
  trendSection.append(el('p', { class: 'cb-faceplate__section-title', text: context.t('faceplate.trend.title') }));
  const trendRow = el('div', { class: 'cb-faceplate__row' });
  trendSection.append(trendRow);
  container.append(trendSection);

  root.append(container);

  let tagRows = new Map<string, TagRow>();
  let entryRows = new Map<string, EntryRow>();
  let trendRows = new Map<string, TrendRow>();
  let alarmRows = new Map<string, AlarmRow>();
  let knownTagIds: readonly string[] | null = null;
  let knownAlarmIds: readonly string[] | null = null;

  function buildAlarmRows(alarms: readonly AlarmSnapshot[]): void {
    alarmsRow.replaceChildren();
    const next = new Map<string, AlarmRow>();
    for (const alarmSnapshot of alarms) {
      const alarmDomId = `faceplate-${domId}-alarm-${sanitizeDomId(alarmSnapshot.id)}`;
      const icon = el('span', { class: 'cb-annunciator-tile__icon', attrs: { 'aria-hidden': 'true' } });
      const label = el('span', { class: 'cb-annunciator-tile__label', text: alarmSnapshot.label });
      const stateText = el('span', { class: 'cb-annunciator-tile__state' });
      // The action verb (Acknowledge/Reset) this tile currently offers, if any — real
      // wording from the catalogue (`alarm.acknowledge`/`alarm.reset`), not left for the
      // icon and state text alone to imply what pressing the tile actually does.
      const actionLabel = el('span', { class: 'cb-annunciator-tile__action' });
      const button = el('button', {
        class: 'cb-annunciator-tile',
        attrs: {
          type: 'button',
          role: 'listitem',
          id: alarmDomId,
          'aria-describedby': `${alarmDomId}-meta ${alarmDomId}-reason`,
        },
      }) as HTMLButtonElement;
      button.append(icon, label, stateText, actionLabel);
      // Priority and the tick this alarm was raised at — real annunciator detail
      // (`alarm.priority`/`alarm.raisedAtTick`), not only the bare state word.
      const meta = el('p', { class: 'cb-numeric-entry__hint', attrs: { id: `${alarmDomId}-meta` } });
      const reason = el('p', {
        class: 'cb-numeric-entry__error',
        attrs: { id: `${alarmDomId}-reason`, role: 'alert' },
      });
      reason.hidden = true;
      const wrapper = el('div', { children: [button, meta, reason] });
      alarmsRow.append(wrapper);
      button.addEventListener('click', () => {
        void handleAlarmAction(alarmSnapshot.id);
      });
      next.set(alarmSnapshot.id, { wrapper, button, icon, stateText, actionLabel, meta, reason });
    }
    alarmRows = next;
  }

  function updateAlarmRows(alarms: readonly AlarmSnapshot[]): void {
    alarmsEmpty.hidden = alarms.length > 0;
    for (const alarmSnapshot of orderAlarms(alarms)) {
      const row = alarmRows.get(alarmSnapshot.id);
      if (!row) continue;
      row.button.dataset.state = alarmSnapshot.state;
      row.icon.textContent = ALARM_ICON[alarmSnapshot.state];
      const stateLabel = context.t(alarmStateCatalogueKey(alarmSnapshot.state));
      row.stateText.textContent = alarmSnapshot.firstOut
        ? `${stateLabel} — ${context.t('alarm.firstOut')}`
        : stateLabel;
      const action = availableAlarmAction(alarmSnapshot.state);
      const actionText = action ? context.t(action === 'acknowledge' ? 'alarm.acknowledge' : 'alarm.reset') : '';
      row.actionLabel.textContent = actionText;
      row.button.setAttribute(
        'aria-label',
        `${alarmSnapshot.label}: ${stateLabel}${alarmSnapshot.firstOut ? `, ${context.t('alarm.firstOut')}` : ''}${actionText ? `, ${actionText}` : ''}`,
      );
      row.button.disabled = action === null;
      row.meta.textContent = [
        context.t('alarm.priority', { priority: alarmSnapshot.priority }),
        context.t('alarm.raisedAtTick', { tick: alarmSnapshot.raisedAtTick }),
      ].join(' · ');
      const reason = alarmRefusals.get(alarmSnapshot.id);
      row.reason.textContent = reason ?? '';
      row.reason.hidden = !reason;
      // Reorder in the DOM to match the annunciator's priority order.
      alarmsRow.append(row.wrapper);

      const previous = previousAlarmStates.get(alarmSnapshot.id);
      const announcement = alarmTransitionAnnouncement(previous, alarmSnapshot.state);
      if (announcement === 'raised') {
        context.announce(context.t('alarm.announceRaised', { label: alarmSnapshot.label }), 'assertive');
      } else if (announcement === 'cleared') {
        context.announce(context.t('alarm.announceCleared', { label: alarmSnapshot.label }), 'polite');
      } else if (announcement === 'acknowledged') {
        context.announce(context.t('alarm.announceAcknowledged', { label: alarmSnapshot.label }), 'polite');
      }
      previousAlarmStates.set(alarmSnapshot.id, alarmSnapshot.state);
    }
  }

  function buildEntryAndSpvRows(tags: readonly TagSnapshot[]): void {
    spvSection.replaceChildren();
    entryRow.replaceChildren();
    trendRow.replaceChildren();
    const nextSpv = new Map<string, TagRow>();
    const nextEntry = new Map<string, EntryRow>();
    const nextTrend = new Map<string, TrendRow>();

    for (const tag of tags) {
      const tagDomId = `faceplate-${domId}-tag-${sanitizeDomId(tag.id)}`;

      // Setpoint/process-value readout.
      const spvTitleId = `${tagDomId}-spv-title`;
      const spv = el('div', { class: 'cb-spv', attrs: { role: 'group', 'aria-labelledby': spvTitleId } });
      const spvTitle = el('span', { attrs: { id: spvTitleId }, text: tag.label });
      hideVisually(spvTitle);
      const setpointDd = el('dd', {});
      const pvDd = el('dd', { attrs: { id: `${tagDomId}-pv` } });
      const values = el('dl', { class: 'cb-spv__values' });
      const spWrap = el('div', { children: [el('dt', { text: context.t('faceplate.tag.sp') }), setpointDd] });
      const pvWrap = el('div', { children: [el('dt', { text: context.t('faceplate.tag.pv') }), pvDd] });
      values.append(spWrap, pvWrap);
      const bar = el('div', { class: 'cb-spv__bar', attrs: { 'aria-hidden': 'true' } });
      const marker = el('span', { class: 'cb-spv__bar-marker' });
      bar.append(marker);
      const status = el('p', { class: 'cb-spv__status', attrs: { 'aria-live': 'polite' } });
      const rangeHint = el('p', { class: 'cb-numeric-entry__hint' });
      spv.append(spvTitle, values, bar, status, rangeHint);
      spvSection.append(spv);
      nextSpv.set(tag.id, { setpointDd, pvDd, marker, status, rangeHint });

      // Numeric setpoint entry — only for a tag that has one.
      if (tag.setpoint !== null) {
        const wrapper = el('div', { class: 'cb-numeric-entry', attrs: { 'data-invalid': 'false' } });
        const inputId = `${tagDomId}-input`;
        const hintId = `${tagDomId}-hint`;
        const errorId = `${tagDomId}-error`;
        const label = el('label', { class: 'cb-numeric-entry__label', attrs: { for: inputId }, text: tag.label });
        const field = el('div', { class: 'cb-numeric-entry__field' });
        const input = el('input', {
          attrs: {
            type: 'number',
            id: inputId,
            min: String(tag.rangeLow),
            max: String(tag.rangeHigh),
            step: 'any',
            inputmode: 'decimal',
            'aria-describedby': `${hintId} ${errorId}`,
          },
        }) as HTMLInputElement;
        const unit = el('span', { class: 'cb-numeric-entry__unit', attrs: { 'aria-hidden': 'true' }, text: localizedUnit(tag.unit) });
        field.append(input, unit);
        const hint = el('p', { class: 'cb-numeric-entry__hint', attrs: { id: hintId } });
        const error = el('p', { class: 'cb-numeric-entry__error', attrs: { id: errorId, role: 'alert' } });
        wrapper.append(label, field, hint, error);
        entryRow.append(wrapper);
        nextEntry.set(tag.id, { input, hint, error });

        input.addEventListener('input', () => {
          const validation = validateSetpointInput(input.value, tag.rangeLow, tag.rangeHigh);
          wrapper.dataset.invalid = String(!validation.ok);
          input.setAttribute('aria-invalid', String(!validation.ok));
          error.textContent = validation.ok ? '' : describeSetpointValidation(validation, localizedUnit(tag.unit));
        });
        input.addEventListener('change', () => {
          void handleSetpointChange(tag.id, input, wrapper, error);
        });
      }

      // Trend recorder.
      const trendFigureId = `${tagDomId}-trend`;
      const titleId = `${trendFigureId}-title`;
      const descId = `${trendFigureId}-desc`;
      const figure = el('figure', { class: 'cb-trend' });
      const svg = svgEl('svg', {
        class: 'cb-trend__svg',
        viewBox: `0 0 ${TREND_VIEWPORT.width + 20} ${TREND_VIEWPORT.height}`,
        role: 'img',
        'aria-labelledby': `${titleId} ${descId}`,
      });
      const title = svgEl('title', { id: titleId });
      const desc = svgEl('desc', { id: descId });
      const axisX = svgEl('line', {
        class: 'cb-trend__axis',
        x1: '0',
        y1: String(TREND_VIEWPORT.height - TREND_VIEWPORT.bottomPadding),
        x2: String(TREND_VIEWPORT.width),
        y2: String(TREND_VIEWPORT.height - TREND_VIEWPORT.bottomPadding),
      });
      const axisY = svgEl('line', {
        class: 'cb-trend__axis',
        x1: '0',
        y1: String(TREND_VIEWPORT.topPadding),
        x2: '0',
        y2: String(TREND_VIEWPORT.height - TREND_VIEWPORT.bottomPadding),
      });
      const spLine = svgEl('polyline', { class: 'cb-trend__series-sp', points: '' });
      const pvLine = svgEl('polyline', { class: 'cb-trend__series-pv', points: '' });
      svg.append(title, desc, axisX, axisY, spLine, pvLine);
      const legend = el('figcaption', { class: 'cb-trend__legend' });
      const pvSwatch = el('span', { class: 'cb-trend__legend-swatch', attrs: { 'aria-hidden': 'true' } });
      const spSwatch = el('span', {
        class: ['cb-trend__legend-swatch', 'cb-trend__legend-swatch--sp'],
        attrs: { 'aria-hidden': 'true' },
      });
      legend.append(
        el('span', { children: [pvSwatch, context.t('faceplate.trend.legendPv', { unit: localizedUnit(tag.unit) })] }),
        el('span', { children: [spSwatch, context.t('faceplate.trend.legendSp', { unit: localizedUnit(tag.unit) })] }),
      );
      figure.append(svg, legend);

      const details = el('details', { class: 'cb-trend__table-toggle' });
      const summary = el('summary', { text: context.t('faceplate.trend.tableToggle') });
      const table = el('table', { class: 'cb-trend__table' });
      const caption = el('caption', { text: context.t('faceplate.trend.tableCaption', { label: tag.label }) });
      const thead = el('thead', {});
      const headRow = el('tr', {
        children: [
          el('th', { attrs: { scope: 'col' }, text: context.t('faceplate.trend.columnTick') }),
          el('th', { attrs: { scope: 'col' }, text: context.t('faceplate.trend.columnSp', { unit: localizedUnit(tag.unit) }) }),
          el('th', { attrs: { scope: 'col' }, text: context.t('faceplate.trend.columnPv', { unit: localizedUnit(tag.unit) }) }),
        ],
      });
      thead.append(headRow);
      const tableBody = el('tbody', {});
      table.append(caption, thead, tableBody);
      details.append(summary, table);

      const block = el('div', { children: [figure, details] });
      trendRow.append(block);
      nextTrend.set(tag.id, { svg, title, desc, pvLine, spLine, tableBody });
    }

    tagRows = nextSpv;
    entryRows = nextEntry;
    trendRows = nextTrend;
  }

  function updateTagRows(machine: MachineSnapshot, tick: number): void {
    for (const tag of machine.tags) {
      const spv = tagRows.get(tag.id);
      if (spv) {
        spv.setpointDd.replaceChildren(
          tag.setpoint === null ? '—' : formatEngineeringValue(tag.setpoint),
          el('small', { attrs: { 'aria-hidden': 'true' }, text: localizedUnit(tag.unit) }),
        );
        spv.pvDd.replaceChildren(
          formatEngineeringValue(tag.value),
          el('small', { attrs: { 'aria-hidden': 'true' }, text: localizedUnit(tag.unit) }),
        );
        spv.marker.style.left = `${barMarkerPercent(tag.value, tag.rangeLow, tag.rangeHigh)}%`;
        const status = deviationStatus(tag.value, tag.setpoint, tag.rangeLow, tag.rangeHigh);
        spv.status.textContent = context.t(`faceplate.tag.status.${statusKeySuffix(status)}`);
        spv.rangeHint.textContent = context.t('faceplate.tag.range', {
          range: formatRange(tag.rangeLow, tag.rangeHigh),
          unit: localizedUnit(tag.unit),
        });
      }

      const entry = entryRows.get(tag.id);
      if (entry && tag.setpoint !== null) {
        entry.hint.textContent = context.t('faceplate.setpoint.hint', {
          range: formatRange(tag.rangeLow, tag.rangeHigh),
          unit: localizedUnit(tag.unit),
        });
        // Never overwrite what the player is actively typing — a snapshot can
        // arrive mid-keystroke, and the renderer observes, it does not fight
        // the control the player's own hand is on.
        if (document.activeElement !== entry.input) {
          entry.input.value = formatEngineeringValue(tag.setpoint);
          entry.error.textContent = '';
          entry.input.closest('.cb-numeric-entry')?.setAttribute('data-invalid', 'false');
        }
      }

      const trend = trendRows.get(tag.id);
      if (trend) {
        const history = pushTrendSample(
          trendHistory.get(tag.id) ?? [],
          { tick, value: tag.value, setpoint: tag.setpoint },
          TREND_MAX_SAMPLES,
        );
        trendHistory.set(tag.id, history);
        renderTrend(tag, history, trend);
      }
    }
  }

  function renderTrend(tag: TagSnapshot, history: readonly TrendSample[], trend: TrendRow): void {
    const domain = trendDomain(history, tag.rangeLow, tag.rangeHigh);
    const values = history.map((sample) => sample.value);
    const pvPoints = scaleTrendSeries(values, TREND_VIEWPORT, domain.low, domain.high);
    trend.pvLine.setAttribute('points', pointsAttribute(pvPoints));

    const hasSetpointSeries = history.length > 0 && history.every((sample) => sample.setpoint !== null);
    if (hasSetpointSeries) {
      const setpoints = history.map((sample) => sample.setpoint as number);
      const spPoints = scaleTrendSeries(setpoints, TREND_VIEWPORT, domain.low, domain.high);
      trend.spLine.setAttribute('points', pointsAttribute(spPoints));
      trend.spLine.style.display = '';
    } else {
      trend.spLine.setAttribute('points', '');
      trend.spLine.style.display = 'none';
    }

    trend.title.textContent = context.t('faceplate.trend.svgTitle', { label: tag.label });
    const latest = history[history.length - 1];
    trend.desc.textContent = latest
      ? context.t('faceplate.trend.svgDesc', {
          label: tag.label,
          value: formatEngineeringValue(latest.value),
          unit: localizedUnit(tag.unit),
          count: history.length,
        })
      : context.t('faceplate.trend.svgDescEmpty', { label: tag.label });

    trend.tableBody.replaceChildren(
      ...history.map((sample) =>
        el('tr', {
          children: [
            el('th', { attrs: { scope: 'row' }, text: String(sample.tick) }),
            el('td', { text: sample.setpoint === null ? '—' : formatEngineeringValue(sample.setpoint) }),
            el('td', { text: formatEngineeringValue(sample.value) }),
          ],
        }),
      ),
    );
  }

  function describeModeRefusal(machine: MachineSnapshot, refusal: ModeRefusal): string {
    if (refusal.kind === 'not-commissioned') {
      return context.t('refusal.notCommissioned', { machine: machine.label });
    }
    return context.t('refusal.modeTransition', {
      machine: machine.label,
      from: context.t(modeCatalogueKey(refusal.from)),
      to: context.t(modeCatalogueKey(refusal.to)),
    });
  }

  function describeSetpointValidation(validation: SetpointValidation & { ok: false }, unit: string): string {
    if (validation.kind === 'out-of-range') {
      return context.t('refusal.outOfRange', {
        value: formatEngineeringValue(validation.value),
        unit,
        low: formatEngineeringValue(validation.low),
        high: formatEngineeringValue(validation.high),
      });
    }
    return context.t(validation.kind === 'empty' ? 'faceplate.setpoint.enterValue' : 'faceplate.setpoint.enterNumber');
  }

  function updateModeSelector(machine: MachineSnapshot): void {
    for (const [mode, input] of modeInputs) {
      const refusal = modeTransitionRefusal(machine.mode, mode, machine.commissioned);
      input.checked = mode === machine.mode;
      input.disabled = refusal !== null;
      if (refusal) input.setAttribute('title', describeModeRefusal(machine, refusal));
      else input.removeAttribute('title');
    }
    modeStatus.textContent = modeRefusalText ?? '';
    modeStatus.hidden = !modeRefusalText;
  }

  async function handleModeChange(target: MachineMode): Promise<void> {
    const machine = currentMachine();
    if (!machine || target === machine.mode) return;
    const command: Command = { kind: 'setMode', machineId, mode: target };
    const result = await sendCommand(command);
    if (!result.accepted) {
      modeRefusalText = describeRefusal(context.t, result.reason);
      modeStatus.textContent = modeRefusalText;
      modeStatus.hidden = false;
      context.announce(modeRefusalText, 'assertive');
      // Revert the radio to the mode the world is actually in — the renderer
      // observes, it does not get to decide the command succeeded.
      const stillCurrent = modeInputs.get(machine.mode);
      if (stillCurrent) stillCurrent.checked = true;
    } else {
      modeRefusalText = null;
      modeStatus.hidden = true;
    }
  }

  async function handleAlarmAction(alarmId: string): Promise<void> {
    const machine = currentMachine();
    if (!machine) return;
    const alarmSnapshot = machine.alarms.find((a) => a.id === alarmId);
    const action = alarmSnapshot ? availableAlarmAction(alarmSnapshot.state) : null;
    if (!action) return;
    const command: Command =
      action === 'acknowledge'
        ? { kind: 'acknowledgeAlarm', machineId, alarmId }
        : { kind: 'resetAlarm', machineId, alarmId };
    const result = await sendCommand(command);
    const row = alarmRows.get(alarmId);
    if (!result.accepted) {
      const reason = describeRefusal(context.t, result.reason);
      alarmRefusals.set(alarmId, reason);
      if (row) {
        row.reason.textContent = reason;
        row.reason.hidden = false;
      }
      context.announce(reason, 'assertive');
    } else {
      alarmRefusals.delete(alarmId);
      if (row) row.reason.hidden = true;
    }
  }

  async function handleSetpointChange(
    tagId: string,
    input: HTMLInputElement,
    wrapper: HTMLElement,
    error: HTMLElement,
  ): Promise<void> {
    const machine = currentMachine();
    const tag = machine?.tags.find((t) => t.id === tagId);
    if (!machine || !tag) return;
    const validation = validateSetpointInput(input.value, tag.rangeLow, tag.rangeHigh);
    if (!validation.ok) {
      const reason = describeSetpointValidation(validation, localizedUnit(tag.unit));
      wrapper.setAttribute('data-invalid', 'true');
      input.setAttribute('aria-invalid', 'true');
      error.textContent = reason;
      context.announce(reason, 'assertive');
      return;
    }
    const command: Command = { kind: 'setSetpoint', machineId, tagId, value: validation.value };
    const result = await sendCommand(command);
    if (!result.accepted) {
      const reason = describeRefusal(context.t, result.reason);
      wrapper.setAttribute('data-invalid', 'true');
      input.setAttribute('aria-invalid', 'true');
      error.textContent = reason;
      context.announce(reason, 'assertive');
    } else {
      wrapper.setAttribute('data-invalid', 'false');
      input.setAttribute('aria-invalid', 'false');
      error.textContent = '';
    }
  }

  function sendCommand(command: Command): Promise<CommandResult> {
    return context.send(command);
  }

  function currentMachine(): MachineSnapshot | undefined {
    return context.snapshot()?.machines.find((machine) => machine.id === machineId);
  }

  /**
   * Runs a command registered directly from the palette (a mode switch, an alarm
   * acknowledge/reset) rather than from a visible control on this faceplate. The
   * palette dialog closes the instant an entry runs (`palette.ts`'s own `runEntry`), so
   * by the time a refusal comes back there is no longer a field or a tile on screen to
   * show it next to — only the live region, which is why the message is prefixed with
   * `refusal.title` ("Command refused") rather than shown bare the way an inline error
   * next to a specific control can be.
   */
  async function runPaletteCommand(command: Command): Promise<void> {
    const result = await sendCommand(command);
    if (!result.accepted) {
      context.announce(`${context.t('refusal.title')} — ${describeRefusal(context.t, result.reason)}`, 'assertive');
    }
  }

  function registerPalette(machine: MachineSnapshot): void {
    if (paletteRegistered) return;
    paletteRegistered = true;
    const entries: PaletteEntry[] = [
      {
        id: `faceplate:machine:${machine.id}`,
        label: machine.label,
        group: context.t('palette.groupMachines'),
        keywords: [machine.id],
        run: () => context.reveal({ kind: 'machine', machineId: machine.id }),
      },
      // A tag with a setpoint is labelled with `command.setSetpoint` (its current
      // value included) rather than the bare `faceplate.palette.tag` a read-only tag
      // gets, since running this entry takes the player straight to the control that
      // sets it — a real shortcut into the plant, not only a lookup.
      ...machine.tags.map((tag) => ({
        id: `faceplate:tag:${machine.id}:${tag.id}`,
        label:
          tag.setpoint === null
            ? context.t('faceplate.palette.tag', { machine: machine.label, tag: tag.label })
            : context.t('command.setSetpoint', {
                machine: machine.label,
                tag: tag.label,
                value: formatEngineeringValue(tag.setpoint),
                unit: localizedUnit(tag.unit),
              }),
        group: context.t('palette.groupMachines'),
        keywords: [tag.id, machine.id],
        run: () => context.reveal({ kind: 'tag', machineId: machine.id, tagId: tag.id }),
      })),
      ...machine.alarms.map((alarmSnapshot) => ({
        id: `faceplate:alarm:${machine.id}:${alarmSnapshot.id}`,
        label: context.t('faceplate.palette.tag', { machine: machine.label, tag: alarmSnapshot.label }),
        group: context.t('palette.groupAlarms'),
        keywords: [alarmSnapshot.id, machine.id],
        run: () => context.reveal({ kind: 'alarm', machineId: machine.id, alarmId: alarmSnapshot.id }),
      })),
      // Mode changes: one entry per mode, each a real command run right from the
      // palette — not only a reveal — so Ctrl+Shift+F can actually drive the plant.
      // An illegal or refused transition is announced exactly as the mode selector's
      // own refusal path describes it (`describeRefusal`), never silently dropped.
      ...MODE_ORDER.map((mode) => ({
        id: `faceplate:mode:${machine.id}:${mode}`,
        label: context.t('command.setMode', { machine: machine.label, mode: context.t(modeCatalogueKey(mode)) }),
        group: context.t('palette.groupMachines'),
        keywords: [machine.id, mode],
        run: () => runPaletteCommand({ kind: 'setMode', machineId: machine.id, mode }),
      })),
      // Alarm actions available right now — acknowledge or reset — executed directly,
      // without first navigating to the tile.
      ...machine.alarms.flatMap((alarmSnapshot) => {
        const action = availableAlarmAction(alarmSnapshot.state);
        if (!action) return [];
        const labelKey = action === 'acknowledge' ? 'command.acknowledgeAlarm' : 'command.resetAlarm';
        const command: Command =
          action === 'acknowledge'
            ? { kind: 'acknowledgeAlarm', machineId: machine.id, alarmId: alarmSnapshot.id }
            : { kind: 'resetAlarm', machineId: machine.id, alarmId: alarmSnapshot.id };
        return [
          {
            id: `faceplate:alarm-action:${machine.id}:${alarmSnapshot.id}`,
            label: context.t(labelKey, { machine: machine.label, alarm: alarmSnapshot.label }),
            group: context.t('palette.groupAlarms'),
            keywords: [alarmSnapshot.id, machine.id],
            run: () => runPaletteCommand(command),
          },
        ];
      }),
    ];
    unregisterCommands = context.registerCommands(entries);
  }

  const unregisterReveal = context.registerRevealHandler((target: RevealTarget) => {
    if (target.kind === 'machine' && target.machineId === machineId) {
      titleSpan.tabIndex = -1;
      focusVisibly(titleSpan);
      return true;
    }
    if (target.kind === 'tag' && target.machineId === machineId) {
      const entry = entryRows.get(target.tagId);
      if (entry) {
        focusVisibly(entry.input);
        return true;
      }
      // A read-only tag has no entry to focus — focus its readout instead.
      const spv = tagRows.get(target.tagId);
      if (spv) {
        spv.pvDd.tabIndex = -1;
        focusVisibly(spv.pvDd);
        return true;
      }
      return false;
    }
    if (target.kind === 'alarm' && target.machineId === machineId) {
      const row = alarmRows.get(target.alarmId);
      if (row) {
        focusVisibly(row.button);
        return true;
      }
      return false;
    }
    return false;
  });

  function tagIdsEqual(a: readonly string[] | null, b: readonly TagSnapshot[]): boolean {
    if (!a || a.length !== b.length) return false;
    return a.every((id, index) => id === b[index]?.id);
  }

  function alarmIdsEqual(a: readonly string[] | null, b: readonly AlarmSnapshot[]): boolean {
    if (!a || a.length !== b.length) return false;
    return a.every((id, index) => id === b[index]?.id);
  }

  function renderMachine(machine: MachineSnapshot, tick: number): void {
    notFoundNotice.hidden = true;
    container.removeAttribute('aria-hidden');

    titleSpan.textContent = machine.label;
    const commissionedKey = machine.commissioned ? 'mode.commissioned' : 'mode.notCommissioned';
    const runningKey = machine.running ? 'mode.running' : 'mode.stopped';
    runInfo.textContent = [
      context.t(commissionedKey),
      context.t(runningKey),
      context.t('mode.runHours', { hours: formatEngineeringValue(machine.runHours) }),
      context.t('mode.serviceDue', { hours: formatEngineeringValue(machine.serviceDueInHours) }),
    ].join(' · ');

    if (!tagIdsEqual(knownTagIds, machine.tags)) {
      buildEntryAndSpvRows(machine.tags);
      knownTagIds = machine.tags.map((tag) => tag.id);
    }
    if (!alarmIdsEqual(knownAlarmIds, machine.alarms)) {
      buildAlarmRows(machine.alarms);
      knownAlarmIds = machine.alarms.map((alarmSnapshot) => alarmSnapshot.id);
    }

    updateModeSelector(machine);
    updateAlarmRows(machine.alarms);
    updateTagRows(machine, tick);
    registerPalette(machine);
  }

  const unsubscribe = context.subscribe((snapshot) => {
    const machine = snapshot.machines.find((m) => m.id === machineId);
    if (!machine) {
      notFoundNotice.hidden = false;
      container.setAttribute('aria-hidden', 'true');
      return;
    }
    renderMachine(machine, snapshot.tick);
  });

  const initial = context.snapshot();
  if (initial) {
    const machine = initial.machines.find((m) => m.id === machineId);
    if (machine) renderMachine(machine, initial.tick);
    else notFoundNotice.hidden = false;
  }

  return () => {
    unsubscribe();
    unregisterReveal();
    unregisterCommands?.();
    container.remove();
  };
}

function statusKeySuffix(status: ReturnType<typeof deviationStatus>): string {
  switch (status) {
    case 'no-setpoint':
      return 'noSetpoint';
    case 'within-tolerance':
      return 'withinTolerance';
    case 'deviation-high':
      return 'deviationHigh';
    case 'deviation-low':
      return 'deviationLow';
  }
}
