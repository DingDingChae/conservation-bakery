/**
 * A synthetic supply chain shared by this directory's tests: a field feeding a
 * mill feeding two batches, one of which is blended with a delivered ingredient,
 * six hops deep from the finished cake back to its furthest root (wheat).
 *
 * Every posting here is a real, balanced `Posting` applied through a real
 * `Ledger`, with a `LotGraph` wired to `onPosting` exactly as a real caller would
 * wire it — this is not a shortcut fixture that only exercises the graph in
 * isolation. `graph.spec.ts`, `closure.spec.ts` and `export.spec.ts` all exercise
 * this identical chain rather than three subtly different ones.
 *
 *                              wheat (root)
 *                                |  1,000,000
 *                              grain            (loss: chaff 100,000)
 *                                |  900,000
 *                              flour            (loss: bran 150,000)
 *                               / \
 *                  450,000    /   \ 300,000
 *                         batter-a  batter-b     sugar (root, 100,000)
 *                            |         \         /
 *                    450,000|      300,000\  100,000
 *                            |             blended-batter
 *                            |                | 400,000
 *                   (loss: moisture 50,000)   |  (loss: moisture 40,000)
 *                            |                |
 *                        baked-a         baked-blend
 *                     400,000 \           / 360,000
 *                               \         /
 *                              finished-cake        (loss: trim 20,000)
 *                                 740,000
 */

import { elementCommodity } from '../core/commodity.js';
import { Ledger, type AccountSpec } from '../core/ledger.js';
import { encodeLotCreations, type LotCreationSpec, type LotId } from './lot.js';
import { LotGraph } from './graph.js';

/** Stand-in conserved commodity for "mass" in this synthetic chain. */
const MASS = elementCommodity('C');

export interface SyntheticChain {
  readonly ledger: Ledger;
  readonly graph: LotGraph;
  readonly ids: {
    readonly wheat: LotId;
    readonly grain: LotId;
    readonly flour: LotId;
    readonly batterA: LotId;
    readonly batterB: LotId;
    readonly sugar: LotId;
    readonly blended: LotId;
    readonly bakedA: LotId;
    readonly bakedBlend: LotId;
    readonly cake: LotId;
  };
}

function at(ids: readonly LotId[], index: number): LotId {
  const id = ids[index];
  if (id === undefined) throw new Error(`fixture: expected a lot id at index ${index}`);
  return id;
}

