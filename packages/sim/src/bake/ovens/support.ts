/**
 * The bookkeeping every oven family shares, regardless of its own heat-transfer
 * mechanism: source the tick's energy from a real account (or post a loss out,
 * if the product is running hotter than its heat source), then run the result
 * through `transform.ts`'s shared thermal/evaporation model so a product's
 * moisture is weighed and posted to the atmosphere on every family's tick, not
 * re-derived (and possibly forgotten) per family. Every family module in this
 * directory calls one of the two functions below exactly once per step.
 */

import { ENERGY, UJ_PER_J, roundHalfEven, type Microjoules } from '../../core/commodity.js';
import type { AccountId, Posting } from '../../core/ledger.js';
import { WORLD_ACCOUNTS } from '../../world/accounts.js';
import { deliverHeat, type OvenHeatSource } from '../oven.js';
import { postMoistureLoss, stepThermal } from '../transform.js';
import type { FamilyStepBase, FamilyStepResult, OvenFamilyId } from './types.js';

function processName(family: OvenFamilyId, base: FamilyStepBase): string {
  return base.process ?? `oven:${family}`;
}

/**
 * Apply one tick's net flux using a plain `bake/oven.ts` electric/gas heat
 * source. This is the path every family whose fuel account is an ordinary
 * `OvenHeatSource` uses (rack/rotary, convection, tunnel-direct-fired,
 * tunnel-indirect, spiral, hearth, infrared, rf-assist, bain-marie,
 * steam-tube, plate-iron, baumkuchen-spit) — only deck.ts, wood-fired,
 * and pressure-steamer need bespoke sourcing, and use
 * `stepFamilyWithDelivery` below instead.
 */
export function stepFamilyWithOvenSource(
  family: OvenFamilyId,
  fluxBreakdownW: Readonly<Record<string, number>>,
  totalFluxW: number,
  source: OvenHeatSource,
  base: FamilyStepBase,
): FamilyStepResult {
  const energyJ = totalFluxW * base.dtSeconds;
  if (energyJ > 0) {
    const delivery = deliverHeat(source, base.productThermalAccount, energyJ, processName(family, base));
    return finishFamilyStep(family, fluxBreakdownW, totalFluxW, base, delivery.postings, delivery.deliveredEnergy, delivery.wasteEnergy);
  }
  return finishFamilyStepWithLoss(family, fluxBreakdownW, totalFluxW, base, energyJ);
}

/**
 * Apply one tick's net flux where the caller has already built its own
 * balanced energy-sourcing postings (wood combustion, condensing steam) and
 * knows exactly how many microjoules actually reached the product versus were
 * wasted. Used by families whose fuel is not a plain `OvenHeatSource`.
 */
export function stepFamilyWithDelivery(
  family: OvenFamilyId,
  fluxBreakdownW: Readonly<Record<string, number>>,
  totalFluxW: number,
  base: FamilyStepBase,
  sourcePostings: readonly Posting[],
  deliveredEnergy: Microjoules,
  wasteEnergy: Microjoules,
): FamilyStepResult {
  return finishFamilyStep(family, fluxBreakdownW, totalFluxW, base, sourcePostings, deliveredEnergy, wasteEnergy);
}

function finishFamilyStep(
  family: OvenFamilyId,
  fluxBreakdownW: Readonly<Record<string, number>>,
  totalFluxW: number,
  base: FamilyStepBase,
  sourcePostings: readonly Posting[],
  deliveredEnergy: Microjoules,
  wasteEnergy: Microjoules,
): FamilyStepResult {
  const deliveredJ = Number(deliveredEnergy) / Number(UJ_PER_J);
  const thermal = stepThermal({
    currentTempC: base.surfaceTempC,
    deliveredEnergyJ: deliveredJ,
    massKg: base.massKg,
    specificHeatJPerKgK: base.specificHeatJPerKgK,
    moistureRemainingUg: base.moistureRemainingUg,
  });

  const postings: Posting[] = [...sourcePostings];
  if (thermal.evaporatedMassUg > 0n) {
    const moisture = postMoistureLoss(
      base.productMassAccount ?? base.productThermalAccount,
      base.atmosphereAccount,
      thermal.evaporatedMassUg,
      `${processName(family, base)}:moisture`,
    );
    if (moisture) postings.push(moisture.posting);
  }

  return {
    family,
    fluxBreakdownW,
    totalFluxW,
    postings,
    deliveredEnergyJ: deliveredJ,
    wasteEnergyJ: Number(wasteEnergy) / Number(UJ_PER_J),
    evaporatedMassUg: thermal.evaporatedMassUg,
    nextTempC: thermal.nextTempC,
  };
}

function finishFamilyStepWithLoss(
  family: OvenFamilyId,
  fluxBreakdownW: Readonly<Record<string, number>>,
  totalFluxW: number,
  base: FamilyStepBase,
  energyJ: number,
): FamilyStepResult {
  const lossSinkAccount: AccountId = base.lossSinkAccount ?? WORLD_ACCOUNTS.space;
  const lost = roundHalfEven(-energyJ * Number(UJ_PER_J));
  const postings: Posting[] = [];
  if (lost > 0n) {
    postings.push({
      process: `${processName(family, base)}:loss`,
      entries: [
        { account: base.productThermalAccount, commodity: ENERGY, delta: -lost },
        { account: lossSinkAccount, commodity: ENERGY, delta: lost },
      ],
    });
  }

  // A product losing heat net is not evaporating (stepThermal's own guard: no
  // moisture is driven off by a negative energy delivery), so only the
  // sensible-temperature path applies here.
  const thermal = stepThermal({
    currentTempC: base.surfaceTempC,
    deliveredEnergyJ: -(Number(lost) / Number(UJ_PER_J)),
    massKg: base.massKg,
    specificHeatJPerKgK: base.specificHeatJPerKgK,
    moistureRemainingUg: base.moistureRemainingUg,
  });

  return {
    family,
    fluxBreakdownW,
    totalFluxW,
    postings,
    deliveredEnergyJ: -(Number(lost) / Number(UJ_PER_J)),
    wasteEnergyJ: 0,
    evaporatedMassUg: 0n,
    nextTempC: thermal.nextTempC,
  };
}
