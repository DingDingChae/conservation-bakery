import { describe, expect, it } from 'vitest';

import { ENERGY, elementCommodity, grams, joules } from '../../core/commodity.js';
import { WORLD_ACCOUNTS } from '../../world/accounts.js';
import { buildOvenTestLedger, fund, TEST_ACCOUNTS } from './testFixtures.js';
import { tunnelDirectFiredStep } from './tunnelDirectFired.js';
import { tunnelIndirectStep } from './tunnelIndirect.js';

function fundMethaneFuel(ledger: ReturnType<typeof buildOvenTestLedger>): void {
  fund(ledger, TEST_ACCOUNTS.fuel, elementCommodity('C'), grams(10_000_000));
  fund(ledger, TEST_ACCOUNTS.fuel, elementCommodity('H'), grams(3_500_000));
  fund(ledger, TEST_ACCOUNTS.fuel, ENERGY, joules(500_000_000));
}

describe('direct-fired vs indirect tunnel: whether combustion products reach the product zone', () => {
  it('direct-fired posts real combustion CO2/H2O into the same account used as the product-zone chamber', () => {
    const ledger = buildOvenTestLedger();
    fundMethaneFuel(ledger);
    const result = tunnelDirectFiredStep({
      zoneAirTempC: 220,
      convectiveAreaM2: 0.08,
      radiantAreaM2: 0.05,
      fuelAccount: TEST_ACCOUNTS.fuel,
      surfaceTempC: 25,
      dtSeconds: 60,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: TEST_ACCOUNTS.chamberZone,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: grams(50),
    });
    for (const posting of result.postings) ledger.post(posting);
    ledger.assertBalanced('tunnel-direct-fired');

    expect(ledger.balance(TEST_ACCOUNTS.chamberZone, elementCommodity('C'))).toBeGreaterThan(0n);
    expect(ledger.balance(TEST_ACCOUNTS.chamberZone, elementCommodity('H'))).toBeGreaterThan(0n);
  });

  it('indirect tunnel never posts combustion products into the product-zone chamber account, only the flue stack', () => {
    const ledger = buildOvenTestLedger();
    fundMethaneFuel(ledger);
    const result = tunnelIndirectStep({
      chamberAirTempC: 200,
      tubeBankTempC: 260,
      convectiveAreaM2: 0.08,
      radiantAreaM2: 0.05,
      fuelAccount: TEST_ACCOUNTS.fuel,
      surfaceTempC: 25,
      dtSeconds: 60,
      productThermalAccount: TEST_ACCOUNTS.product,
      // Note: unlike tunnelDirectFiredStep, this family has no parameter
      // that lets combustion reach `atmosphereAccount`/the chamber at all —
      // its own `flueStackAccount` (defaulted here) is structurally the
      // only place combustion can land.
      atmosphereAccount: TEST_ACCOUNTS.chamberZone,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: grams(50),
    });
    for (const posting of result.postings) ledger.post(posting);
    ledger.assertBalanced('tunnel-indirect');

    expect(ledger.balance(TEST_ACCOUNTS.chamberZone, elementCommodity('C'))).toBe(0n);
    // The real combustion products landed in the world atmosphere (the
    // default flue stack) instead.
    expect(ledger.balance(WORLD_ACCOUNTS.atmosphere, elementCommodity('C'))).toBeGreaterThan(0n);
  });
});
