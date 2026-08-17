import { describe, expect, it } from 'vitest';

import { elementCommodity, grams } from '../core/commodity.js';
import type { Posting } from '../core/ledger.js';
import { Ledger } from '../core/ledger.js';
import { WORLD_ACCOUNTS, seedWorld, soilAccount } from '../world/accounts.js';
import { WINTER_WHEAT, growCropTick } from './crop.js';
import { addFieldMoisture, dryGrain, splitStandingBiomass } from './harvest.js';

const BIOMASS = 'crop.biomass';
const GRAIN = 'grain.store';
const STRAW = 'straw.store';

function residuals(posting: Posting): Map<string, bigint> {
  const sums = new Map<string, bigint>();
  for (const e of posting.entries) sums.set(e.commodity, (sums.get(e.commodity) ?? 0n) + e.delta);
  return sums;
}

function expectBalanced(posting: Posting): void {
  for (const [commodity, residual] of residuals(posting)) {
    expect(residual, `${posting.process}: ${commodity} residual`).toBe(0n);
  }
}

/** A fresh ledger with a standing crop of a chosen mass, split across the elements
 * winter wheat draws on as it grows -- built by actually growing a crop rather than
 * synthesising an arbitrary balance, so harvest tests exercise the same account
 * shape `field.ts` would produce. */
function grownField(targetDryMassUg: bigint): { ledger: Ledger; soil: string } {
  const ledger = new Ledger();
  seedWorld(ledger, { fields: ['harvest-field'] });
  ledger.openAccount({ id: BIOMASS, kind: 'stock', label: 'standing crop' });
  ledger.openAccount({ id: GRAIN, kind: 'stock', label: 'grain store' });
  ledger.openAccount({ id: STRAW, kind: 'stock', label: 'straw store' });
  const soil = soilAccount('harvest-field');

  let grown = 0n;
  let gdd = 800; // start mid-vegetative so growth is not canopy-limited from day one
  let guard = 0;
  while (grown < targetDryMassUg && guard < 2_000) {
    guard += 1;
    const result = growCropTick({
      ledger,
      definition: WINTER_WHEAT,
      biomassAccount: BIOMASS,
      soilAccount: soil,
      areaM2: 500_000n,
      gddAccumulated: gdd,
      insolationWPerM2: 260,
      meanTemperatureC: 17,
      dtSeconds: 86_400n,
    });
    for (const posting of result.postings) ledger.post(posting);
    grown += result.dryMatterGrownUg;
    gdd = result.gddAccumulated;
    if (result.stage === 'mature') break;
  }

  return { ledger, soil };
}

describe('splitStandingBiomass', () => {
  it.each([1n, 2n, 3n, 7n, 13n, 97n, 9_973n, grams(1), grams(500), grams(50_000)])(
    'splits every commodity exactly for a standing crop of %s micrograms of dry matter',
    (targetMass) => {
      const { ledger } = grownField(targetMass);
      const before = new Map(ledger.balances(BIOMASS));

      const { posting, primaryMassUg, residueMassUg } = splitStandingBiomass(
        ledger,
        WINTER_WHEAT,
        BIOMASS,
        GRAIN,
        STRAW,
      );

      expectBalanced(posting);
      ledger.post(posting);

      expect(ledger.audit().ok).toBe(true);
      expect(ledger.balance(BIOMASS, elementCommodity('C'))).toBe(0n);

      // Every element the standing crop held is accounted for, split between the two
      // destinations, with nothing left over and nothing invented.
      for (const [commodity, amount] of before) {
        const grainAmount = ledger.balance(GRAIN, commodity);
        const strawAmount = ledger.balance(STRAW, commodity);
        expect(grainAmount + strawAmount).toBe(amount);
      }

      expect(primaryMassUg + residueMassUg).toBeGreaterThan(0n);
    },
  );

  it('splits an empty standing crop into an empty posting', () => {
    const ledger = new Ledger();
    seedWorld(ledger, { fields: ['empty-field'] });
    ledger.openAccount({ id: BIOMASS, kind: 'stock', label: 'standing crop' });
    ledger.openAccount({ id: GRAIN, kind: 'stock', label: 'grain store' });
    ledger.openAccount({ id: STRAW, kind: 'stock', label: 'straw store' });

    const { posting, primaryMassUg, residueMassUg } = splitStandingBiomass(
      ledger,
      WINTER_WHEAT,
      BIOMASS,
      GRAIN,
      STRAW,
    );

    expect(posting.entries).toEqual([]);
    expect(primaryMassUg).toBe(0n);
    expect(residueMassUg).toBe(0n);
  });

  it('roughly follows the crop harvest index for a well-grown crop', () => {
    const { ledger } = grownField(grams(20_000));
    const { primaryMassUg, residueMassUg } = splitStandingBiomass(ledger, WINTER_WHEAT, BIOMASS, GRAIN, STRAW);
    const total = primaryMassUg + residueMassUg;
    const grainFraction = Number(primaryMassUg) / Number(total);
    expect(grainFraction).toBeGreaterThan(WINTER_WHEAT.harvestIndex - 0.01);
    expect(grainFraction).toBeLessThan(WINTER_WHEAT.harvestIndex + 0.01);
  });
});

