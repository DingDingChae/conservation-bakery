# `@conservation-bakery/design`

The design language for Conservation Bakery: tokens and hand-written
components for a **diegetic real plant control room**. This is explicitly
**not** Material Design 3 — no M3 tokens, no M3 component names, no M3 type
scale. The player is standing at an actual control desk: brushed steel
panel frames with visible fasteners, engraved phenolic label strips,
latching annunciator tiles, chunky physical mode selectors, a paper-style
scrolling trend recorder — warm bakery light (flour white, butter, caramel,
crust brown, oven-glow amber) against charcoal steel, with hard safety red
and green reserved exclusively for state.

## The seam

Per `docs/ARCHITECTURE.md`, this package never imports from `packages/sim`
and has no runtime dependency on it. It is pure presentation: CSS custom
properties and static HTML/CSS component previews, no framework, no build
step to view them — open any file in `components/*.html` directly in a
browser. The one piece of real TypeScript in this package
(`src/contrast.ts`, `src/tokenFile.ts`) exists solely to compute and gate
colour contrast; it has no opinion about simulation state.

## Token structure

```
tokens/
  color-light.css   colour, light scheme
  color-dark.css     colour, dark scheme (+ prefers-color-scheme fallback)
  kid.css            Kid mode overlay (see below) — colour, type, space,
                     radius, elevation
  typography.css     font families, sizes, weights, tracking
  spacing.css        4px-grid spacing scale + minimum hit-target size
  radius.css         corner radius scale
  elevation.css      physical-depth box-shadow recipes
  borders.css        border width scale (colour comes from the tokens above)
  motion.css         durations, easing, and the annunciator flash rate
  index.css          imports the base set (everything except kid.css) in
                     the right cascade order
```

Every token is a CSS custom property named `--cb-<category>-<name>`. A
component reads only token names, never a literal colour, size, or
duration — that discipline is what makes Kid mode a pure overlay (see
below) instead of a fork.

Colour resolves via two attributes on an ancestor element (typically
`<html>`):

- `data-theme="light"` / `data-theme="dark"` selects the scheme explicitly.
  With neither set, `color-dark.css`'s `@media (prefers-color-scheme: dark)`
  block matches the platform's preference.
- `data-mode="kid"` layers Kid mode's token overlay on top, regardless of
  which colour scheme is active — see below for why Kid mode intentionally
  overrides colour to one fixed palette.

## How Kid mode overlays the base tokens

Kid mode is **a token swap and a copy register, never a different component
tree.** `tokens/kid.css` redefines exactly the same custom property names
the base scheme files define — colour, and additionally type scale,
spacing, hit-target size, radius, and elevation — scoped under
`[data-mode="kid"]`. No component's markup, class name, or per-component
CSS rule changes between modes. A page opts in by adding `data-mode="kid"`
next to `data-theme` on the same root element; nothing else changes.

Kid mode's colour palette is a single warm, bright scheme rather than a
Kid-light/Kid-dark pair: the brief calls for "warmer and brighter
surfaces," and a dim Kid mode would contradict that, so `[data-mode="kid"]`
deliberately wins over `[data-theme="dark"]` in the cascade. Kid mode keeps
full keyboard and screen-reader support — those are not scheme-dependent.

The "copy register" half of Kid mode (friendlier microcopy for the same
underlying state) is a presentation-layer concern for whatever consumes
these tokens (`packages/app`), not something this package encodes — this
package only guarantees that every component's *structure* and every
token's *name* stay identical, so a copy layer never has to branch on mode
either.

## Components

`components/*.html` are standalone, hand-written previews — open any one
directly from disk, no dev server, no bundler. Each links `../tokens/index.css`,
`../tokens/kid.css`, the shared preview harness (`shared/preview.css`,
`shared/preview.js` — scaffolding for the page you're looking at, not part
of the design language itself), and its own component stylesheet.

