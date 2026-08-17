/**
 * The ancestry screen: given a lot id, walk `RendererContext.provenance()`'s tree
 * and render it as a real, keyboard-navigable ARIA tree — the product's central
 * claim made explorable. Reaching a root that is the atmosphere, the soil, the
 * groundwater or the sun is the payoff this screen exists to show, so every node
 * that turns out to be one is called out, and the whole tree is expanded by
 * default rather than making a player click their way down to find out.
 *
 * If the walk was capped (see `ProvenanceNode.truncated` in `shared/ipc.ts`), that
 * is said plainly on the surface — a capped tree must never quietly read as a
 * complete one.
 *
 * This module only ever *observes*: it calls `context.provenance()` and renders
 * what comes back. It never mutates simulation state, and it never reaches past
 * `RendererContext` for anything.
 *
 * See `rows.ts` for the pure `ProvenanceNode` -> flat row transform this file
 * renders, and for the mass-formatting helper it uses to show an exact figure
 * without ever parsing a conserved quantity into a `Number`.
 *
 * ## Copy
 *
 * Every string this screen shows a player goes through `context.t()`, so the Kid
 * register and Cantonese are the catalogue's job, not this file's — see
 * `renderer/i18n/catalogue.ts` (owned by a sibling task, not this one). The
 * `provenance.*` keys used below (`provenance.title`, `.root`, `.process`,
 * `.tick`, `.mass`, `.truncated`, `.empty`, `.lot`) already exist in that
 * catalogue and are reused verbatim rather than duplicated. A handful of keys
 * this screen also needs — the lot-id lookup form's label, submit button, and
 * loading/failure status (`provenance.tree.lookup*`, `provenance.tree.loading`,
 * `provenance.tree.loadFailed`) are not in that catalogue yet; `t()` renders an
 * unresolved key as a visible `⟦missing:…⟧` placeholder rather than throwing
 * (see `catalogue.ts`'s own contract), so this screen stays usable either way,
 * but those four keys still need adding on the i18n side for full copy.
 */

import type { ProvenanceNode } from '../../shared/ipc.js';
import type { Disposable, Panel, RevealTarget } from '../context.js';
import {
  anyRowTruncated,
  flattenProvenanceTree,
  formatMicrogramsAsGrams,
  type ProvenanceRow,
} from './rows.js';

function rowDomId(index: number): string {
  return `provenance-tree-row-${index}`;
}

