# Conservation Bakery

A hyper-realistic cake factory simulation in which **nothing ever comes from
nothing**. Every gram of every substance, the oxygen a burner consumes, the
carbon dioxide a leavening agent releases, the cardboard a box is made from —
all of it has a real source somewhere else in the world, and the books close
to exactly zero on every commodity, always.

This is a desktop simulation project (Electron + TypeScript). You operate a
real cake plant and the land that feeds it, from a diegetic industrial control
room: full operator faceplates on every machine, a planetary provenance
boundary (sun, soil, atmosphere, water cycle), and real physical chemistry in
the bake.

## The contract

Two rules govern this project. They are enforced by tests that fail the
build, not by convention. The full text is in [`CONTRACT.md`](CONTRACT.md);
the short version:

**Rule 1 — Nothing ever comes from nothing.** The simulation is a
double-entry ledger over conserved commodities (elemental mass, energy,
money). The only way to move material is a `Posting`: a set of entries whose
deltas sum to exactly zero for every commodity it touches. A posting that
does not balance is rejected before anything changes. Stated as an invariant,
for every commodity `c` and at every point in a world's lifetime:

```
Σ (every account, every commodity c) === 0
```

<!-- rule2:allow-declaration -->
Conservation is therefore structural, not audited after the fact — there is
no operation in `packages/sim` that could create matter, even by accident.
<!-- /rule2:allow-declaration -->

<!-- rule2:allow-declaration -->
**Rule 2 — No injuries, ever.** No injury, accident, illness, harm, casualty,
or medical emergency involving a person is modelled, named, logged, or
written anywhere in this project, in any language, at any difficulty.
<!-- /rule2:allow-declaration -->
Hazards are equipment and product events only: a motor trips, an element
burns out, a batch is condemned, a lot is recalled, a line stops. Interlocks
protect equipment and product integrity; food safety failures are
specification and regulatory non-conformance.

## How it works

At the core of `packages/sim` is a **ledger** (`packages/sim/src/core/ledger.ts`)
and a **commodity model** (`packages/sim/src/core/commodity.ts`).

- Every conserved quantity — mass by chemical element, energy, money — is
  identified by a `CommodityId` and stored as an exact `bigint`: micrograms
  for mass, microjoules for energy, minor currency units for cash.
- Accounts hold balances of commodities. A `stock` or `reservoir` account can
  never go negative — the material is simply not there if it tries to.
  `external` accounts (suppliers, customers, the grid, `genesis`) may go
  negative, and that negative balance is the exact record of what the outside
  world has supplied.
- The only mutation is `Ledger.post(posting)`. A `Posting` is a list of
  entries; if the entries for any commodity do not sum to exactly `0n`, the
  posting is rejected with an `UnbalancedPostingError` and nothing is
  changed.
- `Ledger.audit()` re-derives the sum of every account for every commodity
  from scratch — not from a running total — so it catches any mutation that
  bypassed a posting.

Quantities are `bigint` rather than `number` because floating point cannot
represent "exactly zero residual, forever, across millions of postings"
without drift. Floating point is still used to *compute* a physical result
(a reaction yield, a heat-transfer rate); that result is rounded exactly
once, at the boundary, via `roundHalfEven`/`scale`, and the counter-entry is
derived by negation so the rounding is shared between the two accounts
rather than leaked. Splitting an exact quantity across several destinations
uses `partition()`, which distributes remainders deterministically so the
parts always sum back to the whole.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a map of the
simulation package, and [`docs/PLAN.md`](docs/PLAN.md) for the full
implementation plan.

## Project status

**Version 0.1.0 is released.** The Electron shell, renderer, cake
formulation engine, and a packaged Windows build all exist and have been
verified: the packaged application launches, reaches the control room, and
is genuinely interactive — the navigation rail opens a real machine
faceplate, Kid mode and Cantonese switch live on the same running world, and
the balance panel keeps reading zero residual while the simulation ticks.
See [`docs/RELEASE.md`](docs/RELEASE.md) for exactly what was checked and
how, and [`captures/README.md`](captures/README.md) for real screenshots of
the packaged build, including what they do *not* show.

`packages/sim` is the deterministic, headless simulation core; the rest of
the plan builds outward from it. What exists and passes its own tests today,
module by module:

- The conserved-commodity ledger core (`core`) — the double-entry `Ledger`
  and the `bigint` commodity/unit-conversion model described above.
- The determinism layer (`clock`) — seeded PRNG, fixed-step clock, input
  journal, and stable state digest, so a recorded run replays byte-identical.
- The substance data and registry (`substance`) — a validated schema plus a
  registry loading real substance data from `packages/data/substances`.
- The provenance graph (`provenance`) — a lot graph built from the ledger's
  own posting stream, with a closure audit and CSV/JSON export.
- The planetary exchange layer (`world`) — finite atmosphere, water and soil
  accounts plus the balanced combustion, respiration, photosynthesis,
  evaporation and condensation processes that draw on them.
- The machine and control framework (`process`) — a data-driven `Machine`
  model, PID controller, interlocks, alarms, equipment wear, and a trend
  buffer.
- The cake formulation engine and oven registry (`bake`) — 39 named cakes
  and 15 oven families, all reachable from the plant.
- The Electron shell (`packages/app`) — main process, simulation worker
  host, and a plain-DOM renderer with a full i18n catalogue (English and
  Cantonese, each in a panel and a Kid register).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for what each module
actually contains.

## Installing a release

Windows x64 only, for now — see [`docs/RELEASE.md`](docs/RELEASE.md) for why
Linux and macOS are not yet built or supported.

Download either artefact from a release and run it:

- `Conservation Bakery-<version>-x64-unsigned.exe` — an NSIS installer. Not
  one-click: it asks where to install and can be pointed anywhere. Installs
  per-user, no administrator rights required.
- `Conservation Bakery-<version>-x64-portable-unsigned.exe` — the same
  application as a single portable executable that installs nothing.

**Both installers are unsigned, deliberately and permanently.** Windows will
show a SmartScreen "unknown publisher" warning when either one runs. That is
the correct, expected behaviour for an unsigned executable — see
[`docs/RELEASE.md`](docs/RELEASE.md) for why this is never worked around.

## Building and testing

Requires Node.js 22 or later.

```sh
npm ci
npm run build      # tsc --build, project references
npm test           # vitest run
```

Other scripts, see `package.json`:

```sh
npm run typecheck        # tsc --build with no emit change
npm run test:watch       # vitest in watch mode
npm run test:conservation # just the conservation-core suite
```

To build the packaged Windows release yourself, see
[`docs/RELEASE.md`](docs/RELEASE.md).

## Licence

Apache License 2.0 — see [`LICENSE`](LICENSE).
