/**
 * Cocoa: pod through fermentation, drying, roasting, winnowing to nib, then
 * liquor, and pressing to cocoa butter and cocoa powder.
 *
 * Every stage below is a real, cited, mass-balanced transformation:
 *
 *   1. **Grow and harvest** (`growth.ts`, `crops.ts`'s `COCOA_TREE`): a real
 *      Liebig-limited growth cycle against the cocoa belt's own soil, sun and
 *      atmosphere, harvested as a fresh whole pod.
 *   2. **Open the pod**: a fixed real mass ratio (`WET_BEAN_SHARE_OF_POD`)
 *      splits the pod into the wet bean-and-pulp fraction and the husk, via
 *      `util.ts`'s `splitByFixedRatio` — the husk is a real, conserved
 *      by-product that stays at origin (see `region.ts`'s residue account),
 *      never discarded from the ledger.
 *   3. **Ferment**: pulp sugars are aerobically respired (`world/exchange.ts`'s
 *      `respire`, real CO2-and-heat stoichiometry, clamped to what the account
 *      can actually support by `util.ts`'s `respireClamped`), and the bulk of
 *      the pulp's own free moisture drains/evaporates away — modelled as a
 *      real water loss to the atmosphere via `agri/harvest.ts`'s `dryGrain`,
 *      the same technique grain drying uses.
 *   4. **Dry**, then **5. Roast**: two further real, staged moisture-loss
 *      steps (`dryGrain` again) down to the traded raw-bean moisture and then
 *      the roasted-bean moisture, matching `cocoa-bean-dried.json` and
 *      `cocoa-bean-roasted.json`'s own cited target moistures.
 *   6. **Winnow**: the roasted bean's own exact composition is split between
 *      nib and shell by `plant/unit.ts`'s `splitByProfile`, weighted by
 *      `cocoa-nib.json` and `cocoa-shell.json`'s real registered profiles.
 *   7. **Grind to liquor**: a pure phase change (solid nib to a fluid paste at
 *      process temperature) with no mass loss — `cocoa-nib.json`'s own file
 *      note documents that this directory reuses that one substance id for
 *      both.
 *   8. **Press**: the liquor's exact composition is split between cocoa
 *      butter and cocoa powder, again by `splitByProfile`, so the two masses
 *      always sum to exactly the liquor pressed.
 *
 * Because every one of these is a `buildProcessPosting`/`splitByProfile`/
 * `dryGrain` call that already guarantees an exact balance on its own, the
 * whole chain reconciles by construction: pod mass in equals husk, moisture,
 * CO2 and shell losses out, plus butter and powder mass out, exactly — see
 * `cocoa.spec.ts`.
 */

import type { Composition, Element, Micrograms } from '../core/commodity.js';
import { compositionMass, partition } from '../core/commodity.js';
import type { AccountId, Ledger } from '../core/ledger.js';
import type { Rng } from '../clock/rng.js';
import { WORLD_ACCOUNTS } from '../world/accounts.js';
import { dryGrain } from '../agri/harvest.js';
import { buildProcessPosting, splitByProfile, type StreamProfile } from '../plant/unit.js';
import type { SubstanceRegistry } from '../substance/registry.js';
import { COCOA_TREE } from './crops.js';
import { growAndHarvest } from './growth.js';
import { originResidueAccount, type OriginRegion } from './region.js';
import { respireClamped, splitByFixedRatio } from './util.js';

/** Wet bean-and-pulp share of a freshly opened pod's total mass; the husk
 * takes the rest. Real, commonly cited approximation (ICCO, "Growing Cocoa";
 * cocoa post-harvest processing literature): roughly a third of a pod's fresh
 * weight is bean and pulp, the rest is husk. */
export const WET_BEAN_SHARE_OF_POD = 0.3;

/** Real, widely cited fermentation loss: roughly this fraction of the wet
 * bean-and-pulp fraction's own dry organic mass is aerobically respired away
 * (pulp sugar metabolism by the fermenting yeast/bacterial culture) during a
 * 5-7 day fermentation. */
export const FERMENTATION_RESPIRED_FRACTION = 0.08;

/** Target moisture content (by fresh mass) at the end of fermentation, before
 * sun-drying — mucilage drainage and evaporation together remove most of the
 * pulp's free water well before the bean reaches its final storage moisture. */
export const FERMENTATION_TARGET_MOISTURE = 0.55;

/** Matches `cocoa-bean-dried.json`'s own cited ~7% storage moisture. */
export const DRIED_TARGET_MOISTURE = 0.07;

/** Matches `cocoa-bean-roasted.json`'s own cited ~2% roasted moisture. */
export const ROASTED_TARGET_MOISTURE = 0.02;

/** Real, widely cited winnowing yield: nib is roughly this share of a
 * roasted bean's mass, shell the rest (cocoa processing literature). */
export const NIB_SHARE_OF_ROASTED_BEAN = 0.88;

