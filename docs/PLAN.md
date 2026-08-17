# Conservation Bakery — implementation plan

## Context

A new, hyper-realistic Electron desktop game: a cake factory in which
**nothing ever comes from nothing** — not an ingredient, not a machine, not a
box, not the oxygen the burners and the yeast consume. Every gram must be
traceable to a real source, and the books must close to exactly zero residual
on every simulated tick.

This is a brand-new project. It deliberately does not reference, reuse, or
draw from any other project.

Everything below is a decision made explicitly during planning.

### The product in one paragraph

You operate a real cake plant and the land that feeds it, from a diegetic
industrial control room. Every machine and every farm asset opens its own
full operator faceplate — modes, setpoints, PID loops, interlocks, alarms,
run hours, maintenance, trends. The world is planetary: sunlight, soil
chemistry, rainfall, a finite tracked atmosphere (O₂, CO₂, N₂, H₂O) that
combustion, respiration and leavening genuinely draw from and return to.
Cakes bake by real physical chemistry. Right-click any gram of anything and
walk its ancestry back to sun, soil and air. A **Kid mode** presents the
identical simulation in warm plain language, and a separate difficulty axis
runs from Free Play to Punishing — but conservation is never a difficulty
setting.

### Locked decisions

| Area | Decision |
| --- | --- |
| Name | `conservation-bakery`, product title **Conservation Bakery** |
| Stack | Electron + TypeScript; deterministic simulation core as a pure TS package in a worker |
| Presentation | 2D control room (no 3D) |
| Art direction | **Real plant control room**, diegetic — steel panel frames, engraved label strips, latching annunciator tiles, physical mode selectors, paper-style trend recorder, bakery palette (flour, butter, caramel, crust, oven-glow amber) with hard safety red/green |
| Design system | Authored in a design-system project synced into the repository. **Not** Material Design 3 |
| Provenance boundary | Planetary — sun, soil, atmosphere, water cycle |
| Machine screens | Full real HMI faceplates; farms at full parity with factory machines |
| Baking model | Real physical chemistry (leavening stoichiometry, gelatinisation, coagulation, evaporation, Maillard, staling, water activity) |
| Also tracked | Utilities and consumables, packaging and logistics, people and their needs, waste/effluent/emissions |
| Plant provenance | Machines are purchased with lead time, delivered, commissioned; they wear and need real spare parts |
| Origins | Arable & milling · dairy, eggs & livestock · orchard, tropical & specialty · minerals, chemistry & cultures |
| Equipment | Every oven type · mixing, forming & dosing · cooling, finishing & decoration · packaging & QC |
| Failure realism | Food safety & regulation · biology & contamination · breakdowns & incidents · market, money & people |
<!-- rule2:allow-declaration -->
| **Safety line** | **No injuries. Ever.** See the hard rule below |
<!-- /rule2:allow-declaration -->
| Time | Real-time fixed step with 1× / 5× / 60× / pause; deterministic at every speed |
| World | One owned real-climate region plus a modelled import chain from visible origin regions |
| Cake design | Visual cake designer whose output must be physically and productionally real |
| Kid mode | Friendly skin over the *identical* simulation; flip any time on the same save |
| Difficulty | Free Play / Easy / Realistic / Punishing presets over individually adjustable knobs |
| Easy mode | Forgiving quality, money cushion, fewer breakdowns, more help — **plus a "call a supplier" action** that summons a real, sourced, costed, ledgered delivery |
| Language | Bilingual English + Hong Kong Cantonese, live switchable, either or both |
| Accessibility | Full keyboard and screen-reader operation, text equivalents for every chart, reduced-motion path |
| Palette | `Ctrl+Shift+F` command palette with anchored regex builder |
| Saves | Deterministic replayable saves, all content in open data files, mod/recipe packs, full CSV/JSON export |
| Audio | Diegetic and informative; every audio cue also expressed visually; fully mutable |
| Delivery | Windows first, real packaged app, unsigned installer stated plainly as unsigned |

---

## Two hard rules

### 1. Nothing from nothing

Every conserved quantity closes exactly, every tick:

```
Σ inflows − Σ outflows − Δ stocks  ===  0
```

