/**
 * The zero-residual panel: the product's honesty made visible.
 *
 * `WorldSnapshot.balance` carries one `BalanceRow` per commodity, every tick. Its
 * `residual` must read exactly `"0"` — that is the whole claim CONTRACT.md rule 1
 * makes, made checkable by a player rather than only by a test they never see. This
 * screen renders every row, verbatim, with no rounding, no digit grouping, no
 * abbreviation and no row ever hidden — a table a player could audit by hand if they
 * wanted to. If a residual is ever not exactly zero, that row (and the panel as a
 * whole) becomes unmissable: real visible text (not colour alone) names the exact
 * violation, and `RendererContext.announce` speaks it assertively.
 *
 * This module only observes `RendererContext.subscribe`'s snapshot stream; it never
 * mutates simulation state.
 *
 * Every string here comes from the `balance.*` and `palette.groupProvenance`
 * catalogue keys already declared in `renderer/i18n/catalogue.ts` (a sibling task's
 * path, not this one) — no new key is needed for this screen.
 */

import type { BalanceRow, WorldSnapshot } from '../../shared/ipc.js';
import type { Disposable, Panel } from '../context.js';
import { residualIsExactlyZero } from './balanceRows.js';

export const mountProvenanceBalance: Panel = (root, context) => {
  const section = document.createElement('section');
  section.className = 'cb-panel-frame cb-provenance-balance';
  const titleId = 'provenance-balance-title';
  section.setAttribute('aria-labelledby', titleId);

  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    const fastener = document.createElement('span');
    fastener.className = `cb-panel-frame__fastener cb-panel-frame__fastener--${corner}`;
    fastener.setAttribute('aria-hidden', 'true');
    section.appendChild(fastener);
  }

  const title = document.createElement('h2');
  title.id = titleId;
  title.className = 'cb-panel-frame__title';
  section.appendChild(title);

  const summary = document.createElement('p');
  summary.className = 'cb-provenance-balance__summary';
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-live', 'polite');
  section.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'cb-provenance-balance__table';
  table.setAttribute('aria-labelledby', titleId);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const commodityHeader = document.createElement('th');
  commodityHeader.scope = 'col';
  const residualHeader = document.createElement('th');
  residualHeader.scope = 'col';
  headRow.append(commodityHeader, residualHeader);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  section.appendChild(table);

  root.appendChild(section);

  function applyCopy(): void {
    title.textContent = context.t('balance.title');
    commodityHeader.textContent = context.t('balance.commodity');
    residualHeader.textContent = context.t('balance.residual');
  }

  function buildRow(row: BalanceRow): HTMLTableRowElement {
    const isZero = residualIsExactlyZero(row.residual);
    const tr = document.createElement('tr');
    tr.className = 'cb-provenance-balance__row';
    tr.dataset.residualOk = String(isZero);
    tr.setAttribute(
      'aria-label',
      context.t(isZero ? 'balance.row' : 'balance.notOk', { commodity: row.commodity, residual: row.residual }),
    );

    const commodityCell = document.createElement('th');
    commodityCell.scope = 'row';
    commodityCell.textContent = row.commodity;

    const residualCell = document.createElement('td');
    residualCell.className = 'cb-provenance-balance__residual';
    const residualValue = document.createElement('span');
    residualValue.className = 'cb-provenance-balance__residual-value';
    // Verbatim — the exact ExactString the wire sent, with no formatting applied.
    // This is the one field on this screen that must never be rounded, grouped or
    // abbreviated: it is the number a player checks against "exactly zero".
    residualValue.textContent = row.residual;
    residualCell.appendChild(residualValue);

    if (!isZero) {
      const violation = document.createElement('strong');
      violation.className = 'cb-provenance-balance__violation';
      violation.textContent = context.t('balance.notOk', { commodity: row.commodity, residual: row.residual });
      residualCell.appendChild(violation);
    }

    tr.append(commodityCell, residualCell);
    return tr;
  }

  function render(snapshot: WorldSnapshot | null): void {
    tbody.innerHTML = '';

    if (!snapshot) {
      section.removeAttribute('data-balance-ok');
      summary.textContent = '';
      return;
    }

    section.setAttribute('data-balance-ok', String(snapshot.balanceOk));
    const tickText = context.t('balance.tick', { tick: snapshot.tick });
    const violatingRows = snapshot.balance.filter((row) => !residualIsExactlyZero(row.residual));
    const summaryText = snapshot.balanceOk
      ? `${tickText} — ${context.t('balance.ok')}`
      : `${tickText} — ${violatingRows
          .map((row) => context.t('balance.notOk', { commodity: row.commodity, residual: row.residual }))
          .join(' ')}`;
    summary.textContent = summaryText;

    // Every row renders regardless of state — hiding a passing row would be as
    // dishonest as hiding a failing one, since "every row present and every one
    // zero" is itself the claim being demonstrated.
    for (const row of snapshot.balance) tbody.appendChild(buildRow(row));

    if (!snapshot.balanceOk) context.announce(summaryText, 'assertive');
  }

  function registerPalette(): Disposable {
    return context.registerCommands([
      {
        id: 'provenance:open-balance',
        label: context.t('balance.title'),
        group: context.t('palette.groupProvenance'),
        keywords: ['balance', 'residual', 'conservation', 'ledger', 'audit'],
        run: () => section.scrollIntoView({ block: 'start' }),
      },
    ]);
  }
  let unregisterPalette = registerPalette();

  const unsubscribeSnapshot = context.subscribe((snapshot) => render(snapshot));

  const unsubscribePreferences = context.onPreferences(() => {
    applyCopy();
    render(context.snapshot());
    unregisterPalette();
    unregisterPalette = registerPalette();
  });

  applyCopy();
  render(context.snapshot());

  return () => {
    unsubscribeSnapshot();
    unsubscribePreferences();
    unregisterPalette();
    section.remove();
  };
};