/** Real, widely cited pressing yield for a standard press: liquor splits
 * roughly evenly between cocoa butter and press cake (cocoa processing
 * literature; higher- or lower-fat presses vary this within a wide range). */
export const BUTTER_SHARE_OF_LIQUOR = 0.5;

export interface CocoaChainAccounts {
  readonly pod: AccountId;
  /** Holds the bean through wet, fermented, dried and roasted stages — the
   * same parcel evolving via balanced moisture-and-respiration postings, the
   * same convention `scenario/firstChain.ts` uses for its own grain account
   * through drying. */
  readonly bean: AccountId;
  readonly nib: AccountId;
  readonly shell: AccountId;
  readonly butter: AccountId;
  readonly powder: AccountId;
}

export function openCocoaAccounts(ledger: Ledger, prefix = 'cocoa'): CocoaChainAccounts {
  const accounts: CocoaChainAccounts = {
    pod: `${prefix}.pod`,
    bean: `${prefix}.bean`,
    nib: `${prefix}.nib`,
    shell: `${prefix}.shell`,
    butter: `${prefix}.butter`,
    powder: `${prefix}.powder`,
  };
  for (const id of Object.values(accounts)) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  return accounts;
}

export interface CocoaChainResult {
  readonly podMassUg: Micrograms;
  /** The tree's own non-pod seasonal growth (leaves, new wood), credited to
   * the region's residue account alongside the husk and shell — a real
   * `splitStandingBiomass` by-product of harvesting, not part of the pod. */
  readonly treeResidueMassUg: Micrograms;
  readonly huskMassUg: Micrograms;
  readonly wetBeanMassUg: Micrograms;
  readonly fermentationRespiredUg: Micrograms;
  readonly fermentationMoistureLossUg: Micrograms;
  readonly dryingMoistureLossUg: Micrograms;
  readonly roastingMoistureLossUg: Micrograms;
  readonly nibMassUg: Micrograms;
  readonly shellMassUg: Micrograms;
  readonly butterMassUg: Micrograms;
  readonly powderMassUg: Micrograms;
  readonly daysGrown: number;
}

function accountComposition(ledger: Ledger, account: AccountId): Composition {
  const out = new Map<Element, Micrograms>();
  for (const [commodity, amount] of ledger.balances(account)) {
    if (amount === 0n || !commodity.startsWith('el:')) continue;
    out.set(commodity.slice(3) as Element, amount);
  }
  return out;
}

/**
 * Run the entire cocoa chain, from a freshly planted tree to cocoa butter and
 * cocoa powder in `accounts.butter`/`accounts.powder`, applying every posting
 * directly to `ledger`. The husk and shell by-products are credited to the
 * region's own residue account (see `region.ts`) — real, conserved mass that
 * stays at origin rather than vanishing.
 */