Conserved: mass **by element** (C, H, O, N, P, K, S, Na, Cl, Ca, Mg, Fe), water,
energy (to a declared tolerance), and cash. A `ConservationGuard` runs every
tick and **halts the simulation** on any violation with a diagnostic naming
the offending process, the element, and the exact discrepancy. This holds at
every difficulty including Free Play.

To make exact equality achievable rather than aspirational:

- Mass is stored as **integer micrograms**, never floats. Amount-of-substance
  as integer nanomoles. Splits use integer partition so the parts sum exactly
  to the whole.
- Energy is float joules with an explicit, tested tolerance band — declared,
  not hidden.
- No process may ever construct material. A process *transforms* declared
  inputs into declared outputs, and the transformation is checked against
  elemental composition before it is allowed to run.

<!-- rule2:allow-declaration -->
### 2. No injuries
<!-- /rule2:allow-declaration -->

<!-- rule2:allow-declaration -->
No injury, accident, illness, harm, or emergency involving any person is
<!-- /rule2:allow-declaration -->
modelled, counted, logged, depicted, voiced, or written anywhere in this
product, in any language, at any difficulty. Hazards exist only as
**equipment and product** events: a motor trips, an element burns out, a
batch is condemned, a lot is recalled, a line stops. Interlocks and lockout
are modelled as protecting equipment and product integrity.

<!-- rule2:allow-declaration -->
This is enforced by a build-failing content test (`tests/content/no-harm.spec.ts`)
<!-- /rule2:allow-declaration -->
that sweeps every string, event id, alarm text, asset name and data file in
both languages against a denylist. It is a gate, not an intention.

---

## Architecture

```
conservation-bakery/
  packages/
    sim/          pure TypeScript deterministic engine — no Electron, no DOM
      elements/     elemental composition, integer mass arithmetic
      ledger/       conservation guard, provenance DAG, audit export
      clock/        fixed-step scheduler, seeded RNG, input log, replay
      world/        atmosphere · soil · water · climate · sun
      agri/         crops, livestock, growth models, harvest
      process/      machine model, control layer (PID, interlocks, alarms, modes)
      bake/         batter rheology, leavening chemistry, oven heat transfer, staling
      econ/         orders, cash, market, suppliers, "call a supplier"
    data/         ALL content as validated open data — the world is data, not code
      substances/ reactions/ machines/ crops/ animals/ regions/ formulations/ packs/
    design/       design tokens + components synced from the design system
    app/          Electron main · preload · renderer (control room, kid mode)
  tests/
  tools/
```

**Non-negotiable seam:** `packages/sim` never imports from `app` or `design`,
has no DOM or Node-only dependency, and runs headless. The renderer
*observes* simulation state; it never owns canonical state. This is what
makes headless replay, property tests and audit export possible.

**Content is data.** Ingredients, reactions, machines, cakes, crops and
regions live in JSON validated against JSON Schema at load. A mod pack that
would create mass from nothing is rejected at load with a clear reason
naming the element that fails to balance.

---

## Build order

The first playable build is **one closed chain, end to end** — proven, then
widened.

### Phase 0 — Repository and contract
Scaffold the repository, TypeScript project references, test runner, lint,
`CLAUDE.md`, `README.md`, the two hard rules written down as the project's
contract. Initialise version control, first commit. Create the public
repository and push.

### Phase 1 — Design language
Create a new design-system project named **Conservation Bakery**. Author the
real-control-room language there — panel surfaces, engraved labels,
annunciator tiles, mode selectors, faceplate anatomy, trend recorder, alarm
states, the bakery palette, type scale — **and the Kid mode variant of each**,
as a parallel token set and component skin over identical structure. Sync
down into `packages/design`. Every component ships light and dark and a
reduced-motion path.

### Phase 2 — Simulation core and the guard
Elemental substance model, integer mass arithmetic, provenance DAG,
`ConservationGuard`, fixed-step deterministic clock, seeded RNG, input log,
replay-to-digest. **This phase is done when a property test can run a random
world for 100,000 ticks and residual is exactly zero for every element on
every tick.** Nothing else starts before this passes.

### Phase 3 — The planetary layer
Atmosphere as a finite tracked reservoir; soil N-P-K and moisture; the water
cycle; sun and a real-climate seasonal model for the chosen region.
Respiration, combustion and photosynthesis wired as genuine exchanges with
that reservoir.

