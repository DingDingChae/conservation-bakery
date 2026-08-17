# The contract

Two rules govern this project. They are not preferences, they are not tunable, and they
are not difficulty settings. Every other decision in this codebase is subordinate to
them. Each is enforced by a test that fails the build.

---

## Rule 1 — Nothing ever comes from nothing

Not an ingredient. Not a machine. Not a cardboard box. Not the oxygen a burner consumes
or the carbon dioxide a leavening agent releases. Every gram in this world has a source,
and that source is somewhere else in this world.

### How it is enforced

The simulation is a **double-entry ledger over conserved commodities**. There is no API
anywhere in `packages/sim` that can add material to an account. The only mutation is a
`Posting`: a set of entries whose deltas sum to exactly zero for every commodity it
touches. A posting that does not balance is rejected before it is applied.

Conservation is therefore *structural*, not audited-after-the-fact. It is not possible
to write a process that creates matter, because the type system and the ledger offer no
operation that could.

The commodities conserved:

| Commodity | Unit | Representation |
| --- | --- | --- |
| Chemical elements — C, H, O, N, P, K, S, Na, Cl, Ca, Mg, Fe | microgram | `bigint` |
| Energy | microjoule | `bigint` |
| Money | minor currency unit | `bigint` |

All three are **exact integers**. Floating point is used to *compute* physics, never to
*store* a conserved quantity. A physical model produces a real number; that number is
rounded once to an integer, and the equal and opposite entry is derived by negation — so
the rounding is shared honestly between the two accounts rather than leaking.

### The world has no outside

Everything that would otherwise be "outside" is modelled as an account, so that even
imports and exports balance:

- `atmosphere` — a finite reservoir of O₂, CO₂, N₂ and H₂O. Burners draw from it,
  respiration draws from it, photosynthesis returns to it, an oven flue returns to it.
- `soil.*`, `groundwater.*`, `surface-water.*` — finite, depletable, replenished only by
  a modelled water cycle.
- `sun` — a finite energy stock. Photosynthesis and solar gain debit it.
- `space` — the radiative sink. Every joule that leaves the world arrives here.
- `market.suppliers`, `market.customers`, `market.utilities` — the counterparties for
  every delivery, sale and bill. A delivered sack of flour is a transfer, never a spawn.

The audit consequence: `Σ (every account, every commodity) === constant`, for the entire
lifetime of a world. A test asserts exactly this.

### Difficulty may not bend it

Free Play, Easy, Realistic and Punishing change yields, prices, tolerances, breakdown
rates and how much help you get. Easy mode is generous: bigger harvests, higher
extraction, faster lines, less scrap, and a **call-a-supplier** action that brings a
real, sourced, costed, ledgered delivery to the gate.

None of them may create a gram. There is no code path for it to happen.

---

<!-- rule2:allow-declaration -->
## Rule 2 — No injuries
<!-- /rule2:allow-declaration -->

<!-- rule2:allow-declaration -->
No injury, accident, illness, harm, casualty or medical emergency involving any person
is modelled, counted, simulated, logged, named, depicted, voiced, or written anywhere in
this product — in any language, in any mode, at any difficulty, in any data file, in any
string, in any asset, in any comment.
<!-- /rule2:allow-declaration -->

Hazards in this world are **equipment and product** events only:

| Modelled | Never present |
| --- | --- |
<!-- rule2:allow-declaration -->
| Motor overload trip | Any person coming to any harm |
| Heating element burnout | Injury, accident, wound, burn |
| Bearing or belt failure | Illness, sickness, poisoning |
| Door interlock refusing a command | Casualty, fatality |
| Batch condemned, lot recalled | Medical or emergency response |
<!-- /rule2:allow-declaration -->
| Line stopped, delivery delayed | |
| Refrigeration loss, power cut | |

Safety interlocks and lockout are modelled as mechanisms that protect **equipment and
product integrity**. Food safety, HACCP, traceability and recall are modelled as
**specification and regulatory conformance** — a lot fails its specification and is
withdrawn; the story ends there.

### How it is enforced

<!-- rule2:allow-declaration -->
`tests/content/no-harm.spec.ts` sweeps every user-facing string in both languages, every
<!-- /rule2:allow-declaration -->
event and alarm identifier, every data file, and every asset name against a denylist,
and fails the build on a match. Adding a term to the denylist is allowed. Removing one
is not.

---

## Amending this document

Rule 1 and Rule 2 are not amendable. Anything else here — the commodity table, the
account list, the enforcement mechanism — may be strengthened, never weakened.
