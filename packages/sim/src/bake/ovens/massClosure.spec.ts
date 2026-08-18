import { describe, expect, it } from 'vitest';

import { ENERGY, elementCommodity, grams, joules, type Micrograms } from '../../core/commodity.js';
import type { Ledger } from '../../core/ledger.js';
import { WORLD_ACCOUNTS } from '../../world/accounts.js';
import { bainMarieStep } from './bainMarie.js';
import { baumkuchenSpitStep } from './baumkuchenSpit.js';
import { convectionStep } from './convection.js';
import { deckStep } from './deck.js';
import { hearthStep } from './hearth.js';
import { infraredStep } from './infrared.js';
import { plateIronStep } from './plateIron.js';
import { pressureSteamerStep } from './pressureSteamer.js';
import { rackRotaryStep } from './rackRotary.js';
import { rfAssistStep } from './rfAssist.js';
import { spiralStep } from './spiral.js';
import { steamTubeStep } from './steamTube.js';
import { buildOvenTestLedger, fund, TEST_ACCOUNTS } from './testFixtures.js';
import { tunnelDirectFiredStep } from './tunnelDirectFired.js';
import { tunnelIndirectStep } from './tunnelIndirect.js';
import type { FamilyStepResult } from './types.js';
import { woodFiredStep } from './woodFired.js';

function fundMethaneFuel(ledger: Ledger, account = TEST_ACCOUNTS.fuel): void {
  fund(ledger, account, elementCommodity('C'), grams(10_000_000));
  fund(ledger, account, elementCommodity('H'), grams(3_500_000));
  fund(ledger, account, ENERGY, joules(500_000_000));
}

function fundWoodFuel(ledger: Ledger, account = TEST_ACCOUNTS.fuel): void {
  fund(ledger, account, elementCommodity('C'), grams(5_000_000));
  fund(ledger, account, elementCommodity('H'), grams(1_000_000));
  fund(ledger, account, elementCommodity('O'), grams(5_000_000));
  fund(ledger, account, elementCommodity('Ash'), grams(200_000));
  fund(ledger, account, ENERGY, joules(500_000_000));
}

function fundBoilerWater(ledger: Ledger, account = TEST_ACCOUNTS.boilerWater): void {
  fund(ledger, account, elementCommodity('H'), grams(1_000_000));
  fund(ledger, account, elementCommodity('O'), grams(8_000_000));
}

/** Post every posting a step produced and assert the ledger still closes
 * exactly — the structural guarantee this whole directory exists to keep. */
function applyAndAssertBalanced(ledger: Ledger, result: FamilyStepResult, context: string): void {
  for (const posting of result.postings) ledger.post(posting);
  ledger.assertBalanced(context);
  const report = ledger.audit();
  expect(report.ok, `${context}: ${JSON.stringify(report.discrepancies)}`).toBe(true);
}

const MOISTURE_INPUTS: Micrograms = grams(50);

