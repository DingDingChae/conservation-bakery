# Architecture — `packages/sim`

`packages/sim` is the deterministic simulation core. This document maps its
modules and states the seam rule that keeps it trustworthy.

## The seam

`packages/sim` never imports from `app` (the Electron shell) or `design` (the
UI component/token package). It has **no DOM dependency and no Node-only
dependency** — it must run headless, in a worker, under a plain test runner,
or inside a replay tool with no window, no filesystem, and no network.

The renderer *observes* simulation state; it never owns canonical state.
Concretely: nothing in `app` may write to a `Ledger` account directly, nothing
in `packages/sim` may format a string for display, and no simulation module
may depend on a type defined in `app` or `design`. This is what makes
headless replay, property tests over thousands of ticks, and a byte-identical
audit export possible — the simulation's behaviour cannot depend on anything
that only exists on screen.

Only `import type` may ever point in the other direction (for example, a
presentation-layer type that re-exports a `sim` type for convenience); no
runtime dependency crosses from `sim` toward `app` or `design`.

## Current modules

The modules below exist, are tested, and pass. `packages/app` (the Electron
shell) and `packages/design` (the synced design-token/component package)
named in `docs/PLAN.md` do not exist yet — see "Planned modules" below.

### `packages/sim/src/core`

The reviewed seam that every other module in `sim` is built against.

- **`commodity.ts`** — defines the set of conserved commodities
  (`CommodityId`): elemental mass (`el:<Element>`, in micrograms), energy
  (`energy:uJ`, in microjoules), and money (`cash:<CODE>`, in minor units).
  Provides the `bigint` unit-conversion helpers (`grams`, `kilograms`,
  `joules`, `scale`, `roundHalfEven`) that are the single sanctioned boundary
  between floating-point physics and the exact ledger, the `Composition` map
  for describing a parcel of material by element, and `partition()`, the
  only sanctioned way to split an exact `bigint` quantity across multiple
  destinations without leaking a rounding residual.
- **`ledger.ts`** — defines `Ledger`, the double-entry account system that
  enforces Rule 1 of `CONTRACT.md`. Accounts are `stock` (real holdings,
  never negative), `reservoir` (finite natural stores, never negative), or
  `external` (counterparties outside the fence — suppliers, customers, the
  grid, and `genesis`, the one-time source of everything the world starts
  with). The only mutation is `post(posting)`, which applies a `Posting` only
  if its entries sum to exactly `0n` for every commodity they touch, and only
  if no `stock` or `reservoir` account would go negative. `audit()`
  re-derives the whole-world sum from scratch, independent of any running
  total, so it catches anything that bypassed `post`.

### `packages/sim/src/clock`

The determinism layer: a seeded PRNG, a fixed-step clock, an input log, and a
stable state digest, so a run is replayable byte-for-byte.

- **`rng.ts`** — `Rng`, a seeded xoshiro128** PRNG implemented with only
  32-bit integer operations so the same seed produces the same sequence on
  every platform.
- **`clock.ts`** — `Clock`, advancing simulated time in fixed 1-second ticks
  driven only by an explicit tick count, never by wall-clock time, so 60
  individual ticks and one batched `advance(60)` produce identical state.
- **`journal.ts`** — `Journal`, the ordered input log (seed, start instant,
  timestamped commands) that a run is fully determined by.
- **`digest.ts`** — `canonicalize` and `digest`, turning simulation state
  into a stable, key-order-independent hash so two replays can be compared
  for byte-identical equality.

### `packages/sim/src/world`

The planetary layer: "the world has no outside" (`CONTRACT.md`), implemented
as finite, sourced accounts rather than an assumption.

- **`accounts.ts`** — `seedWorld` opens the fixed planetary accounts
  (atmosphere, groundwater, surface water, sun) plus one soil account per
  field, each with a one-time starting balance drawn from `GENESIS`.
- **`exchange.ts`** — balanced `Posting`-builders for the exchanges those
  reservoirs actually undergo: `combustMethane`, `respire`, `photosynthesize`,
  `evaporate`, `condense`. Each conserves every element exactly by real molar
  mass; none of them touch a `Ledger` directly, so there is no path for one
  to slip material into the world outside a balanced entry set.