export function buildSyntheticChain(): SyntheticChain {
  const graph = new LotGraph();
  const ledger = new Ledger({ onPosting: graph.consume });

  for (const id of [
    'field',
    'thresher',
    'mill',
    'batchA',
    'batchB',
    'sugarStore',
    'blendVat',
    'ovenA',
    'ovenBlend',
    'cakeStore',
    'byproducts',
  ]) {
    ledger.openAccount({ id, kind: 'stock', label: id } satisfies AccountSpec);
  }
  ledger.openAccount({ id: 'atmosphere', kind: 'reservoir', label: 'atmosphere' });

  function post(
    process: string,
    entries: readonly { account: string; delta: bigint }[],
    specs: readonly LotCreationSpec[],
  ): readonly LotId[] {
    const applied = ledger.post({
      process,
      entries: entries.map((e) => ({ account: e.account, commodity: MASS, delta: e.delta })),
      note: encodeLotCreations(specs),
    });
    return specs.map((_, index) => `lot:${applied.seq}:${index}`);
  }

  const wheat = at(
    post(
      'harvest',
      [
        { account: 'genesis', delta: -1_000_000n },
        { account: 'field', delta: 1_000_000n },
      ],
      [{ substance: 'wheat', mass: 1_000_000n, parents: [] }],
    ),
    0,
  );

  const grain = at(
    post(
      'thresh',
      [
        { account: 'field', delta: -1_000_000n },
        { account: 'thresher', delta: 900_000n },
        { account: 'byproducts', delta: 100_000n },
      ],
      [
        {
          substance: 'grain',
          mass: 900_000n,
          parents: [{ lotId: wheat, mass: 1_000_000n }],
          losses: [{ reason: 'chaff', mass: 100_000n }],
        },
      ],
    ),
    0,
  );

  const flour = at(
    post(
      'mill',
      [
        { account: 'thresher', delta: -900_000n },
        { account: 'mill', delta: 750_000n },
        { account: 'byproducts', delta: 150_000n },
      ],
      [
        {
          substance: 'flour',
          mass: 750_000n,
          parents: [{ lotId: grain, mass: 900_000n }],
          losses: [{ reason: 'bran', mass: 150_000n }],
        },
      ],
    ),
    0,
  );

  const batches = post(
    'split-batch',
    [
      { account: 'mill', delta: -750_000n },
      { account: 'batchA', delta: 450_000n },
      { account: 'batchB', delta: 300_000n },
    ],
    [
      { substance: 'batter-a', mass: 450_000n, parents: [{ lotId: flour, mass: 450_000n }] },
      { substance: 'batter-b', mass: 300_000n, parents: [{ lotId: flour, mass: 300_000n }] },
    ],
  );
  const batterA = at(batches, 0);
  const batterB = at(batches, 1);

  const sugar = at(
    post(
      'deliver-sugar',
      [
        { account: 'genesis', delta: -100_000n },
        { account: 'sugarStore', delta: 100_000n },
      ],
      [{ substance: 'sugar', mass: 100_000n, parents: [] }],
    ),
    0,
  );

  const blended = at(
    post(
      'blend',
      [
        { account: 'batchB', delta: -300_000n },
        { account: 'sugarStore', delta: -100_000n },
        { account: 'blendVat', delta: 400_000n },
      ],
      [
        {
          substance: 'blended-batter',
          mass: 400_000n,
          parents: [
            { lotId: batterB, mass: 300_000n },
            { lotId: sugar, mass: 100_000n },
          ],
        },
      ],
    ),
    0,
  );

  const bakedA = at(
    post(
      'bake-a',
      [
        { account: 'batchA', delta: -450_000n },
        { account: 'ovenA', delta: 400_000n },
        { account: 'atmosphere', delta: 50_000n },
      ],
      [
        {
          substance: 'baked-a',
          mass: 400_000n,
          parents: [{ lotId: batterA, mass: 450_000n }],
          losses: [{ reason: 'moisture', mass: 50_000n }],
        },
      ],
    ),
    0,
  );

  const bakedBlend = at(
    post(
      'bake-blend',
      [
        { account: 'blendVat', delta: -400_000n },
        { account: 'ovenBlend', delta: 360_000n },
        { account: 'atmosphere', delta: 40_000n },
      ],
      [
        {
          substance: 'baked-blend',
          mass: 360_000n,
          parents: [{ lotId: blended, mass: 400_000n }],
          losses: [{ reason: 'moisture', mass: 40_000n }],
        },
      ],
    ),
    0,
  );

  const cake = at(
    post(
      'assemble',
      [
        { account: 'ovenA', delta: -400_000n },
        { account: 'ovenBlend', delta: -360_000n },
        { account: 'cakeStore', delta: 740_000n },
        { account: 'byproducts', delta: 20_000n },
      ],
      [
        {
          substance: 'finished-cake',
          mass: 740_000n,
          parents: [
            { lotId: bakedA, mass: 400_000n },
            { lotId: bakedBlend, mass: 360_000n },
          ],
          losses: [{ reason: 'trim', mass: 20_000n }],
        },
      ],
    ),
    0,
  );

  return {
    ledger,
    graph,
    ids: {
      wheat,
      grain,
      flour,
      batterA,
      batterB,
      sugar,
      blended,
      bakedA,
      bakedBlend,
      cake,
    },
  };
}
