/**
 * The cake designer panel.
 *
 * Builds a design from real tiers, layers, fillings and finishes and shows every
 * structural, thermal, feasibility and cost verdict live, from the real physics in
 * `@conservation-bakery/sim`'s `designer/` module — never a client-side guess at what
 * the simulation would say. A design is never silently repaired: every refusal shown
 * here is the exact reason `evaluateDesign` returned, register-aware (`logic.ts`'s
 * `describe*Problem` functions) but never softened into something the simulation did
 * not actually decide.
 *
 * Every control is a native, keyboard-operable element — `<button>`, `<input>`,
 * `<select>`, inside a `<fieldset>`/`<legend>` per tier/filling/finish/topper — so Tab
 * and Shift+Tab reach every one of them in document order with no custom key handling
 * needed. The cross-section elevation is inline SVG with a `<title>`/`<desc>` and a
 * same-content `<table>` text equivalent, exactly like `faceplate/render.ts`'s trend
 * recorder. Every verdict change is spoken through `context.announce`, so a refusal
 * that appears while a keyboard user's focus is still on the field they just edited is
 * heard immediately, not only seen.
 */

import type {
  CakeDesign,
  DesignEvaluation,
  DesignFinish,
  DesignTier,
  FinishKind,
} from '@conservation-bakery/sim';
import { evaluateDesign, FINISH_KINDS } from '@conservation-bakery/sim';
import type { Disposable, Panel, RendererContext } from '../context.js';
import { el } from '../kit/dom.js';
import { formatMoney } from '../kit/format.js';
import {
  FORMULATION_PRESETS,
  REFERENCE_HOURLY_WAGE_MINOR_UNITS,
  REFERENCE_INVENTORY,
  REFERENCE_LINE,
  REFERENCE_PRICES,
  SUBSTANCE_PRESETS,
  buildDefaultDesign,
  buildDefaultFilling,
  buildDefaultFinish,
  buildDefaultTier,
  buildDefaultTopper,
  computeElevationGeometry,
  describeFeasibilityProblem,
  describeStructuralProblem,
  describeThermalProblem,
  finishKindCatalogueKey,
} from './logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string>> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/** Mutates `design` at a nested path by rebuilding every array/object on the path —
 * every design edit in this panel goes through this one function, so `evaluateDesign`
 * always sees a fresh, correctly-shaped object rather than a mutation in place. */
function replaceTier(design: CakeDesign, tierId: string, next: DesignTier): CakeDesign {
  return { ...design, tiers: design.tiers.map((t) => (t.id === tierId ? next : t)) };
}

export const designerPanel: Panel = (root, context) => mountDesigner(root, context);