| File | Group | What it shows |
| --- | --- | --- |
| `panel-frame.html` | Panels | The brushed steel enclosure with corner fasteners |
| `label-strip.html` | Panels | The engraved phenolic nameplate, including labelling a real control |
| `annunciator-tile.html` | Alarms | All four alarm states, plus a live acknowledge/reset demo |
| `mode-selector.html` | Controls | A chunky physical mode switch (native radio group) |
| `numeric-entry.html` | Controls | A value with units, a visible range, and live validation |
| `setpoint-readout.html` | Readouts | Setpoint vs. process value, with a text status, not colour alone |
| `trend-recorder.html` | Readouts | The paper-style strip chart, with its required text-equivalent table |
| `faceplate.html` | Faceplate | A full machine screen, composed from the components above |
| `toast.html` | System | A persistent, non-blocking status line |
| `command-palette.html` | System | Ctrl+Shift+F, with the anchored regex builder |

Every preview's first line is a machine-readable marker,
`<!-- @dsCard group="..." -->`, naming the group it belongs in.

Every state-carrying preview toolbar lets you flip colour scheme and Kid
mode live, so you can see the same markup read different token values.

## The accessibility contract

- **Keyboard.** Every interactive element in every component is a real
  native control (`<button>`, `<input type="radio">`, `<input type="number">`,
  `<dialog>`) or is built directly on ARIA authoring-practice patterns
  (the command palette's listbox). Nothing requires a mouse.
- **Focus.** `:focus-visible` gets a real outline using
  `--cb-color-focus-ring`, verified at ≥3:1 against both the page background
  and the panel surface, in all three schemes (light, dark, Kid).
- **Announcement.** Alarm state changes are announced through a
  `role="status" aria-live="polite"` region (see `annunciator-tile.html`'s
  interactive demo); the command palette and toast use the same pattern.
  Every icon that is purely decorative is `aria-hidden`; every value an
  icon or a shape stands in for also exists as real text.
- **Colour independence.** The annunciator's four states are distinguished
  by icon shape and text label as well as colour. The setpoint/process-value
  readout's deviation bar is decorative (`aria-hidden`); the actual "within
  tolerance" / "deviation high" / "deviation low" status is always text.
- **Reduced motion.** The annunciator flash and the trend recorder's
  paper-feed animation are each defined *only* inside
  `@media (prefers-reduced-motion: no-preference)`. With reduced motion
  requested, neither constructs an animation at all — the annunciator's
  active-unacknowledged state instead renders as a steady red fill with a
  bold dashed border, still distinguishable from every other state without
  colour or motion.
- **Text equivalents.** `trend-recorder.html`'s chart is `aria-hidden`
  under an `<svg role="img">` with a real `<title>`/`<desc>`, and every
  value it plots also exists in a `<table>` inside a `<details>` disclosure
  directly below it.

## Colour contrast: how it is enforced

`src/contrast.spec.ts` is a build-failing Vitest gate. It parses the actual
`tokens/color-light.css`, `tokens/color-dark.css`, and `tokens/kid.css`
files (via `src/tokenFile.ts`), reads every colour pair this component
library renders together (ink-on-surface, a fill against its surroundings,
a border, a focus ring), and computes the WCAG 2.x contrast ratio from the
literal hex values in those files using `src/contrast.ts` — a from-spec
implementation of the relative-luminance formula, with no dependency added
to compute it. The test fails if any pair is below **4.5:1** for body text
or **3:1** for large text and non-text indicators (borders, focus rings,
state fills). Run it with:

```sh
npx vitest run packages/design/src/contrast.spec.ts
```

Every `tokens/*.css` colour declaration also carries a comment stating the
ratio the test computed for it, at the time it was written, so a reviewer
does not have to run the test to see the margin — but the test is the
actual gate; the comments are documentation, not the enforcement mechanism.
The one intentional colour beyond the base scheme, `--cb-color-text-danger`,
exists because `--cb-color-safety-red` is tuned to be a legible **fill**
(a tile background, a state indicator against a panel) and falls short of
the body-text threshold when used as ink directly on a surface — a second,
darker/lighter (per scheme) ink token carries error and alarm *text*
instead, and is included in the same gate.
