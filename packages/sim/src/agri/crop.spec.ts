import { describe, expect, it } from 'vitest';

import { elementCommodity } from '../core/commodity.js';
import type { Posting } from '../core/ledger.js';
import { Ledger } from '../core/ledger.js';
import { WORLD_ACCOUNTS, seedWorld, soilAccount } from '../world/accounts.js';
import type { CropStage } from './crop.js';
import {
  SUGAR_BEET,
  WINTER_WHEAT,
  growCropTick,
  interceptionFraction,
  stageForGddFraction,
} from './crop.js';

const BIOMASS = 'crop.biomass';

/** Every commodity a posting touches must sum to exactly zero across its entries. */
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

function freshField(fieldName = 'test-field'): { ledger: Ledger; soil: string } {
  const ledger = new Ledger();
  seedWorld(ledger, { fields: [fieldName] });
  ledger.openAccount({ id: BIOMASS, kind: 'stock', label: 'standing crop' });
  return { ledger, soil: soilAccount(fieldName) };
}

describe('growCropTick', () => {
  it.each([
    { label: 'area=1 (1 second)', areaM2: 1n, dtSeconds: 1n, insolation: 0.001 },
    { label: 'area=7 (1 hour)', areaM2: 7n, dtSeconds: 3_600n, insolation: 200 },
    { label: 'area=9973 (prime, 1 day)', areaM2: 9_973n, dtSeconds: 86_400n, insolation: 250 },
    { label: 'area=100000 (1 day)', areaM2: 100_000n, dtSeconds: 86_400n, insolation: 300 },
    { label: 'area=1299827 (prime, 1 week)', areaM2: 1_299_827n, dtSeconds: 604_800n, insolation: 150 },
  ])('every posting balances exactly for $label', ({ areaM2, dtSeconds, insolation }) => {
    const { ledger, soil } = freshField();
    const result = growCropTick({
      ledger,
      definition: WINTER_WHEAT,
      biomassAccount: BIOMASS,
      soilAccount: soil,
      areaM2,
      gddAccumulated: 200,
      insolationWPerM2: insolation,
      meanTemperatureC: 15,
      dtSeconds,
    });
    for (const posting of result.postings) {
      expectBalanced(posting);
      ledger.post(posting);
    }
    expect(ledger.audit().ok).toBe(true);
  });

  it('every posting balances exactly for sugar beet too, across the same spread of areas', () => {
    for (const { areaM2, dtSeconds, insolation } of [
      { areaM2: 3n, dtSeconds: 13n, insolation: 97 },
      { areaM2: 50_000n, dtSeconds: 86_400n, insolation: 280 },
    ]) {
      const { ledger, soil } = freshField();
      const result = growCropTick({
        ledger,
        definition: SUGAR_BEET,
        biomassAccount: BIOMASS,
        soilAccount: soil,
        areaM2,
        gddAccumulated: 150,
        insolationWPerM2: insolation,
        meanTemperatureC: 18,
        dtSeconds,
      });
      for (const posting of result.postings) {
        expectBalanced(posting);
        ledger.post(posting);
      }
      expect(ledger.audit().ok).toBe(true);
    }
  });

  it('produces no growth and no postings at night (zero insolation)', () => {
    const { ledger, soil } = freshField();
    const result = growCropTick({
      ledger,
      definition: WINTER_WHEAT,
      biomassAccount: BIOMASS,
      soilAccount: soil,
      areaM2: 100_000n,
      gddAccumulated: 200,
      insolationWPerM2: 0,
      meanTemperatureC: 15,
      dtSeconds: 86_400n,
    });
    expect(result.postings).toEqual([]);
    expect(result.dryMatterGrownUg).toBe(0n);
  });

  it('produces no further growth once the crop has reached maturity', () => {
    const { ledger, soil } = freshField();
    const result = growCropTick({
      ledger,
      definition: WINTER_WHEAT,
      biomassAccount: BIOMASS,
      soilAccount: soil,
      areaM2: 100_000n,
      gddAccumulated: WINTER_WHEAT.gddToMaturity + 500, // well past maturity
      insolationWPerM2: 300,
      meanTemperatureC: 20,
      dtSeconds: 86_400n,
    });
    expect(result.stage).toBe('mature');
    expect(result.postings).toEqual([]);
    expect(result.dryMatterGrownUg).toBe(0n);
  });

  it('growth is nutrient-limited when soil nitrogen is scarce, and yield reflects the deficit', () => {
    const { ledger: scarceLedger, soil: scarceSoil } = freshField('scarce-n-field');
    const currentN = scarceLedger.balance(scarceSoil, elementCommodity('N'));
    const drain = currentN - 1_000n; // leave a trace behind
    scarceLedger.post({
      process: 'test:drain-nitrogen',
      entries: [
        { account: scarceSoil, commodity: elementCommodity('N'), delta: -drain },
        { account: WORLD_ACCOUNTS.marketUtilities, commodity: elementCommodity('N'), delta: drain },
      ],
    });

    const params = {
      definition: WINTER_WHEAT,
      biomassAccount: BIOMASS,
      areaM2: 100_000n,
      gddAccumulated: 200,
      insolationWPerM2: 300,
      meanTemperatureC: 16,
      dtSeconds: 86_400n,
    };

    const scarce = growCropTick({ ledger: scarceLedger, soilAccount: scarceSoil, ...params });

    const { ledger: fedLedger, soil: fedSoil } = freshField('fed-field');
    const fed = growCropTick({ ledger: fedLedger, soilAccount: fedSoil, ...params });

    expect(fed.dryMatterGrownUg).toBeGreaterThan(0n);
    expect(scarce.dryMatterGrownUg).toBeLessThan(fed.dryMatterGrownUg);
  });

  it('is deterministic: identical starting states and identical calls produce identical results', () => {
    // Same field name in two independent ledgers, so the resulting postings are
    // directly comparable entry-for-entry, not merely equal up to account naming.
    const { ledger: ledgerA, soil: soilA } = freshField('det');
    const { ledger: ledgerB, soil: soilB } = freshField('det');
    const params = {
      definition: WINTER_WHEAT,
      biomassAccount: BIOMASS,
      areaM2: 100_000n,
      gddAccumulated: 300,
      insolationWPerM2: 260,
      meanTemperatureC: 17,
      dtSeconds: 86_400n,
    };

    const resultA = growCropTick({ ledger: ledgerA, soilAccount: soilA, ...params });
    const resultB = growCropTick({ ledger: ledgerB, soilAccount: soilB, ...params });

    expect(resultA.dryMatterGrownUg).toBe(resultB.dryMatterGrownUg);
    expect(resultA.stage).toBe(resultB.stage);
    expect(resultA.gddAccumulated).toBe(resultB.gddAccumulated);
    expect(resultA.postings.map((p) => p.entries)).toEqual(resultB.postings.map((p) => p.entries));
  });

  it('a full growing season for winter wheat reaches maturity, staying balanced every day', () => {
    const { ledger, soil } = freshField('wheat-season');
    let gdd = 0;
    let stage: CropStage = 'planted';
    const dtSeconds = 86_400n;

    for (let day = 0; day < 400 && stage !== 'mature'; day += 1) {
      const result = growCropTick({
        ledger,
        definition: WINTER_WHEAT,
        biomassAccount: BIOMASS,
        soilAccount: soil,
        areaM2: 100_000n,
        gddAccumulated: gdd,
        insolationWPerM2: 250,
        meanTemperatureC: 16,
        dtSeconds,
      });
      for (const posting of result.postings) ledger.post(posting);
      gdd = result.gddAccumulated;
      stage = result.stage;
      expect(ledger.audit().ok).toBe(true);
    }

    expect(stage).toBe('mature');
    expect(ledger.balance(BIOMASS, elementCommodity('C'))).toBeGreaterThan(0n);
  });

  it('a full growing season for sugar beet reaches maturity, staying balanced every day', () => {
    const { ledger, soil } = freshField('beet-season');
    let gdd = 0;
    let stage: CropStage = 'planted';
    const dtSeconds = 86_400n;

    for (let day = 0; day < 400 && stage !== 'mature'; day += 1) {
      const result = growCropTick({
        ledger,
        definition: SUGAR_BEET,
        biomassAccount: BIOMASS,
        soilAccount: soil,
        areaM2: 100_000n,
        gddAccumulated: gdd,
        insolationWPerM2: 260,
        meanTemperatureC: 18,
        dtSeconds,
      });
      for (const posting of result.postings) ledger.post(posting);
      gdd = result.gddAccumulated;
      stage = result.stage;
      expect(ledger.audit().ok).toBe(true);
    }

    expect(stage).toBe('mature');
    expect(ledger.balance(BIOMASS, elementCommodity('C'))).toBeGreaterThan(0n);
  });
});

describe('stageForGddFraction', () => {
  it('reports the last stage threshold reached, ascending', () => {
    expect(stageForGddFraction(WINTER_WHEAT, 0)).toBe('planted');
    expect(stageForGddFraction(WINTER_WHEAT, 0.6)).toBe('reproductive');
    expect(stageForGddFraction(WINTER_WHEAT, 1)).toBe('mature');
  });
});

describe('interceptionFraction', () => {
  it('is zero before emergence and at full maturity', () => {
    expect(interceptionFraction(WINTER_WHEAT, 0)).toBe(0);
    expect(interceptionFraction(WINTER_WHEAT, 1)).toBe(0);
  });

  it('reaches the crop peak canopy fraction during the plateau', () => {
    expect(interceptionFraction(WINTER_WHEAT, 0.4)).toBeCloseTo(WINTER_WHEAT.peakCanopyFraction, 6);
  });
});