### Phase 4 — The first closed chain
Field → winter wheat → mill → flour. Cow → milk → creamery → butter. Hen →
egg. Sugar beet → refinery → sugar. Then mixer → deck oven → spiral cooler →
flow wrapper → pallet → order. Full HMI faceplate on every asset in that
chain, farm assets at parity. Real bake chemistry on the deck oven. The chain
must close from sunlight to shipped cake.

### Phase 5 — The shell
Control-room shell, machine and farm faceplates, the clickable provenance
tree, the zero-residual balance panel, `Ctrl+Shift+F` palette with regex
builder, bilingual English/Cantonese, full keyboard and screen-reader
operation, **Kid mode as a live skin toggle on the same save**, difficulty
presets and knob panel, save/load/replay/rewind.

*→ This is v0.1: a genuinely playable, genuinely closed factory.*

### Phase 6 — Cake formulation and the designer
The formulation engine (ratios, hydration, leavening stoichiometry, structure
index, predicted collapse) plus the seeded catalog of real named cakes across
world traditions. The visual cake designer — tiers, layers, fillings, crumb
coat, icing, ganache, fondant, piping, transfers, toppers — with structural
and production feasibility checked against physics and line capacity, and
every gram of decoration drawn from real inventory.

### Phase 7 — Business, difficulty and consequence
Orders, cash, wages, energy tariffs, market movement, suppliers and lead
times, the **call-a-supplier** action, spare parts and stores, maintenance,
HACCP and traceability, lot recall forward and back, the regulator, spoilage
and contamination by water activity and temperature, breakdowns. All within
<!-- rule2:allow-declaration -->
the no-injuries rule.
<!-- /rule2:allow-declaration -->

### Phase 8 — Widen to "every possibility"
All oven families as distinct heat-transfer models (deck, rack, convection,
direct and indirect tunnel, steam-tube, spiral, hearth, wood-fired, infrared,
RF assist, bain-marie, pressure steamer, plate irons, baumkuchen spit). All
mixing/forming/dosing, cooling/finishing/decoration, packaging/QC families.
All four origin groups including cocoa fermentation→roast→liquor→butter,
vanilla curing, honey, salt, cultures. Import chain and visible origin
regions.

### Phase 9 — Audio
Diegetic informative sound: mixer motor pitch under load, burner ignition,
extractor, conveyor rhythm, wrapper cycle, latching annunciator. Every cue
mirrored visually.

### Phase 10 — Package and release
Windows packaged build, unsigned installer, plainly stated as unsigned.
Portable run. Linux and macOS kept buildable but not targeted.

---

## Verification

Nothing is called done on assertion. Each of these runs in CI and locally.

1. **Conservation property test** — random worlds, 100k ticks, every element,
   exact zero residual. The single most important test in the project.
2. **Golden replay digest** — a recorded input log replays tick-for-tick to a
   byte-identical state digest. Catches any non-determinism immediately.
3. **Provenance closure test** — for a shipped cake, the sum of every leaf in
   its ancestry tree equals its mass plus every declared loss, exactly.
<!-- rule2:allow-declaration -->
4. **No-harm content test** — build-failing sweep of all strings, ids and
<!-- /rule2:allow-declaration -->
   data in both languages.
5. **Bake physics regression** — known real formulations (genoise, chiffon,
   pound, sponge) bake to expected crumb, rise and moisture-loss ranges;
   deliberately bad process produces the correct failure.
6. **Mod-pack rejection test** — a pack that creates mass from nothing is
   rejected on load with the offending element named.
7. **Accessibility pass** — full keyboard traversal of every faceplate,
   screen-reader announcement of every alarm and value, chart text
   equivalents, reduced-motion path.
8. **Real-app proof** — launch the packaged build, drive a real batch through
   the real chain, and capture real screenshots of: fresh world, an oven
   faceplate mid-bake, the provenance tree of a finished cake, the balance
   panel reading zero residual, Kid mode on the same save, and the cake
   designer. No mock-ups presented as captures.
9. **Bilingual render check** — every surface in English-only,
   Cantonese-only, and both.
