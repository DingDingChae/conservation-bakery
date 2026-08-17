/**
 * Serialise a lot, a provenance walk, or a whole graph for an outside audit.
 *
 * `bigint` cannot survive `JSON.stringify` or a CSV cell directly, so every mass
 * here is written as a decimal string and must be parsed back with `BigInt(...)`,
 * never `Number(...)` — the whole point of this module is that the exact value
 * leaves the simulation exactly as it was inside it.
 */

import type { Lot, LotId } from './lot.js';
import type { AncestorResult, DescendantResult, ProvenanceEdge } from './graph.js';
import type { LotGraph } from './graph.js';

export interface SerialisedLot {
  readonly id: LotId;
  readonly substance: string;
  readonly mass: string;
  readonly tick: number;
  readonly process: string;
  readonly parents: readonly { readonly lotId: LotId; readonly mass: string }[];
  readonly losses: readonly { readonly reason: string; readonly mass: string }[];
}

export interface SerialisedEdge {
  readonly parent: LotId;
  readonly child: LotId;
  readonly mass: string;
}

export interface SerialisedTree {
  readonly lots: readonly SerialisedLot[];
  readonly edges: readonly SerialisedEdge[];
  readonly truncated: boolean;
  readonly truncatedAt: readonly LotId[];
  /** Present for an ancestor walk. */
  readonly roots?: readonly LotId[];
  /** Present for a descendant walk. */
  readonly leaves?: readonly LotId[];
}

export function serialiseLot(lot: Lot): SerialisedLot {
  return {
    id: lot.id,
    substance: lot.substance,
    mass: lot.mass.toString(),
    tick: lot.tick,
    process: lot.process,
    parents: lot.parents.map((parent) => ({
      lotId: parent.lotId,
      mass: parent.mass.toString(),
    })),
    losses: lot.losses.map((loss) => ({
      reason: loss.reason,
      mass: loss.mass.toString(),
    })),
  };
}

function serialiseEdge(edge: ProvenanceEdge): SerialisedEdge {
  return { parent: edge.parent, child: edge.child, mass: edge.mass.toString() };
}

/** Serialise every lot the graph has ever recorded, in creation order. */
export function serialiseGraph(graph: LotGraph): readonly SerialisedLot[] {
  return graph.lots().map(serialiseLot);
}

export function exportGraphToJson(graph: LotGraph): string {
  return JSON.stringify(serialiseGraph(graph), null, 2);
}

/**
 * Serialise an `ancestors()` or `descendants()` result: the lots and edges the
 * walk actually reached, plus honest truncation reporting so an auditor reading
 * only the JSON can tell whether the tree is complete.
 */
export function serialiseTree(result: AncestorResult | DescendantResult): SerialisedTree {
  const base = {
    lots: [...result.lots.values()].map(serialiseLot),
    edges: result.edges.map(serialiseEdge),
    truncated: result.truncated,
    truncatedAt: result.truncatedAt,
  };
  if ('roots' in result) return { ...base, roots: result.roots };
  return { ...base, leaves: result.leaves };
}

export function exportTreeToJson(result: AncestorResult | DescendantResult): string {
  return JSON.stringify(serialiseTree(result), null, 2);
}

/** Quote a CSV field only if it needs it, per RFC 4180. */
function csvField(value: string | number | boolean): string {
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(fields: readonly (string | number | boolean)[]): string {
  return fields.map(csvField).join(',');
}

/**
 * One row per lot. Parents and losses — each lot may have any number of either —
 * are packed into a single cell each (`;`-separated `lotId:mass` / `reason:mass`
 * pairs) so the file stays one row per lot rather than a variable-width table.
 */
export function exportGraphToCsv(graph: LotGraph): string {
  const header = csvRow([
    'id',
    'substance',
    'mass_ug',
    'tick',
    'process',
    'parents',
    'losses',
  ]);
  const rows = graph.lots().map((lot) =>
    csvRow([
      lot.id,
      lot.substance,
      lot.mass.toString(),
      lot.tick,
      lot.process,
      lot.parents.map((p) => `${p.lotId}:${p.mass.toString()}`).join(';'),
      lot.losses.map((l) => `${l.reason}:${l.mass.toString()}`).join(';'),
    ]),
  );
  return [header, ...rows].join('\r\n');
}

/** One row per edge — the shape an outside grapher (Graphviz, a spreadsheet) wants. */
export function exportTreeToCsv(result: AncestorResult | DescendantResult): string {
  const header = csvRow(['parent', 'child', 'mass_ug']);
  const rows = result.edges.map((edge) =>
    csvRow([edge.parent, edge.child, edge.mass.toString()]),
  );
  return [header, ...rows].join('\r\n');
}