export function runCocoaChain(
  ledger: Ledger,
  rng: Rng,
  registry: SubstanceRegistry,
  region: OriginRegion,
  fieldId: string,
  accounts: CocoaChainAccounts,
): CocoaChainResult {
  const residue = originResidueAccount(region);
  const biomassAccount = `${fieldId}.biomass`;
  if (!ledger.hasAccount(biomassAccount)) {
    ledger.openAccount({ id: biomassAccount, kind: 'stock', label: `standing cocoa biomass at ${fieldId}` });
  }

  const harvest = growAndHarvest({
    ledger,
    rng,
    region,
    definition: COCOA_TREE,
    fieldId,
    biomassAccount,
    primaryAccount: accounts.pod,
    residueAccount: residue,
  });
  const podMassUg = harvest.primaryDryMassUg + harvest.waterAddedUg;

  // -----------------------------------------------------------------------
  // Open the pod: fixed real mass ratio into wet bean-and-pulp and husk.
  // -----------------------------------------------------------------------
  const wetBeanWeight = BigInt(Math.round(WET_BEAN_SHARE_OF_POD * 1_000_000));
  const huskWeight = BigInt(Math.round((1 - WET_BEAN_SHARE_OF_POD) * 1_000_000));
  const opened = splitByFixedRatio(
    ledger,
    accounts.pod,
    [
      { account: accounts.bean, weight: wetBeanWeight },
      { account: residue, weight: huskWeight },
    ],
    'origin:cocoa:open-pod',
  );
  ledger.post(opened.posting);
  const wetBeanMassUg = opened.massUg[0] ?? 0n;
  const huskMassUg = opened.massUg[1] ?? 0n;

  // The pod's own added field moisture (harvest.waterAddedUg) is split by the
  // identical partition ratio, so the bean's share of it is consistent with
  // the split just applied to every other commodity above.
  const [beanMoistureShare = 0n] = partition(harvest.waterAddedUg, [wetBeanWeight, huskWeight]);
  let moistureRemainingUg = beanMoistureShare;
  let dryMassUg = wetBeanMassUg - moistureRemainingUg;

  // -----------------------------------------------------------------------
  // Ferment: aerobic respiration of pulp sugars, then moisture loss.
  // -----------------------------------------------------------------------
  const respired = respireClamped(
    ledger,
    accounts.bean,
    WORLD_ACCOUNTS.space,
    WORLD_ACCOUNTS.atmosphere,
    scaleUg(dryMassUg, FERMENTATION_RESPIRED_FRACTION),
    'origin:cocoa:ferment-respire',
  );
  const fermentationRespiredUg = respired?.glucoseMassUg ?? 0n;
  dryMassUg -= fermentationRespiredUg;

  const fermentDrying = dryGrain({
    primaryAccount: accounts.bean,
    dryMassUg,
    currentMoistureMassUg: moistureRemainingUg,
    targetMoistureContent: FERMENTATION_TARGET_MOISTURE,
    process: 'origin:cocoa:ferment-moisture-loss',
  });
  if (fermentDrying.posting.entries.length > 0) ledger.post(fermentDrying.posting);
  moistureRemainingUg -= fermentDrying.waterRemovedUg;

  // -----------------------------------------------------------------------
  // Dry to raw-bean moisture, then roast to roasted-bean moisture.
  // -----------------------------------------------------------------------
  const dried = dryGrain({
    primaryAccount: accounts.bean,
    dryMassUg,
    currentMoistureMassUg: moistureRemainingUg,
    targetMoistureContent: DRIED_TARGET_MOISTURE,
    process: 'origin:cocoa:dry',
  });
  if (dried.posting.entries.length > 0) ledger.post(dried.posting);
  moistureRemainingUg -= dried.waterRemovedUg;

  const roasted = dryGrain({
    primaryAccount: accounts.bean,
    dryMassUg,
    currentMoistureMassUg: moistureRemainingUg,
    targetMoistureContent: ROASTED_TARGET_MOISTURE,
    process: 'origin:cocoa:roast',
  });
  if (roasted.posting.entries.length > 0) ledger.post(roasted.posting);
  moistureRemainingUg -= roasted.waterRemovedUg;

  // -----------------------------------------------------------------------
  // Winnow: nib vs shell, by composition.
  // -----------------------------------------------------------------------
  const beanComposition = accountComposition(ledger, accounts.bean);
  const winnowStreams: readonly StreamProfile[] = [
    { id: 'nib', elements: registry.get('cocoa-nib').elements, targetShare: NIB_SHARE_OF_ROASTED_BEAN },
    { id: 'shell', elements: registry.get('cocoa-shell').elements, targetShare: 1 - NIB_SHARE_OF_ROASTED_BEAN },
  ];
  const [nibComposition, shellComposition] = splitByProfile(beanComposition, winnowStreams) as [Composition, Composition];
  ledger.post(
    buildProcessPosting({
      process: 'origin:cocoa:winnow',
      inputs: [{ account: accounts.bean, composition: beanComposition }],
      outputs: [
        { account: accounts.nib, composition: nibComposition },
        { account: residue, composition: shellComposition },
      ],
    }),
  );
  const nibMassUg = compositionMass(nibComposition);
  const shellMassUg = compositionMass(shellComposition);

  // -----------------------------------------------------------------------
  // Grind to liquor: pure phase change, no mass loss — see cocoa-nib.json's
  // own note. Ground directly into the same account (no relabelling needed:
  // liquor and nib share one registered substance, this directory's file
  // note explains why).
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Press: butter vs powder, by composition.
  // -----------------------------------------------------------------------
  const liquorComposition = accountComposition(ledger, accounts.nib);
  const pressStreams: readonly StreamProfile[] = [
    { id: 'butter', elements: registry.get('cocoa-butter').elements, targetShare: BUTTER_SHARE_OF_LIQUOR },
    { id: 'powder', elements: registry.get('cocoa-powder').elements, targetShare: 1 - BUTTER_SHARE_OF_LIQUOR },
  ];
  const [butterComposition, powderComposition] = splitByProfile(liquorComposition, pressStreams) as [Composition, Composition];
  ledger.post(
    buildProcessPosting({
      process: 'origin:cocoa:press',
      inputs: [{ account: accounts.nib, composition: liquorComposition }],
      outputs: [
        { account: accounts.butter, composition: butterComposition },
        { account: accounts.powder, composition: powderComposition },
      ],
    }),
  );

  return {
    podMassUg,
    treeResidueMassUg: harvest.residueMassUg,
    huskMassUg,
    wetBeanMassUg,
    fermentationRespiredUg,
    fermentationMoistureLossUg: fermentDrying.waterRemovedUg,
    dryingMoistureLossUg: dried.waterRemovedUg,
    roastingMoistureLossUg: roasted.waterRemovedUg,
    nibMassUg,
    shellMassUg,
    butterMassUg: compositionMass(butterComposition),
    powderMassUg: compositionMass(powderComposition),
    daysGrown: harvest.daysGrown,
  };
}

function scaleUg(massUg: Micrograms, fraction: number): Micrograms {
  if (massUg <= 0n || fraction <= 0) return 0n;
  return BigInt(Math.floor(Number(massUg) * fraction));
}
