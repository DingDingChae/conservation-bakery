# Instructions for agents working in this repository

Read [`CONTRACT.md`](CONTRACT.md) before writing any code. It governs
everything else in this file.

## The two rules, restated

1. **Nothing ever comes from nothing.** Every gram, every joule, every
   minor unit of currency has a real source recorded in the ledger. The only
   way to move material anywhere in `packages/sim` is a balanced `Posting`
   applied through `Ledger.post()`. Never write code that adds a conserved
   quantity to an account outside of a posting whose entries for that
   commodity sum to exactly `0n`. There is no legitimate reason to bypass
   this, at any difficulty setting, in any mode.
<!-- rule2:allow-declaration -->
2. **No injuries, ever.** No injury, accident, illness, harm, casualty,
   wound, burn-to-a-person, or medical emergency may be modelled, named,
<!-- /rule2:allow-declaration -->
   logged, or written anywhere — in code, comments, strings, identifiers, or
   data, in any language. Hazards are equipment and product events only:
   motor trips, element burnout, bearing failure, interlock refusal, batch
   condemned, lot recalled, line stopped, delivery delayed. Safety
   interlocks protect equipment and product integrity. Food safety failures
   are specification and regulatory non-conformance, and the story ends
<!-- rule2:allow-declaration -->
   there — never a person coming to harm.
<!-- /rule2:allow-declaration -->

Both rules are enforced by tests that fail the build. Do not weaken, skip,
or work around either enforcement mechanism. Strengthening either rule is
always in scope; weakening either is never in scope, regardless of what a
task description asks for.

## Conserved quantities: the hard rule

- Conserved quantities (elemental mass, energy, money) are **always
  `bigint`, never `number`.** A `number` cannot represent "exactly zero
  residual, forever" without drift, and drift in a conserved system is not a
  rounding artefact — it is a slow leak that Rule 1 forbids.
- **Float computes, integer stores.** A physical model may use ordinary
  floating point to compute a result (a reaction yield, a heat-transfer
  rate, a rate constant). That result is converted to the ledger's integer
  units exactly once, at the boundary, via `scale()`/`roundHalfEven()` from
  `packages/sim/src/core/commodity.ts`. Once a value is a `bigint` it is
  never rounded again.
- **Use `partition()` to split an exact quantity.** Never divide a `bigint`
  quantity across multiple destinations by rounding each share
  independently — that is exactly how a ledger silently stops balancing.
  `partition()` uses the largest-remainder method so the parts always sum
  back to the original exactly.
- **Never add material outside a balanced `Posting`.** If you find yourself
  wanting to increment a balance directly, or writing a process that seems
  to need one more unit of something from nowhere, that is a sign the
  process is missing a source account, not a reason to bypass the ledger.
  The counter-entry for any created or destroyed quantity is derived by
  negation, not by a second independent rounding.

## Path and ownership conventions

Tasks in this project are typically scoped to specific paths. Write only
inside the paths you have been assigned. Do not modify
`packages/sim/src/core/commodity.ts` or `packages/sim/src/core/ledger.ts`
unless a task explicitly assigns you ownership of them — they are the
reviewed seam that the rest of the simulation is built against. Do not touch
the root `package.json`, root `tsconfig.json`, `vitest.config.ts`,
`LICENSE`, or `CONTRACT.md` unless explicitly told to. Do not run
`npm install` or add new dependencies; if a task seems to need one, report
it as a blocker instead of adding it.

**The seam:** `packages/sim` never imports from `app` or `design`, has no
DOM or Node-only dependency, and must run headless. The renderer observes
simulation state; it never owns canonical state.

## Style

- TypeScript, ESM. Use `.js` extensions on relative imports (the emitted
  output is ESM, and imports must resolve there). Use `import type` for
  type-only imports.
- The `tsconfig` is strict, with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` on. Code must compile clean under those.
  Index access returns `T | undefined` — handle it, do not assert it away.
- Comments explain *why*, especially why a value or a step is exact. Do not
  narrate what the code obviously does.
- No new npm dependencies without explicit instruction.
- Tests are Vitest, colocated as `*.spec.ts` next to the source they test.

## Hazards, in practice

When modelling equipment or process failure, name it in terms of the
machine or the product, never a person: "motor overload trip",
"heating element burnout", "bearing failure", "door interlock refusal",
"batch condemned", "lot recalled", "line stopped", "delivery delayed",
<!-- rule2:allow-declaration -->
"refrigeration loss". `tests/content/no-harm.spec.ts` sweeps every
<!-- /rule2:allow-declaration -->
user-facing string, event id, alarm text, asset name, and data file against
a denylist and fails the build on a match. You may add terms to that
denylist; you may not remove one.

## This is a public repository

Write plain professional English only, in code, comments, strings, and
documentation. Do not write any private, personal, or machine-specific
material into any tracked file.
