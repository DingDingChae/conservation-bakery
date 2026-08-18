import { describe, expect, it } from 'vitest';

import { ENERGY, elementCommodity, grams, joules } from '../../core/commodity.js';
import { WORLD_ACCOUNTS } from '../../world/accounts.js';
import { buildOvenTestLedger, fund, TEST_ACCOUNTS } from './testFixtures.js';
import { combustWoodCharge, woodFiredStep } from './woodFired.js';

function fundWoodFuel(ledger: ReturnType<typeof buildOvenTestLedger>): void {
  fund(ledger, TEST_ACCOUNTS.fuel, elementCommodity('C'), grams(5_000_000));
  fund(ledger, TEST_ACCOUNTS.fuel, elementCommodity('H'), grams(1_000_000));
  fund(ledger, TEST_ACCOUNTS.fuel, elementCommodity('O'), grams(5_000_000));
  fund(ledger, TEST_ACCOUNTS.fuel, elementCommodity('Ash'), grams(200_000));
  fund(ledger, TEST_ACCOUNTS.fuel, ENERGY, joules(500_000_000));
}

describe('wood-fired oven: real fuel accounting', () => {
  it('splits an exact fuel charge into combustible, moisture and ash mass that sum back to the charge exactly', () => {
    const ledger = buildOvenTestLedger();
    fundWoodFuel(ledger);
    const chargeMassUg = grams(1_000);
    const combustion = combustWoodCharge(
      { fuelAccount: TEST_ACCOUNTS.fuel, fuelMassUg: chargeMassUg, ashBinAccount: TEST_ACCOUNTS.ashBin },
      WORLD_ACCOUNTS.atmosphere,
      'test:wood-combustion',
    );
    expect(combustion.combustibleMassUg + combustion.moistureMassUg + combustion.ashMassUg).toBe(chargeMassUg);
    expect(combustion.ashMassUg).toBeGreaterThan(0n);
    expect(combustion.moistureMassUg).toBeGreaterThan(0n);

    ledger.post(combustion.posting);
    ledger.assertBalanced('wood combustion');
    // The ash genuinely arrived in the ash bin — not dropped.
    expect(ledger.balance(TEST_ACCOUNTS.ashBin, elementCommodity('Ash'))).toBe(combustion.ashMassUg);
  });

  it('credits ash to the ash bin and never to the atmosphere', () => {
    const ledger = buildOvenTestLedger();
    fundWoodFuel(ledger);
    const combustion = combustWoodCharge(
      { fuelAccount: TEST_ACCOUNTS.fuel, fuelMassUg: grams(1_000), ashBinAccount: TEST_ACCOUNTS.ashBin },
      WORLD_ACCOUNTS.atmosphere,
      'test:wood-combustion',
    );
    ledger.post(combustion.posting);
    expect(ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity('Ash'))).toBe(0n);
  });

  it('a wetter charge delivers strictly less net heat to the product than a drier charge of the same size', () => {
    const dryLedger = buildOvenTestLedger();
    fundWoodFuel(dryLedger);
    const dryResult = woodFiredStep({
      fireTempC: 400,
      draftTempC: 250,
      radiantAreaM2: 0.06,
      convectiveAreaM2: 0.06,
      charge: {
        fuelAccount: TEST_ACCOUNTS.fuel,
        fuelMassUg: grams(2),
        moistureFraction: 0.05,
        ashBinAccount: TEST_ACCOUNTS.ashBin,
      },
      surfaceTempC: 25,
      dtSeconds: 60,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: grams(50),
    });

    const wetLedger = buildOvenTestLedger();
    fundWoodFuel(wetLedger);
    const wetResult = woodFiredStep({
      fireTempC: 400,
      draftTempC: 250,
      radiantAreaM2: 0.06,
      convectiveAreaM2: 0.06,
      charge: {
        fuelAccount: TEST_ACCOUNTS.fuel,
        fuelMassUg: grams(2),
        moistureFraction: 0.5,
        ashBinAccount: TEST_ACCOUNTS.ashBin,
      },
      surfaceTempC: 25,
      dtSeconds: 60,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: grams(50),
    });

    expect(wetResult.deliveredEnergyJ).toBeLessThan(dryResult.deliveredEnergyJ);

    for (const posting of dryResult.postings) dryLedger.post(posting);
    dryLedger.assertBalanced('dry wood charge');
    for (const posting of wetResult.postings) wetLedger.post(posting);
    wetLedger.assertBalanced('wet wood charge');
  });

  it('mass closes exactly across several charge sizes and moisture fractions', () => {
    const cases = [
      { fuelMassUg: grams(200), moistureFraction: 0.1, ashFraction: 0.005 },
      { fuelMassUg: grams(800), moistureFraction: 0.2, ashFraction: 0.01 },
      { fuelMassUg: grams(2_000), moistureFraction: 0.35, ashFraction: 0.02 },
    ];
    for (const testCase of cases) {
      const ledger = buildOvenTestLedger();
      fundWoodFuel(ledger);
      const result = woodFiredStep({
        fireTempC: 380,
        draftTempC: 240,
        radiantAreaM2: 0.06,
        convectiveAreaM2: 0.06,
        charge: {
          fuelAccount: TEST_ACCOUNTS.fuel,
          fuelMassUg: testCase.fuelMassUg,
          moistureFraction: testCase.moistureFraction,
          ashFraction: testCase.ashFraction,
          ashBinAccount: TEST_ACCOUNTS.ashBin,
        },
        surfaceTempC: 25,
        dtSeconds: 45,
        productThermalAccount: TEST_ACCOUNTS.product,
        atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
        massKg: 0.5,
        specificHeatJPerKgK: 2_800,
        moistureRemainingUg: grams(50),
      });
      for (const posting of result.postings) ledger.post(posting);
      const label = `fuelMassUg=${testCase.fuelMassUg} moistureFraction=${testCase.moistureFraction} ashFraction=${testCase.ashFraction}`;
      ledger.assertBalanced(`wood-fired ${label}`);
      const report = ledger.audit();
      expect(report.ok, JSON.stringify(report.discrepancies, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))).toBe(true);
    }
  });
});
