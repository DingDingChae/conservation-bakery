/**
 * Pure transforms for the ancestry screen (`tree.ts`).
 *
 * `flattenProvenanceTree` is the one function this module exists to export: it takes
 * the `ProvenanceNode` tree `RendererContext.provenance()` resolves and turns it into
 * a flat, indexed list a real ARIA tree (`role="tree"` / `role="treeitem"`) can render
 * without recursion at draw time, and that a test can assert against without touching
 * the DOM at all. Keeping it pure and side-effect-free is what makes "test THAT
 * thoroughly" possible — no mock `RendererContext`, no jsdom, just data in, data out.
 *
 * `formatMicrogramsAsGrams` exists for the same reason CONTRACT.md's rule 1 exists:
 * a lot's mass arrives as an `ExactString` micrograms count, and the two rules forbid
 * ever routing that through `Number`/`parseFloat` to compute a displayed decimal —
 * that is exactly the kind of silent, unaudited rounding rule 1 is written against.
 * Shifting the decimal point six places is a string operation, not arithmetic, so it
 * cannot introduce drift no matter how many digits the value has.
 */

import type { ExactString, ProvenanceNode } from '../../shared/ipc.js';

/**
 * The world accounts CONTRACT.md names as having "no outside": reaching one of these
 * as a walk's root is the payoff the ancestry screen exists to show. Distinct from a
 * `market.*` root, which is a real, sourced delivery but not "the world itself" —
 * see `RootKind` below.
 */
const WORLD_ROOT_PREFIXES: readonly string[] = ['atmosphere', 'groundwater', 'surface-water', 'sun', 'soil.'];

/**
 * What kind of root a leaf of the ancestry walk turned out to be, for a caller that
 * wants to render "reached the atmosphere" differently from "reached a supplier" —
 * both are honest roots (neither is truncation), but only the former is the world
 * having no outside.
 */
export type RootKind = 'world' | 'market' | 'other';

/** True if a substance/account id names one of the finite planetary reservoirs. */
export function isWorldRootSubstance(substanceId: string): boolean {
  return WORLD_ROOT_PREFIXES.some(
    (prefix) => substanceId === prefix || substanceId.startsWith(prefix),
  );
}

function classifyRoot(substanceId: string): RootKind {
  if (isWorldRootSubstance(substanceId)) return 'world';
  if (substanceId === 'market.suppliers' || substanceId.startsWith('market.')) return 'market';
  return 'other';
}

/**
 * One flattened, renderable row of the ancestry tree.
 *
 * `index` is this row's position in the flat array `flattenProvenanceTree` returns —
 * the "indexed" half of the contract, so a renderer can look a row up by number
 * (`document.getElementById(rowDomId(row))`, `rows[index]`) without re-walking the
 * tree. `parentIndex` and `childIndices` carry the same shape the original
 * `ProvenanceNode` tree had, just addressed by index instead of by reference, so
 * expand/collapse and arrow-key traversal can be implemented as plain array lookups.
 */
export interface ProvenanceRow {
  readonly index: number;
  readonly parentIndex: number | null;
  readonly childIndices: readonly number[];
  /** 0 for the lot the walk started from. */
  readonly depth: number;
  readonly lotId: string;
  readonly substanceId: string;
  readonly label: string;
  /** Exact micrograms, as the wire carried it — never parsed to a `number`. */
  readonly mass: ExactString;
  readonly tick: number;
  readonly process: string;
  readonly hasChildren: boolean;
  /**
   * This exact node's own `truncated` flag from the `ProvenanceNode` the server sent —
   * true when the walk stopped *here* because a depth or lot cap was hit, not because
   * this lot genuinely has no further ancestry. A row with `hasChildren === false` and
   * `truncated === true` must never be presented as a reached root; see `rootKind`.
   */
  readonly truncated: boolean;
  /**
   * `'world' | 'market'` only when this row is a genuine, un-truncated leaf (no
   * children, not truncated) — the walk actually reached this account and stopped
   * because there was nowhere further to go. `undefined` for every other row,
   * including a truncated leaf, so a renderer can tell "this is the atmosphere" apart
   * from "we stopped looking before finding out".
   */
  readonly rootKind: RootKind | undefined;
}

/** True if any row in the list was truncated — the walk-wide banner condition. */
export function anyRowTruncated(rows: readonly ProvenanceRow[]): boolean {
  return rows.some((row) => row.truncated);
}

/**
 * Flatten a `ProvenanceNode` tree into a pre-order (parent immediately before its
 * children, children in the order the server sent them) indexed row list.
 *
 * Pre-order is what a tree view actually paints top to bottom, and it is also the
 * order the Kid register's "sun to wheat to flour to cake" reading needs when a
 * caller walks the array root-first — the story reads in array order without any
 * further reordering, whichever direction (ancestors-of vs. descendants-of) the
 * source walk was.
 */
export function flattenProvenanceTree(root: ProvenanceNode): readonly ProvenanceRow[] {
  const rows: ProvenanceRow[] = [];

  // Two-pass per node: push a placeholder-free real row first (so its `index` is
  // known before its children need `parentIndex`), then recurse into children and
  // patch this row's `childIndices` afterward. `rows` is built in final pre-order
  // the whole time, so no second sort or index remap is ever needed.
  function visit(node: ProvenanceNode, parentIndex: number | null, depth: number): number {
    const index = rows.length;
    const truncated = node.truncated === true;
    const hasChildren = node.children.length > 0;
    rows.push({
      index,
      parentIndex,
      childIndices: [], // patched below, once known
      depth,
      lotId: node.lotId,
      substanceId: node.substanceId,
      label: node.label,
      mass: node.mass,
      tick: node.tick,
      process: node.process,
      hasChildren,
      truncated,
      rootKind: !hasChildren && !truncated ? classifyRoot(node.substanceId) : undefined,
    });

    const childIndices: number[] = [];
    for (const child of node.children) {
      childIndices.push(visit(child, index, depth + 1));
    }
    if (childIndices.length > 0) {
      // `rows[index]` is a plain object, not a class instance with private state, so
      // replacing it wholesale (rather than mutating a field) keeps every row in this
      // module's output equally immutable to a caller holding an earlier reference.
      const current = rows[index];
      if (current) rows[index] = { ...current, childIndices };
    }
    return index;
  }

  visit(root, null, 0);
  return rows;
}

/**
 * Render an exact micrograms `ExactString` as grams, to the full precision the
 * underlying integer carries, using only string slicing — never `Number`/`parseFloat`
 * (CONTRACT.md rule 1: a conserved quantity is formatted, not computed, for display).
 *
 * `1 g === 1,000,000 ug` (see `packages/sim/src/core/commodity.ts`'s `UG_PER_G`), so
 * the gram value is exactly the microgram digit string with a decimal point six
 * places from the right. Trailing zero digits after the point are trimmed (dropping
 * "1.000000" to "1") — this loses no precision, since a zero digit contributes
 * nothing to the exact value it names.
 */
export function formatMicrogramsAsGrams(massUg: ExactString): string {
  const negative = massUg.startsWith('-');
  const digits = negative ? massUg.slice(1) : massUg;
  const padded = digits.padStart(7, '0'); // at least one integer digit ahead of 6 decimal digits
  const wholePart = padded.slice(0, -6);
  const fractionPart = padded.slice(-6).replace(/0+$/, '');
  const trimmedWhole = wholePart.replace(/^0+(?=\d)/, ''); // "007" -> "7", but keep a lone "0"
  const value = fractionPart.length > 0 ? `${trimmedWhole}.${fractionPart}` : trimmedWhole;
  return negative && value !== '0' ? `-${value}` : value;
}