export const mountProvenanceTree: Panel = (root, context) => {
  const section = document.createElement('section');
  section.className = 'cb-panel-frame cb-provenance-tree';
  const titleId = 'provenance-tree-title';
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

  const form = document.createElement('form');
  form.className = 'cb-provenance-tree__form';
  const inputId = 'provenance-tree-lot-id';
  const inputLabel = document.createElement('label');
  inputLabel.htmlFor = inputId;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = inputId;
  input.name = 'lotId';
  input.autocomplete = 'off';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'cb-provenance-tree__submit';
  form.append(inputLabel, input, submit);
  section.appendChild(form);

  const status = document.createElement('p');
  status.className = 'cb-provenance-tree__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  section.appendChild(status);

  const truncationBanner = document.createElement('p');
  truncationBanner.className = 'cb-provenance-tree__truncated';
  truncationBanner.hidden = true;
  section.appendChild(truncationBanner);

  const treeRoot = document.createElement('ul');
  treeRoot.className = 'cb-provenance-tree__tree';
  treeRoot.setAttribute('role', 'tree');
  section.appendChild(treeRoot);

  root.appendChild(section);

  let currentNode: ProvenanceNode | null = null;
  let rows: readonly ProvenanceRow[] = [];
  let expanded = new Set<number>();
  let focusedIndex = 0;

  function applyCopy(): void {
    title.textContent = context.t('provenance.title');
    inputLabel.textContent = context.t('provenance.tree.lookupLabel');
    submit.textContent = context.t('provenance.tree.lookupSubmit');
    treeRoot.setAttribute('aria-label', context.t('provenance.title'));
    if (!currentNode) status.textContent = context.t('provenance.empty');
  }

  /** True only when every ancestor of `row`, up to the tree root, is expanded. */
  function isVisible(row: ProvenanceRow): boolean {
    let ancestorIndex = row.parentIndex;
    while (ancestorIndex !== null) {
      if (!expanded.has(ancestorIndex)) return false;
      const ancestor = rows[ancestorIndex];
      ancestorIndex = ancestor ? ancestor.parentIndex : null;
    }
    return true;
  }

  function visibleRows(): ProvenanceRow[] {
    return rows.filter(isVisible);
  }

  /** The individual facts a node's row shows, each drawn from its own catalogue key
   * — mass, tick, process, then (only when it applies) the root-source callout and
   * the truncation notice. Reused for both the visible fact list and the
   * `aria-label`, so what a sighted player reads and what a screen reader announces
   * are the same information, just laid out differently. */
  function nodeFacts(row: ProvenanceRow): readonly { readonly text: string; readonly kind: string }[] {
    const facts: { readonly text: string; readonly kind: string }[] = [
      {
        kind: 'mass',
        text: context.t('provenance.mass', { mass: formatMicrogramsAsGrams(row.mass), unit: context.t('unit.gram') }),
      },
      { kind: 'tick', text: context.t('provenance.tick', { tick: row.tick }) },
      { kind: 'process', text: context.t('provenance.process', { process: row.process }) },
      { kind: 'lot', text: context.t('provenance.lot', { lotId: row.lotId }) },
    ];
    if (row.rootKind) facts.push({ kind: `root-${row.rootKind}`, text: context.t('provenance.root', { label: row.label }) });
    if (row.truncated) facts.push({ kind: 'truncated', text: context.t('provenance.truncated') });
    return facts;
  }

  function nodeAccessibleName(row: ProvenanceRow): string {
    return [row.label, ...nodeFacts(row).map((fact) => fact.text)].join(', ');
  }

  function focusRow(index: number): void {
    focusedIndex = index;
    render();
    document.getElementById(rowDomId(index))?.focus();
  }

  function setExpanded(index: number, value: boolean): void {
    if (value) expanded.add(index);
    else expanded.delete(index);
    focusedIndex = index;
    render();
    document.getElementById(rowDomId(index))?.focus();
  }

  function toggle(index: number): void {
    const row = rows[index];
    if (!row || !row.hasChildren) return;
    setExpanded(index, !expanded.has(index));
  }

  /**
   * Build one `<li role="treeitem">`, using `row` (the flattened, indexed view)
   * for expand state and traversal, and `node` (the original tree) for children —
   * the two stay in lock-step because `flattenProvenanceTree` walks `node.children`
   * in the exact same order it assigns `row.childIndices`.
   */
  function buildItem(node: ProvenanceNode, row: ProvenanceRow, container: HTMLElement): void {
    const li = document.createElement('li');
    li.id = rowDomId(row.index);
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-level', String(row.depth + 1));
    // An explicit aria-label, computed from this row's own data only, so a nested
    // ul[role="group"] of this node's own children never bleeds into its parent's
    // accessible name via "name from content" — each treeitem announces itself,
    // not its whole subtree.
    li.setAttribute('aria-label', nodeAccessibleName(row));
    li.dataset.rowIndex = String(row.index);
    if (row.hasChildren) li.setAttribute('aria-expanded', String(expanded.has(row.index)));
    li.tabIndex = row.index === focusedIndex ? 0 : -1;

    const rowEl = document.createElement('div');
    rowEl.className = 'cb-provenance-tree__row';
    rowEl.addEventListener('click', () => {
      focusRow(row.index);
      toggle(row.index);
    });

    const nameEl = document.createElement('span');
    nameEl.className = 'cb-provenance-tree__row-label';
    nameEl.textContent = row.label;
    rowEl.appendChild(nameEl);

    const factsEl = document.createElement('ul');
    factsEl.className = 'cb-provenance-tree__facts';
    for (const fact of nodeFacts(row)) {
      const factEl = document.createElement('li');
      factEl.className = `cb-provenance-tree__fact cb-provenance-tree__fact--${fact.kind}`;
      factEl.textContent = fact.text;
      factsEl.appendChild(factEl);
    }
    rowEl.appendChild(factsEl);

    li.appendChild(rowEl);

    if (row.hasChildren) {
      const group = document.createElement('ul');
      group.setAttribute('role', 'group');
      if (!expanded.has(row.index)) group.hidden = true;
      node.children.forEach((child, position) => {
        const childRowIndex = row.childIndices[position];
        const childRow = childRowIndex === undefined ? undefined : rows[childRowIndex];
        if (childRow) buildItem(child, childRow, group);
      });
      li.appendChild(group);
    }

    container.appendChild(li);
  }

  function render(): void {
    treeRoot.innerHTML = '';
    if (!currentNode || rows.length === 0) return;

    const truncated = anyRowTruncated(rows);
    truncationBanner.hidden = !truncated;
    if (truncated) truncationBanner.textContent = context.t('provenance.truncated');

    const rootRow = rows[0];
    if (!rootRow) return;
    buildItem(currentNode, rootRow, treeRoot);
  }

  async function load(lotId: string): Promise<void> {
    status.textContent = context.t('provenance.tree.loading', { lotId });
    try {
      const node = await context.provenance(lotId);
      currentNode = node;
      rows = flattenProvenanceTree(node);
      // Expanded by default: the ancestry reaching a world reservoir is this
      // screen's whole point, and it must be visible without a click.
      expanded = new Set(rows.filter((row) => row.hasChildren).map((row) => row.index));
      focusedIndex = 0;
      render();
      const message = `${context.t('provenance.title')}: ${context.t('provenance.lot', { lotId })}`;
      status.textContent = message;
      context.announce(message);
    } catch (error) {
      currentNode = null;
      rows = [];
      expanded = new Set();
      treeRoot.innerHTML = '';
      truncationBanner.hidden = true;
      const message = context.t('provenance.tree.loadFailed', {
        lotId,
        reason: error instanceof Error ? error.message : String(error),
      });
      status.textContent = message;
      context.announce(message, 'assertive');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (value.length === 0) return;
    void load(value);
  });

  treeRoot.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const li = target.closest('[role="treeitem"]');
    if (!(li instanceof HTMLElement)) return;
    const indexAttr = li.dataset.rowIndex;
    const index = indexAttr === undefined ? Number.NaN : Number(indexAttr);
    const row = rows[index];
    if (!row) return;

    const visible = visibleRows();
    const position = visible.findIndex((candidate) => candidate.index === index);

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = visible[position + 1];
        if (next) focusRow(next.index);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const previous = visible[position - 1];
        if (previous) focusRow(previous.index);
        break;
      }
      case 'ArrowRight': {
        event.preventDefault();
        if (!row.hasChildren) break;
        if (!expanded.has(row.index)) {
          setExpanded(row.index, true);
        } else {
          const firstChildIndex = row.childIndices[0];
          if (firstChildIndex !== undefined) focusRow(firstChildIndex);
        }
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        if (row.hasChildren && expanded.has(row.index)) {
          setExpanded(row.index, false);
        } else if (row.parentIndex !== null) {
          focusRow(row.parentIndex);
        }
        break;
      }
      case 'Home': {
        event.preventDefault();
        const first = visible[0];
        if (first) focusRow(first.index);
        break;
      }
      case 'End': {
        event.preventDefault();
        const last = visible[visible.length - 1];
        if (last) focusRow(last.index);
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        toggle(row.index);
        break;
      }
      default:
        break;
    }
  });

  const unregisterReveal = context.registerRevealHandler((target: RevealTarget) => {
    if (target.kind !== 'lot') return false;
    input.value = target.lotId;
    void load(target.lotId);
    section.scrollIntoView({ block: 'nearest' });
    return true;
  });

  function registerPalette(): Disposable {
    return context.registerCommands([
      {
        id: 'provenance:open-tree',
        label: context.t('provenance.title'),
        group: context.t('palette.groupProvenance'),
        keywords: ['provenance', 'ancestry', 'lot', 'lineage', 'traceability'],
        run: () => {
          section.scrollIntoView({ block: 'start' });
          input.focus();
        },
      },
    ]);
  }
  let unregisterPalette = registerPalette();

  const unsubscribePreferences = context.onPreferences(() => {
    applyCopy();
    render();
    unregisterPalette();
    unregisterPalette = registerPalette();
  });

  applyCopy();
  render();

  return () => {
    unregisterReveal();
    unregisterPalette();
    unsubscribePreferences();
    section.remove();
  };
};