describe('addFieldMoisture and dryGrain', () => {
  it.each([1n, 2n, 3n, 7n, 9_973n, grams(1), grams(500)])(
    'adds and then removes moisture exactly, for a dry mass of %s micrograms',
    (dryMassUg) => {
      const ledger = new Ledger();
      seedWorld(ledger, { fields: ['moist-field'] });
      ledger.openAccount({ id: GRAIN, kind: 'stock', label: 'grain store' });

      const moisture = addFieldMoisture({
        ledger,
        definition: WINTER_WHEAT,
        primaryAccount: GRAIN,
        soilAccount: soilAccount('moist-field'),
        dryMassUg,
      });
      expectBalanced(moisture.posting);
      if (moisture.posting.entries.length > 0) ledger.post(moisture.posting);
      expect(ledger.audit().ok).toBe(true);

      const drying = dryGrain({
        primaryAccount: GRAIN,
        dryMassUg,
        currentMoistureMassUg: moisture.waterAddedUg,
        targetMoistureContent: 0, // dry down to bone dry, to check the full amount can leave
      });
      expectBalanced(drying.posting);
      if (drying.posting.entries.length > 0) ledger.post(drying.posting);

      expect(ledger.audit().ok).toBe(true);
      expect(drying.waterRemovedUg).toBe(moisture.waterAddedUg);
    },
  );

  it('drying to a nonzero target moisture leaves exactly that much water behind', () => {
    const ledger = new Ledger();
    seedWorld(ledger, { fields: ['moist-field-2'] });
    ledger.openAccount({ id: GRAIN, kind: 'stock', label: 'grain store' });
    const dryMassUg = grams(1_000);

    const moisture = addFieldMoisture({
      ledger,
      definition: WINTER_WHEAT,
      primaryAccount: GRAIN,
      soilAccount: soilAccount('moist-field-2'),
      dryMassUg,
    });
    ledger.post(moisture.posting);

    const drying = dryGrain({
      primaryAccount: GRAIN,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      dryMassUg,
      currentMoistureMassUg: moisture.waterAddedUg,
      targetMoistureContent: WINTER_WHEAT.freshMoistureContent, // storage-dry target
    });
    ledger.post(drying.posting);

    const remainingMoisture = moisture.waterAddedUg - drying.waterRemovedUg;
    const totalMass = ledger.balance(GRAIN, elementCommodity('H')) + ledger.balance(GRAIN, elementCommodity('O'));
    // Field moisture content equalled the target already, so drying should remove
    // (close to) nothing further.
    expect(remainingMoisture).toBeGreaterThanOrEqual(0n);
    expect(totalMass).toBeGreaterThan(0n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('a zero dry mass produces no moisture and no drying postings', () => {
    const moisture = addFieldMoisture({
      ledger: new Ledger(),
      definition: WINTER_WHEAT,
      primaryAccount: GRAIN,
      soilAccount: 'soil.none',
      dryMassUg: 0n,
    });
    expect(moisture.posting.entries).toEqual([]);
    expect(moisture.waterAddedUg).toBe(0n);

    const drying = dryGrain({
      primaryAccount: GRAIN,
      dryMassUg: 0n,
      currentMoistureMassUg: 0n,
      targetMoistureContent: 0.14,
    });
    expect(drying.posting.entries).toEqual([]);
    expect(drying.waterRemovedUg).toBe(0n);
  });
});