describe('oven families: mass and energy close exactly across many inputs', () => {
  const dtSamples = [10, 30, 90];
  const massSamples = [0.3, 0.6, 1.2];

  it.each(dtSamples.flatMap((dt) => massSamples.map((massKg) => ({ dt, massKg }))))(
    'deck: dt=$dt massKg=$massKg',
    ({ dt, massKg }) => {
      const ledger = buildOvenTestLedger();
      fundMethaneFuel(ledger);
      const result = deckStep({
        environment: { soleTempC: 210, crownTempC: 220, airTempC: 190 },
        geometry: { contactAreaM2: 0.05, crownFacingAreaM2: 0.05, convectiveAreaM2: 0.08 },
        surfaceTempC: 25,
        dtSeconds: dt,
        source: { kind: 'gas', fuelAccount: TEST_ACCOUNTS.fuel, atmosphereAccount: WORLD_ACCOUNTS.atmosphere },
        productThermalAccount: TEST_ACCOUNTS.product,
        productMassAccount: TEST_ACCOUNTS.product,
        atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
        massKg,
        specificHeatJPerKgK: 2_800,
        moistureRemainingUg: MOISTURE_INPUTS,
      });
      applyAndAssertBalanced(ledger, result, `deck dt=${dt} massKg=${massKg}`);
    },
  );

  it.each(dtSamples)('rack-rotary: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    const result = rackRotaryStep({
      airTempC: 190,
      convectiveAreaM2: 0.1,
      source: { kind: 'electric' },
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `rack-rotary dt=${dt}`);
  });

  it.each(dtSamples)('convection: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    const result = convectionStep({
      airTempC: 180,
      convectiveAreaM2: 0.1,
      shelfPositionFactor: 0.7,
      source: { kind: 'electric' },
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `convection dt=${dt}`);
  });

  it.each(dtSamples)('tunnel-direct-fired: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    fundMethaneFuel(ledger);
    const result = tunnelDirectFiredStep({
      zoneAirTempC: 220,
      convectiveAreaM2: 0.08,
      radiantAreaM2: 0.05,
      fuelAccount: TEST_ACCOUNTS.fuel,
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: TEST_ACCOUNTS.chamberZone,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `tunnel-direct-fired dt=${dt}`);
  });

  it.each(dtSamples)('tunnel-indirect: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    fundMethaneFuel(ledger);
    const result = tunnelIndirectStep({
      chamberAirTempC: 200,
      tubeBankTempC: 260,
      convectiveAreaM2: 0.08,
      radiantAreaM2: 0.05,
      fuelAccount: TEST_ACCOUNTS.fuel,
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: TEST_ACCOUNTS.chamberZone,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `tunnel-indirect dt=${dt}`);
  });

  it.each(dtSamples)('steam-tube: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    const result = steamTubeStep({
      boilerPressurePa: 150_000,
      contactAreaM2: 0.05,
      boilerCapacityW: 2_000,
      source: { kind: 'electric' },
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `steam-tube dt=${dt}`);
  });

  it.each(dtSamples)('spiral: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    const result = spiralStep({
      baseAirTempC: 175,
      convectiveAreaM2: 0.08,
      tierFractionStart: 0.1,
      tierFractionEnd: 0.9,
      source: { kind: 'electric' },
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `spiral dt=${dt}`);
  });

  it.each(dtSamples)('hearth: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    const result = hearthStep({
      hearthTempC: 250,
      domeTempC: 260,
      contactAreaM2: 0.06,
      domeFacingAreaM2: 0.06,
      source: { kind: 'electric' },
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.6,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `hearth dt=${dt}`);
  });

  it.each(dtSamples)('wood-fired: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    fundWoodFuel(ledger);
    const result = woodFiredStep({
      fireTempC: 350,
      draftTempC: 220,
      radiantAreaM2: 0.05,
      convectiveAreaM2: 0.05,
      charge: {
        fuelAccount: TEST_ACCOUNTS.fuel,
        fuelMassUg: grams(500),
        ashBinAccount: TEST_ACCOUNTS.ashBin,
      },
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `wood-fired dt=${dt}`);
  });

  it.each(dtSamples)('infrared: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    const result = infraredStep({
      emitterTempC: 800,
      emitterAreaM2: 0.03,
      viewFactor: 0.6,
      source: { kind: 'electric' },
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.3,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `infrared dt=${dt}`);
  });

  it.each(dtSamples)('rf-assist: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    const result = rfAssistStep({
      volumeM3: 0.0008,
      fieldStrengthVPerM: 20_000,
      referenceMoistureUg: grams(300),
      source: { kind: 'electric' },
      surfaceTempC: 60,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.5,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: grams(150),
    });
    applyAndAssertBalanced(ledger, result, `rf-assist dt=${dt}`);
  });

  it.each(dtSamples)('bain-marie: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    const result = bainMarieStep({
      requestedBathTempC: 100,
      contactAreaM2: 0.02,
      source: { kind: 'electric' },
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.2,
      specificHeatJPerKgK: 3_180,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `bain-marie dt=${dt}`);
  });

  it.each(dtSamples)('pressure-steamer: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    fundBoilerWater(ledger);
    const result = pressureSteamerStep({
      chamberPressurePa: 180_000,
      contactAreaM2: 0.03,
      steam: {
        boilerWaterAccount: TEST_ACCOUNTS.boilerWater,
        boilerEnergySource: { kind: 'electric' },
        condensateAccount: TEST_ACCOUNTS.condensate,
      },
      surfaceTempC: 40,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.4,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: MOISTURE_INPUTS,
    });
    applyAndAssertBalanced(ledger, result, `pressure-steamer dt=${dt}`);
  });

  it.each(dtSamples)('plate-iron: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    const result = plateIronStep({
      topPlateTempC: 190,
      bottomPlateTempC: 185,
      contactFraction: 0.9,
      fullContactAreaM2: 0.02,
      source: { kind: 'electric' },
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.12,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: grams(30),
    });
    applyAndAssertBalanced(ledger, result, `plate-iron dt=${dt}`);
  });

  it.each(dtSamples)('baumkuchen-spit: dt=%i', (dt) => {
    const ledger = buildOvenTestLedger();
    const result = baumkuchenSpitStep({
      emitterTempC: 500,
      emitterAreaM2: 0.02,
      source: { kind: 'electric' },
      surfaceTempC: 25,
      dtSeconds: dt,
      productThermalAccount: TEST_ACCOUNTS.product,
      atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
      massKg: 0.05,
      specificHeatJPerKgK: 2_800,
      moistureRemainingUg: grams(10),
    });
    applyAndAssertBalanced(ledger, result, `baumkuchen-spit dt=${dt}`);
  });
});
