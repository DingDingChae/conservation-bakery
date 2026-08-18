/**
 * The common shape every oven family in `bake/ovens/` implements.
 *
 * "All types of ovens" is only honest if each family computes its heat flux from
 * its own real mechanism rather than reskinning one formula with different
 * numbers — see each family module's own doc comment for its citations. What
 * *is* shared is the bookkeeping every family owes the ledger identically: every
 * joule delivered to a product comes from a real fuel or electrical account
 * (never invented), and every microgram of moisture a product loses is weighed
 * and posted to the atmosphere, never dropped. `support.ts` is where that shared
 * bookkeeping lives; this module only defines the shapes it and every family
 * pass around.
 */

import type { Micrograms } from '../../core/commodity.js';
import type { AccountId, Posting } from '../../core/ledger.js';

/** Every oven family this directory implements, each a distinct real
 * heat-transfer mechanism (see `registry.ts` for what each is good and bad
 * at, as queryable data). */
export type OvenFamilyId =
  | 'deck'
  | 'rack-rotary'
  | 'convection'
  | 'tunnel-direct-fired'
  | 'tunnel-indirect'
  | 'steam-tube'
  | 'spiral'
  | 'hearth'
  | 'wood-fired'
  | 'infrared'
  | 'rf-assist'
  | 'bain-marie'
  | 'pressure-steamer'
  | 'plate-iron'
  | 'baumkuchen-spit';

/** What a family is, physically, and what a designer should and should not
 * reach for it for — data, not a comment, so a scenario or the app can query
 * it (e.g. to warn a designer who tries to run a bain-marie above boiling, or
 * to recommend rack/rotary for a large uneven-shelf batch). */
export interface OvenProfile {
  readonly id: OvenFamilyId;
  readonly label: string;
  /** One-line statement of the real physical mechanism this family moves
   * heat by, distinct from every other family's. */
  readonly mechanism: string;
  readonly goodAt: readonly string[];
  readonly badAt: readonly string[];
}

/**
 * The product-and-accounting state every family step needs, regardless of
 * mechanism. Family-specific geometry/environment/source parameters are
 * layered on top of this per family (see each family's own `*StepParams`).
 */
export interface FamilyStepBase {
  readonly dtSeconds: number;
  /** A single lumped representative product temperature, exactly the model
   * `bake/oven.ts` and `bake/transform.ts` already use — a full spatial
   * temperature field is out of scope for this simulation. */
  readonly surfaceTempC: number;
  readonly massKg: number;
  readonly specificHeatJPerKgK: number;
  readonly moistureRemainingUg: Micrograms;
  readonly productThermalAccount: AccountId;
  /** Where the product's own elemental water mass lives. Defaults to
   * `productThermalAccount` — the ordinary case of one stock account per
   * product carrying both its composition and its thermal energy. */
  readonly productMassAccount?: AccountId;
  readonly atmosphereAccount?: AccountId;
  /** Where heat is credited when the product runs hotter than its heat
   * source and loses heat net this tick. Defaults to `space`, per
   * CONTRACT.md: "every joule that leaves the world arrives here." */
  readonly lossSinkAccount?: AccountId;
  readonly process?: string;
}

/** What every family step reports back, regardless of mechanism. */
export interface FamilyStepResult {
  readonly family: OvenFamilyId;
  /** Named contribution to `totalFluxW` per real heat-transfer path this
   * family actually has (a family with no convective path simply has no
   * `convection` key, rather than reporting a fabricated zero). */
  readonly fluxBreakdownW: Readonly<Record<string, number>>;
  readonly totalFluxW: number;
  readonly postings: readonly Posting[];
  readonly deliveredEnergyJ: number;
  readonly wasteEnergyJ: number;
  /** Exact mass of water that left the product this step, already posted to
   * the atmosphere in `postings` — never dropped, per CONTRACT.md rule 1. */
  readonly evaporatedMassUg: Micrograms;
  readonly nextTempC: number;
}