### `packages/sim/src/process`

The control-layer framework every machine faceplate will be driven by. Model
only — no UI, no DOM, no Electron.

- **`machine.ts`** — `Machine`, a single data-driven class run from a
  `MachineDefinition` (tags, engineering ranges, wear components); there is
  no subclass per physical machine.
- **`pid.ts`** — `PidController`, with clamping anti-windup and bumpless
  MANUAL/AUTO transfer, deterministic because it only ever advances on a
  caller-supplied `dt`.
- **`interlock.ts`** — declarative interlocks that refuse a command and
  explain why, always in terms of equipment or product integrity (rule 2).
- **`alarm.ts`** — `Alarm` and `AlarmGroup`, the
  normal → active-unacknowledged → active-acknowledged → cleared state
  machine behind the annunciator tiles.
- **`failure.ts`** — `WearComponent`, equipment degradation as a function of
  run hours and duty, ending in a component being condemned and taken out of
  service (never anything happening to a person).
- **`trend.ts`** — `TrendBuffer`, a fixed-capacity ring buffer of tag history
  for the trend recorder.
- **`result.ts`** — `CommandResult`, the accepted/refused-with-reason shape
  used everywhere a command can be sent to a machine.

### `packages/sim/src/provenance`

The provenance graph: a human-facing, derived view of how material moved,
built by listening to the ledger's own posting stream — not the mechanism
that enforces conservation (that is `Ledger.post`).

- **`lot.ts`** — `Lot`, an identified, point-in-time parcel of material that
  names which parent lots it was made from and how much mass each
  contributed.
- **`graph.ts`** — `LotGraph`, indexing `Lot`s and their parent contributions
  for traversal; it never mutates a lot once added and never invents mass.
- **`closure.ts`** — `checkLotClosure` / `checkGraphClosure`, the audit that
  a lot's declared parentage actually accounts for its own mass, hop by hop,
  independent of the ledger-level conservation check.
- **`export.ts`** — serialises a lot, walk, or whole graph to CSV/JSON for an
  outside audit, carrying every mass as a decimal string so it survives past
  `Number.MAX_SAFE_INTEGER` without loss.
- **`fixture.ts`** — `buildSyntheticChain`, a shared six-hop test chain (with
  splits and merges) used by this directory's own tests.

### `packages/sim/src/substance`

Substance data as validated content, not code.

- **`schema.ts`** — `validateSubstance`, enforcing that a substance's
  elemental split (in integer micrograms per kilogram) sums to exactly
  `UG_PER_KG` before the data can reach the registry.
- **`registry.ts`** — `defaultSubstanceRegistry`, the one place substance
  mass is turned into a `Composition` (via `partition()`, so an elemental
  split always sums back to the exact input mass). This is the one
  sanctioned place `packages/sim` touches Node — a load-time file reader, not
  tick-time simulation.
- Backing data lives in `packages/data/substances/*.json` — 27 substances as
  of this writing (flour, butter, eggs, milk, sucrose, sodium bicarbonate,
  atmospheric gases, soil minerals, packaging materials, and more), each
  validated against the schema above at load.

## Planned modules

The modules below are named in `docs/PLAN.md`'s architecture diagram and
build order but do not exist yet.

| Module | Responsibility |
| --- | --- |
| `agri/` | Crops, livestock, growth models, harvest |
| `bake/` | Batter rheology, leavening chemistry, oven heat transfer, staling |
| `econ/` | Orders, cash, market, suppliers, the call-a-supplier action |

`packages/app` (Electron main/preload/renderer) and `packages/design`
(design tokens and components) are likewise not started. There is no
formulation engine, no cake designer, no packaged build, and no release.

Every module above depends only on `core` and other `sim` modules — never on
`app` or `design` — and every conserved quantity it produces must move
through a `Ledger.post()` call.

## Related documents

- [`../CONTRACT.md`](../CONTRACT.md) — the two governing rules.
- [`PLAN.md`](PLAN.md) — the full implementation plan, build order, and
  verification list.
- [`../CLAUDE.md`](../CLAUDE.md) — conventions for agents working in this
  repository.