function mountDesigner(root: HTMLElement, context: RendererContext): Disposable {
  let design: CakeDesign = buildDefaultDesign();
  let lastAccepted: boolean | null = null;

  const container = el('section', { class: 'cb-panel-frame', attrs: { 'aria-labelledby': 'designer-title' } });
  const title = el('h2', { attrs: { id: 'designer-title' }, text: context.t('designer.title') });
  const subtitle = el('p', { class: 'cb-numeric-entry__hint', text: context.t('designer.subtitle') });
  container.append(title, subtitle);

  // --- Elevation ------------------------------------------------------------------
  const elevationSection = el('div', { class: 'cb-faceplate__section' });
  elevationSection.append(el('p', { class: 'cb-faceplate__section-title', text: context.t('designer.elevation.title') }));
  const figure = el('figure', {});
  const svgTitleId = 'designer-elevation-title';
  const svgDescId = 'designer-elevation-desc';
  const svg = svgEl('svg', {
    viewBox: '0 0 300 220',
    role: 'img',
    'aria-labelledby': `${svgTitleId} ${svgDescId}`,
    class: 'cb-designer__elevation',
  });
  const svgTitle = svgEl('title', { id: svgTitleId });
  const svgDesc = svgEl('desc', { id: svgDescId });
  svg.append(svgTitle, svgDesc);
  figure.append(svg);
  const tableDetails = el('details', {});
  const tableSummary = el('summary', { text: context.t('designer.elevation.tableToggle') });
  const table = el('table', {});
  const caption = el('caption', { text: context.t('designer.elevation.tableCaption') });
  const thead = el('thead', {
    children: [
      el('tr', {
        children: [
          el('th', { attrs: { scope: 'col' }, text: context.t('designer.elevation.columnTier') }),
          el('th', { attrs: { scope: 'col' }, text: context.t('designer.elevation.columnDiameter') }),
          el('th', { attrs: { scope: 'col' }, text: context.t('designer.elevation.columnHeight') }),
        ],
      }),
    ],
  });
  const tbody = el('tbody', {});
  table.append(caption, thead, tbody);
  tableDetails.append(tableSummary, table);
  figure.append(tableDetails);
  elevationSection.append(figure);
  container.append(elevationSection);

  // --- Tiers ------------------------------------------------------------------------
  const tiersSection = el('div', { class: 'cb-faceplate__section' });
  const tiersList = el('div', {});
  const addTierButton = el('button', { attrs: { type: 'button' }, text: context.t('designer.tier.add') });
  tiersSection.append(tiersList, addTierButton);
  container.append(tiersSection);

  addTierButton.addEventListener('click', () => {
    design = { ...design, tiers: [...design.tiers, buildDefaultTier()] };
    render();
  });

  // --- Toppers ------------------------------------------------------------------------
  const toppersSection = el('div', { class: 'cb-faceplate__section' });
  toppersSection.append(el('p', { class: 'cb-faceplate__section-title', text: context.t('designer.topper.legend') }));
  const toppersList = el('div', {});
  const addTopperButton = el('button', { attrs: { type: 'button' }, text: context.t('designer.topper.add') });
  toppersSection.append(toppersList, addTopperButton);
  container.append(toppersSection);

  addTopperButton.addEventListener('click', () => {
    const firstTier = design.tiers[0];
    if (!firstTier) return;
    design = { ...design, toppers: [...design.toppers, buildDefaultTopper(firstTier.id)] };
    render();
  });

  // --- Verdicts -----------------------------------------------------------------------
  const verdictSection = el('div', { class: 'cb-faceplate__section' });
  const verdictBanner = el('p', { attrs: { role: 'status' } });
  const structureTitle = el('p', { class: 'cb-faceplate__section-title', text: context.t('designer.structure.title') });
  const structureList = el('ul', {});
  const thermalTitle = el('p', { class: 'cb-faceplate__section-title', text: context.t('designer.thermal.title') });
  const thermalList = el('ul', {});
  const feasibilityTitle = el('p', { class: 'cb-faceplate__section-title', text: context.t('designer.feasibility.title') });
  const feasibilityList = el('ul', {});
  const costTitle = el('p', { class: 'cb-faceplate__section-title', text: context.t('designer.cost.title') });
  const costBody = el('dl', {});
  verdictSection.append(
    verdictBanner,
    structureTitle,
    structureList,
    thermalTitle,
    thermalList,
    feasibilityTitle,
    feasibilityList,
    costTitle,
    costBody,
  );
  container.append(verdictSection);

  root.append(container);

  // -----------------------------------------------------------------------------------
  // Row builders
  // -----------------------------------------------------------------------------------

  function optionSelect<T extends string>(
    idBase: string,
    labelKey: string,
    options: readonly { readonly id: T; readonly labelKey: string }[],
    current: T,
    onChange: (value: T) => void,
  ): HTMLElement {
    const selectId = `${idBase}-select`;
    const label = el('label', { attrs: { for: selectId }, text: context.t(labelKey) });
    const select = el('select', { attrs: { id: selectId } }) as HTMLSelectElement;
    for (const option of options) {
      const optionEl = el('option', { attrs: { value: option.id }, text: context.t(option.labelKey) }) as HTMLOptionElement;
      optionEl.selected = option.id === current;
      select.append(optionEl);
    }
    select.addEventListener('change', () => onChange(select.value as T));
    return el('div', { children: [label, select] });
  }

  function numberField(idBase: string, labelKey: string, value: number, step: number, onChange: (value: number) => void): HTMLElement {
    const inputId = `${idBase}-input`;
    const label = el('label', { attrs: { for: inputId }, text: context.t(labelKey) });
    const input = el('input', { attrs: { id: inputId, type: 'number', step: String(step), value: String(value) } }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) onChange(parsed);
    });
    return el('div', { children: [label, input] });
  }

  function checkboxField(idBase: string, labelKey: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
    const inputId = `${idBase}-checkbox`;
    const input = el('input', { attrs: { id: inputId, type: 'checkbox' } }) as HTMLInputElement;
    input.checked = checked;
    const label = el('label', { attrs: { for: inputId }, text: context.t(labelKey) });
    input.addEventListener('change', () => onChange(input.checked));
    return el('div', { children: [input, label] });
  }

  function removeButton(labelKey: string, onClick: () => void): HTMLElement {
    const button = el('button', { attrs: { type: 'button' }, text: context.t(labelKey) });
    button.addEventListener('click', onClick);
    return button;
  }

  function buildFinishRow(tier: DesignTier, finish: DesignFinish): HTMLElement {
    const idBase = `designer-finish-${finish.id}`;
    const fieldset = el('fieldset', {});
    fieldset.append(el('legend', { text: context.t('designer.finish.legend', { kind: context.t(finishKindCatalogueKey(finish.kind)) }) }));

    fieldset.append(
      optionSelect(
        `${idBase}-kind`,
        'designer.finish.kindLabel',
        FINISH_KINDS.map((kind) => ({ id: kind, labelKey: finishKindCatalogueKey(kind) })),
        finish.kind,
        (kind: FinishKind) => updateFinish(tier.id, finish.id, { ...finish, kind }),
      ),
      optionSelect(
        `${idBase}-substance`,
        'designer.finish.substanceLabel',
        SUBSTANCE_PRESETS,
        finish.substanceId,
        (substanceId) => updateFinish(tier.id, finish.id, { ...finish, substanceId }),
      ),
      numberField(`${idBase}-mass`, 'designer.finish.massLabel', Number(finish.massUg) / 1_000_000, 1, (grams) =>
        updateFinish(tier.id, finish.id, { ...finish, massUg: BigInt(Math.round(Math.max(0, grams) * 1_000_000)) }),
      ),
      numberField(`${idBase}-elapsed`, 'designer.finish.elapsedLabel', finish.elapsedSecondsSinceBake, 30, (seconds) =>
        updateFinish(tier.id, finish.id, { ...finish, elapsedSecondsSinceBake: Math.max(0, seconds) }),
      ),
      removeButton('designer.finish.remove', () => {
        design = replaceTier(design, tier.id, { ...tier, finishes: tier.finishes.filter((f) => f.id !== finish.id) });
        render();
      }),
    );
    return fieldset;
  }

  function updateFinish(tierId: string, finishId: string, next: DesignFinish): void {
    const tier = design.tiers.find((t) => t.id === tierId);
    if (!tier) return;
    design = replaceTier(design, tierId, { ...tier, finishes: tier.finishes.map((f) => (f.id === finishId ? next : f)) });
    render();
  }

  function buildFillingRow(tier: DesignTier, filling: ReturnType<typeof buildDefaultFilling>): HTMLElement {
    const idBase = `designer-filling-${filling.id}`;
    const fieldset = el('fieldset', {});
    fieldset.append(el('legend', { text: context.t('designer.filling.legend') }));
    fieldset.append(
      optionSelect(`${idBase}-substance`, 'designer.filling.substanceLabel', SUBSTANCE_PRESETS, filling.substanceId, (substanceId) =>
        updateFilling(tier.id, filling.id, { ...filling, substanceId }),
      ),
      numberField(`${idBase}-mass`, 'designer.filling.massLabel', Number(filling.massUg) / 1_000_000, 1, (grams) =>
        updateFilling(tier.id, filling.id, { ...filling, massUg: BigInt(Math.round(Math.max(0, grams) * 1_000_000)) }),
      ),
      removeButton('designer.filling.remove', () => {
        design = replaceTier(design, tier.id, { ...tier, fillings: tier.fillings.filter((f) => f.id !== filling.id) });
        render();
      }),
    );
    return fieldset;
  }

  function updateFilling(tierId: string, fillingId: string, next: ReturnType<typeof buildDefaultFilling>): void {
    const tier = design.tiers.find((t) => t.id === tierId);
    if (!tier) return;
    design = replaceTier(design, tierId, { ...tier, fillings: tier.fillings.map((f) => (f.id === fillingId ? next : f)) });
    render();
  }

  function buildTierRow(tier: DesignTier): HTMLElement {
    const idBase = `designer-tier-${tier.id}`;
    const fieldset = el('fieldset', {});
    fieldset.append(el('legend', { text: context.t('designer.tier.legend', { tier: tier.id, diameter: tier.diameterM.toFixed(2) }) }));

    fieldset.append(
      numberField(`${idBase}-diameter`, 'designer.tier.diameterLabel', tier.diameterM, 0.01, (diameterM) => {
        design = replaceTier(design, tier.id, { ...tier, diameterM: Math.max(0.01, diameterM) });
        render();
      }),
      checkboxField(`${idBase}-dowelled`, 'designer.tier.dowelledLabel', tier.dowelled, (dowelled) => {
        design = replaceTier(design, tier.id, { ...tier, dowelled });
        render();
      }),
      numberField(`${idBase}-dowelCount`, 'designer.tier.dowelCountLabel', tier.dowelCount, 1, (dowelCount) => {
        design = replaceTier(design, tier.id, { ...tier, dowelCount: Math.max(0, Math.round(dowelCount)) });
        render();
      }),
    );

    const layer = tier.layers[0];
    if (layer) {
      const layerIdBase = `${idBase}-layer`;
      fieldset.append(
        optionSelect(
          `${layerIdBase}-formulation`,
          'designer.tier.layerFormulationLabel',
          FORMULATION_PRESETS.map((preset) => ({ id: preset.id, labelKey: preset.labelKey })),
          FORMULATION_PRESETS.find((preset) => preset.formulation.name === layer.formulation.name)?.id ?? FORMULATION_PRESETS[0]!.id,
          (presetId) => {
            const preset = FORMULATION_PRESETS.find((p) => p.id === presetId) ?? FORMULATION_PRESETS[0]!;
            const nextLayer = { ...layer, formulation: preset.formulation };
            design = replaceTier(design, tier.id, { ...tier, layers: [nextLayer] });
            render();
          },
        ),
        numberField(`${layerIdBase}-mass`, 'designer.tier.layerMassLabel', Number(layer.massUg) / 1_000_000, 10, (grams) => {
          const nextLayer = { ...layer, massUg: BigInt(Math.round(Math.max(1, grams) * 1_000_000)) };
          design = replaceTier(design, tier.id, { ...tier, layers: [nextLayer] });
          render();
        }),
      );
    }

    // Fillings.
    const fillingsBox = el('div', { children: tier.fillings.map((filling) => buildFillingRow(tier, filling)) });
    const addFillingButton = el('button', { attrs: { type: 'button' }, text: context.t('designer.filling.add') });
    addFillingButton.addEventListener('click', () => {
      design = replaceTier(design, tier.id, { ...tier, fillings: [...tier.fillings, buildDefaultFilling()] });
      render();
    });
    fieldset.append(fillingsBox, addFillingButton);

    // Finishes.
    const finishesBox = el('div', { children: tier.finishes.map((finish) => buildFinishRow(tier, finish)) });
    const addFinishButton = el('button', { attrs: { type: 'button' }, text: context.t('designer.finish.add') });
    addFinishButton.addEventListener('click', () => {
      design = replaceTier(design, tier.id, { ...tier, finishes: [...tier.finishes, buildDefaultFinish('icing')] });
      render();
    });
    fieldset.append(finishesBox, addFinishButton);

    fieldset.append(
      removeButton('designer.tier.remove', () => {
        design = {
          ...design,
          tiers: design.tiers.filter((t) => t.id !== tier.id),
          toppers: design.toppers.filter((topper) => topper.tierId !== tier.id),
        };
        render();
      }),
    );

    return fieldset;
  }

  /** A tier id is a plain internal identifier with no catalogue entry of its own —
   * exactly like `faceplate/render.ts`'s own `machine.label`/`tag.label`, shown as-is
   * in every register (see that module's doc comment for why). Built directly, rather
   * than through `optionSelect`, so this is the one control in the panel whose option
   * text is real but deliberately untranslated, not an empty placeholder standing in
   * for one. */
  function tierSelect(idBase: string, current: string, onChange: (tierId: string) => void): HTMLElement {
    const selectId = `${idBase}-select`;
    const label = el('label', { attrs: { for: selectId }, text: context.t('designer.topper.tierLabel') });
    const select = el('select', { attrs: { id: selectId } }) as HTMLSelectElement;
    for (const tier of design.tiers) {
      const optionEl = el('option', { attrs: { value: tier.id }, text: tier.id }) as HTMLOptionElement;
      optionEl.selected = tier.id === current;
      select.append(optionEl);
    }
    select.addEventListener('change', () => onChange(select.value));
    return el('div', { children: [label, select] });
  }

  function buildTopperRow(topper: ReturnType<typeof buildDefaultTopper>): HTMLElement {
    const idBase = `designer-topper-${topper.id}`;
    const fieldset = el('fieldset', {});
    fieldset.append(el('legend', { text: context.t('designer.topper.legend') }));
    fieldset.append(
      tierSelect(`${idBase}-tier`, topper.tierId, (tierId) => updateTopper(topper.id, { ...topper, tierId })),
      optionSelect(`${idBase}-substance`, 'designer.topper.substanceLabel', SUBSTANCE_PRESETS, topper.substanceId, (substanceId) =>
        updateTopper(topper.id, { ...topper, substanceId }),
      ),
      numberField(`${idBase}-mass`, 'designer.topper.massLabel', Number(topper.massUg) / 1_000_000, 1, (grams) =>
        updateTopper(topper.id, { ...topper, massUg: BigInt(Math.round(Math.max(0, grams) * 1_000_000)) }),
      ),
      removeButton('designer.topper.remove', () => {
        design = { ...design, toppers: design.toppers.filter((t) => t.id !== topper.id) };
        render();
      }),
    );
    return fieldset;
  }

  function updateTopper(topperId: string, next: ReturnType<typeof buildDefaultTopper>): void {
    design = { ...design, toppers: design.toppers.map((t) => (t.id === topperId ? next : t)) };
    render();
  }

  // -----------------------------------------------------------------------------------
  // Render: rebuild every list from `design`, then re-evaluate and show every verdict.
  // -----------------------------------------------------------------------------------

  function renderElevation(): void {
    const geometry = computeElevationGeometry(design);
    const width = 300;
    const height = 220;
    const margin = 20;
    const scaleY = geometry.totalHeightM > 0 ? (height - 2 * margin) / geometry.totalHeightM : 1;
    const scaleX = geometry.maxDiameterM > 0 ? (width - 2 * margin) / geometry.maxDiameterM : 1;

    for (const child of [...svg.children]) {
      if (child !== svgTitle && child !== svgDesc) child.remove();
    }
    for (const rect of geometry.tiers) {
      const w = rect.diameterM * scaleX;
      const h = rect.heightM * scaleY;
      const x = width / 2 - w / 2;
      const y = height - margin - (rect.bottomM + rect.heightM) * scaleY;
      const svgRect = svgEl('rect', {
        x: String(x),
        y: String(y),
        width: String(Math.max(1, w)),
        height: String(Math.max(1, h)),
        class: rect.dowelled ? 'cb-designer__tier-rect cb-designer__tier-rect--dowelled' : 'cb-designer__tier-rect',
      });
      svg.append(svgRect);
    }

    svgTitle.textContent = context.t('designer.elevation.svgTitle');
    svgDesc.textContent = context.t('designer.elevation.svgDesc', {
      tierCount: design.tiers.length,
      totalHeight: geometry.totalHeightM.toFixed(2),
    });

    tbody.replaceChildren(
      ...design.tiers.map((tier) =>
        el('tr', {
          children: [
            el('th', { attrs: { scope: 'row' }, text: tier.id }),
            el('td', { text: tier.diameterM.toFixed(2) }),
            el('td', { text: geometry.tiers.find((r) => r.tierId === tier.id)?.heightM.toFixed(3) ?? '0' }),
          ],
        }),
      ),
    );
  }

  function renderVerdicts(evaluation: DesignEvaluation): void {
    verdictBanner.textContent = context.t(evaluation.accepted ? 'designer.verdict.accepted' : 'designer.verdict.refused');

    structureList.replaceChildren(
      ...evaluation.structure.tiers.flatMap((verdict) =>
        verdict.problems.map((problem) =>
          el('li', { text: describeStructuralProblem(context.t, verdict, problem) }),
        ),
      ),
    );

    thermalList.replaceChildren(
      ...evaluation.thermal.finishes.flatMap((verdict) =>
        verdict.problems.map((problem) =>
          el('li', { text: describeThermalProblem(context.t, verdict.kind, verdict.productTempC, problem) }),
        ),
      ),
    );

    feasibilityList.replaceChildren(
      ...evaluation.feasibility.problems.map((problem) => el('li', { text: describeFeasibilityProblem(context.t, problem) })),
    );

    const cost = evaluation.cost;
    costBody.replaceChildren(
      el('dt', { text: context.t('designer.cost.material') }),
      el('dd', { text: formatMoney(cost.materialCostMinorUnits.toString()) }),
      el('dt', { text: context.t('designer.cost.labor') }),
      el('dd', { text: formatMoney(cost.laborCostMinorUnits.toString()) }),
      el('dt', { text: context.t('designer.cost.total') }),
      el('dd', { text: formatMoney(cost.totalCostMinorUnits.toString()) }),
    );
    if (!cost.complete) costBody.append(el('p', { text: context.t('designer.cost.incomplete') }));

    if (lastAccepted !== null && lastAccepted !== evaluation.accepted) {
      context.announce(
        context.t(evaluation.accepted ? 'designer.announce.accepted' : 'designer.announce.refused'),
        evaluation.accepted ? 'polite' : 'assertive',
      );
    }
    lastAccepted = evaluation.accepted;
  }

  function render(): void {
    tiersList.replaceChildren(...design.tiers.map((tier) => buildTierRow(tier)));
    toppersList.replaceChildren(...design.toppers.map((topper) => buildTopperRow(topper)));

    const evaluation = evaluateDesign(design, {
      inventory: REFERENCE_INVENTORY,
      line: REFERENCE_LINE,
      prices: REFERENCE_PRICES,
      hourlyWageMinorUnits: REFERENCE_HOURLY_WAGE_MINOR_UNITS,
    });
    renderVerdicts(evaluation);
    renderElevation();
  }

  render();

  return () => {
    container.remove();
  };
}
