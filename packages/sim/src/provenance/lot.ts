/**
 * Lots: the unit of provenance.
 *
 * A `Lot` is an identified parcel of material — a sack of milled flour, a bowl of
 * batter, a finished cake. Unlike the ledger's accounts (which hold running balances
 * of a commodity), a lot is a point-in-time record: it names exactly which parent
 * lots it was made from and how much mass each parent contributed, so a player can
 * walk a finished cake back to the field it grew in.
 *
 * Lots are not conserved quantities in the ledger's sense — they are a derived,
 * read-only view built from postings that *do* move conserved quantities. See
 * `graph.ts` for how a stream of `AppliedPosting`s becomes a lot graph, and
 * `closure.ts` for the audit that a lot's declared parentage actually accounts for
 * its mass.
 */

import type { Micrograms } from '../core/commodity.js';

export type LotId = string;

/**
 * What a lot is made of, in the sense a player cares about ("milled flour", "cake
 * batter"), as opposed to its elemental composition. There is no registry for this
 * here — it is an opaque identifier owned by whichever recipe/process code assigns
 * it — but it is what "ancestry" is displayed against.
 */
export type SubstanceId = string;

/** How much mass one parent lot contributed to the lot it helped make. */
export interface ParentContribution {
  readonly lotId: LotId;
  /** Micrograms. Always non-negative: a contribution cannot be a withdrawal. */
  readonly mass: Micrograms;
}

/**
 * Mass that a process declared lost while turning its parents into this lot —
 * trim, evaporation, ash, scrap. Declaring it is what lets `closure.ts` check the
 * books exactly rather than accepting "close enough".
 */
export interface LotLoss {
  readonly reason: string;
  /** Micrograms. Always non-negative. */
  readonly mass: Micrograms;
}

export interface Lot {
  readonly id: LotId;
  readonly substance: SubstanceId;
  /** This lot's own mass, in micrograms. */
  readonly mass: Micrograms;
  /** The simulation tick at which this lot came into being. */
  readonly tick: number;
  /** The process that made it, verbatim from the posting that created it. */
  readonly process: string;
  /**
   * The lots this one was made from, and exactly how much mass each contributed.
   * Empty for a root lot — one whose material entered the lot graph directly from
   * a ledger reservoir or external account (soil, atmosphere, sun, a supplier) and
   * therefore has no lot ancestry of its own. Root lots are still real: their
   * conservation is checked by `Ledger.audit()`, not by `closure.ts`.
   */
  readonly parents: readonly ParentContribution[];
  readonly losses: readonly LotLoss[];
}

/**
 * Deterministic lot id, derived from the posting that created it.
 *
 * `seq` is the ledger's own monotonic posting counter (`AppliedPosting.seq`),
 * already deterministic and gap-free. `index` distinguishes multiple lots created
 * by the same posting (a split producing two batches from one mix). Never derived
 * from `Date.now()`, `Math.random()`, or any other non-reproducible source — a
 * save/replay must produce identical lot ids every time.
 */
export function deriveLotId(seq: number, index: number): LotId {
  return `lot:${seq}:${index}`;
}

/**
 * The description of one lot's creation, as declared by the process that made it.
 * This is the payload a process encodes onto a `Posting` (see `encodeLotCreations`)
 * for `LotGraph` to pick up; it carries everything about a `Lot` except the id,
 * tick and process, which are supplied by the posting itself.
 */
export interface LotCreationSpec {
  readonly substance: SubstanceId;
  readonly mass: Micrograms;
  readonly parents: readonly ParentContribution[];
  readonly losses?: readonly LotLoss[];
}

interface EncodedContribution {
  readonly lotId: LotId;
  readonly mass: string;
}

interface EncodedLoss {
  readonly reason: string;
  readonly mass: string;
}

interface EncodedLotCreation {
  readonly substance: SubstanceId;
  readonly mass: string;
  readonly parents: readonly EncodedContribution[];
  readonly losses: readonly EncodedLoss[];
}

/**
 * The tag `Posting.note` is prefixed with when it carries lot-creation data.
 *
 * `Posting.note` is otherwise a free-text diagnostic string owned by `ledger.ts`.
 * Using a tagged prefix, rather than repurposing the field wholesale, means a
 * posting can still fail loudly (via `decodeLotCreations` returning `undefined`)
 * if some other process has put unrelated text there, instead of silently
 * misparsing it as provenance.
 */
const NOTE_TAG = 'provenance:lots:v1';

/**
 * Encode one or more lot creations onto a posting's `note`, so that `LotGraph`
 * (subscribed to `Ledger`'s `onPosting` hook) can rebuild them without the ledger
 * itself knowing anything about lots. Bigints are carried as decimal strings —
 * `JSON.stringify` cannot serialise a `bigint` directly.
 */
export function encodeLotCreations(specs: readonly LotCreationSpec[]): string {
  const encoded: readonly EncodedLotCreation[] = specs.map((spec) => ({
    substance: spec.substance,
    mass: spec.mass.toString(),
    parents: spec.parents.map((parent) => ({
      lotId: parent.lotId,
      mass: parent.mass.toString(),
    })),
    losses: (spec.losses ?? []).map((loss) => ({
      reason: loss.reason,
      mass: loss.mass.toString(),
    })),
  }));
  return `${NOTE_TAG}:${JSON.stringify(encoded)}`;
}

/**
 * Recover the lot creations from a posting's `note`, or `undefined` if this
 * posting does not carry any (the overwhelming majority of postings — a simple
 * energy transfer, say — do not create a lot at all).
 */
export function decodeLotCreations(
  note: string | undefined,
): readonly LotCreationSpec[] | undefined {
  if (note === undefined || !note.startsWith(`${NOTE_TAG}:`)) return undefined;
  const json = note.slice(NOTE_TAG.length + 1);
  const encoded = JSON.parse(json) as readonly EncodedLotCreation[];
  return encoded.map((spec) => ({
    substance: spec.substance,
    mass: BigInt(spec.mass),
    parents: spec.parents.map((parent) => ({
      lotId: parent.lotId,
      mass: BigInt(parent.mass),
    })),
    losses: spec.losses.map((loss) => ({
      reason: loss.reason,
      mass: BigInt(loss.mass),
    })),
  }));
}
