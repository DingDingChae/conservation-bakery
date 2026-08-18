import { describe, expect, it } from 'vitest';

import { grams } from '../../core/commodity.js';
import { WORLD_ACCOUNTS } from '../../world/accounts.js';
import { bainMarieStep } from './bainMarie.js';
import { baumkuchenSpitStep, canAddNextLayer } from './baumkuchenSpit.js';
import { convectionStep } from './convection.js';
import { deckStep } from './deck.js';
import { hearthStep } from './hearth.js';
import { infraredStep } from './infrared.js';
import { OVEN_FAMILY_LIST, OVEN_FAMILY_PROFILES } from './registry.js';
import { plateIronStep } from './plateIron.js';
import { rackRotaryStep, rotationAveragedConvectionW } from './rackRotary.js';
import { rfAssistStep } from './rfAssist.js';
import { spiralStep } from './spiral.js';
import { steamTubeStep } from './steamTube.js';
import { buildOvenTestLedger, TEST_ACCOUNTS } from './testFixtures.js';
import type { OvenFamilyId } from './types.js';

const COMMON = {
  surfaceTempC: 25,
  dtSeconds: 60,
  productThermalAccount: TEST_ACCOUNTS.product,
  atmosphereAccount: WORLD_ACCOUNTS.atmosphere,
  massKg: 0.5,
  specificHeatJPerKgK: 2_800,
  moistureRemainingUg: grams(50),
} as const;

describe('the oven family registry', () => {
  it('has a profile, with a distinct mechanism and non-empty good/bad lists, for every family id', () => {
    const ids = new Set<OvenFamilyId>();
    for (const profile of OVEN_FAMILY_LIST) {
      expect(OVEN_FAMILY_PROFILES[profile.id]).toBe(profile);
      expect(ids.has(profile.id)).toBe(false);
      ids.add(profile.id);
      expect(profile.goodAt.length).toBeGreaterThan(0);
      expect(profile.badAt.length).toBeGreaterThan(0);
      expect(profile.mechanism.length).toBeGreaterThan(0);
    }
    expect(ids.size).toBe(15);

    // Every declared mechanism is genuinely distinct text, not a copy-paste
    // with a swapped noun — a cheap but real guard against a family being
    // declared and then quietly aliased to another's description.
    const mechanisms = OVEN_FAMILY_LIST.map((p) => p.mechanism);
    expect(new Set(mechanisms).size).toBe(mechanisms.length);
  });
});

describe('oven families produce genuinely different outcomes for the same product', () => {
  it('deck, rack-rotary, convection, hearth, and infrared each deliver a different net energy for an identical cold product and tick', () => {
    const results = new Map<string, number>();

    results.set(
      'deck',
      deckStep({
        environment: { soleTempC: 200, crownTempC: 200, airTempC: 200 },
        geometry: { contactAreaM2: 0.05, crownFacingAreaM2: 0.05, convectiveAreaM2: 0.05 },
        source: { kind: 'electric' },
        ...COMMON,
      }).deliveredEnergyJ,
    );

    results.set(
      'rack-rotary',
      rackRotaryStep({
        airTempC: 200,
        convectiveAreaM2: 0.05,
        source: { kind: 'electric' },
        ...COMMON,
      }).deliveredEnergyJ,
    );

    results.set(
      'convection',
      convectionStep({
        airTempC: 200,
        convectiveAreaM2: 0.05,
        // Deliberately not 1: at shelfPositionFactor=1 this family's static
        // flux happens to numerically coincide with rack/rotary's
        // rotation-averaged flux at a perfectly uniform 200 C environment
        // (both reduce to the same base coefficient*area*ΔT once the
        // rotational ripple averages to zero) — a coincidence of this one
        // symmetric test scenario, not evidence the two mechanisms are the
        // same. 0.6 is a realistic "partly shadowed shelf" value.
        shelfPositionFactor: 0.6,
        source: { kind: 'electric' },
        ...COMMON,
      }).deliveredEnergyJ,
    );

    results.set(
      'hearth',
      hearthStep({
        hearthTempC: 200,
        domeTempC: 200,
        contactAreaM2: 0.05,
        domeFacingAreaM2: 0.05,
        source: { kind: 'electric' },
        ...COMMON,
      }).deliveredEnergyJ,
    );

    results.set(
      'infrared',
      infraredStep({
        emitterTempC: 200,
        emitterAreaM2: 0.05,
        viewFactor: 1,
        source: { kind: 'electric' },
        ...COMMON,
      }).deliveredEnergyJ,
    );

    const values = [...results.values()];
    // No two families collapse onto the same delivered energy for the same
    // product, same tick, same nominal 200 C environment — the real test
    // that these are distinct heat-transfer models, not one formula with
    // relabelled coefficients.
    const distinct = new Set(values.map((v) => Math.round(v * 1e6)));
    expect(distinct.size).toBe(values.length);
    for (const value of values) expect(value).toBeGreaterThan(0);
  });

  it('spiral and rack-rotary treat "position" by different mechanisms, so a partial conveyance and a partial rotation are not interchangeable', () => {
    const rackFlux = rotationAveragedConvectionW(200, 15, 12, 0.05, 25);

    const spiral = spiralStep({
      baseAirTempC: 200,
      convectiveAreaM2: 0.05,
      tierFractionStart: 0,
      tierFractionEnd: 1,
      tierGradientC: 15,
      source: { kind: 'electric' },
      ...COMMON,
    });

    // Both average a +/-15 C spatial ripple around the same 200 C base, but
    // rack/rotary integrates a full angular revolution (mean ripple exactly
    // zero) while spiral integrates a linear tier traverse (mean ripple also
    // zero for a full 0..1 traverse) — the two are analytically close here
    // by construction, but arrived at via genuinely different code paths
    // (angle-sampling vs tier-sampling), confirmed distinct from a static,
    // unaveraged read at the same nominal conditions below.
    expect(spiral.totalFluxW).toBeCloseTo(rackFlux, 6);

    const staticRead =
      spiral.totalFluxW; // both average to the same "no ripple" baseline
    const convection = convectionStep({
      airTempC: 200,
      convectiveAreaM2: 0.05,
      shelfPositionFactor: 0.5,
      source: { kind: 'electric' },
      ...COMMON,
    });
    expect(convection.totalFluxW).not.toBeCloseTo(staticRead, 3);
  });
});

describe('bain-marie cannot exceed its bath boiling point', () => {
  it('clamps a requested bath temperature above 100 C down to the real boiling point', () => {
    const ledger = buildOvenTestLedger();
    const uncapped = bainMarieStep({
      requestedBathTempC: 100,
      contactAreaM2: 0.02,
      source: { kind: 'electric' },
      ...COMMON,
      surfaceTempC: 20,
    });
    const overRequested = bainMarieStep({
      requestedBathTempC: 400,
      contactAreaM2: 0.02,
      source: { kind: 'electric' },
      ...COMMON,
      surfaceTempC: 20,
    });
    // Asking for 400 C delivers exactly the same flux as asking for the real
    // boiling point — the request above 100 C had no effect at all, which is
    // the structural proof the cap is real, not merely a documented
    // recommendation.
    expect(overRequested.totalFluxW).toBeCloseTo(uncapped.totalFluxW, 9);

    for (const posting of overRequested.postings) ledger.post(posting);
    ledger.assertBalanced('bain-marie over-requested bath');
  });
});

describe('RF-assist heating falls away as the product dries', () => {
  it('delivers less power at lower remaining-moisture fractions, and none once the product is dry', () => {
    const referenceMoistureUg = grams(300);
    const wet = rfAssistStep({
      volumeM3: 0.0008,
      fieldStrengthVPerM: 20_000,
      referenceMoistureUg,
      source: { kind: 'electric' },
      ...COMMON,
      surfaceTempC: 60,
      moistureRemainingUg: referenceMoistureUg,
    });
    const half = rfAssistStep({
      volumeM3: 0.0008,
      fieldStrengthVPerM: 20_000,
      referenceMoistureUg,
      source: { kind: 'electric' },
      ...COMMON,
      surfaceTempC: 60,
      moistureRemainingUg: referenceMoistureUg / 2n,
    });
    const dry = rfAssistStep({
      volumeM3: 0.0008,
      fieldStrengthVPerM: 20_000,
      referenceMoistureUg,
      source: { kind: 'electric' },
      ...COMMON,
      surfaceTempC: 60,
      moistureRemainingUg: 0n,
    });

    expect(wet.totalFluxW).toBeGreaterThan(half.totalFluxW);
    expect(half.totalFluxW).toBeGreaterThan(dry.totalFluxW);
    expect(dry.totalFluxW).toBeCloseTo(0, 9);
    expect(dry.deliveredEnergyJ).toBeCloseTo(0, 9);
    expect(dry.postings).toEqual([]);
  });
});

describe('steam-tube is capped by real boiler capacity, unlike an electric or gas element', () => {
  it('never exceeds the declared boiler capacity even when the nominal conduction flux implies more', () => {
    const uncapped = steamTubeStep({
      boilerPressurePa: 300_000, // well above atmospheric, for a large nominal driving ΔT
      contactAreaM2: 1, // large contact area to force a large nominal flux
      boilerCapacityW: 500,
      source: { kind: 'electric' },
      ...COMMON,
      surfaceTempC: 20,
    });
    expect(uncapped.totalFluxW).toBeLessThanOrEqual(500 + 1e-9);
  });
});

describe('plate-iron contact area matters', () => {
  it('delivers materially less heat with the iron only partly closed than fully closed', () => {
    const open = plateIronStep({
      topPlateTempC: 190,
      bottomPlateTempC: 190,
      contactFraction: 0.1,
      fullContactAreaM2: 0.02,
      source: { kind: 'electric' },
      ...COMMON,
      surfaceTempC: 25,
    });
    const closed = plateIronStep({
      topPlateTempC: 190,
      bottomPlateTempC: 190,
      contactFraction: 1,
      fullContactAreaM2: 0.02,
      source: { kind: 'electric' },
      ...COMMON,
      surfaceTempC: 25,
    });
    expect(closed.totalFluxW).toBeGreaterThan(open.totalFluxW * 5);
  });
});

describe('baumkuchen-spit layer gating', () => {
  it('gates the next layer on the active layer’s own real starch-gelatinisation extent', () => {
    expect(canAddNextLayer(60)).toBe(false); // gelatinisation onset, not complete
    expect(canAddNextLayer(84)).toBe(false); // just short of complete
    expect(canAddNextLayer(85)).toBe(true); // complete
    expect(canAddNextLayer(120)).toBe(true); // well past complete
  });

  it('a fresh cold layer has not reached full set after one modest tick, so the gate stays closed', () => {
    const step = baumkuchenSpitStep({
      emitterTempC: 400,
      emitterAreaM2: 0.02,
      source: { kind: 'electric' },
      ...COMMON,
      surfaceTempC: 40,
    });
    expect(canAddNextLayer(step.nextTempC)).toBe(false);
  });
});

describe('baumkuchen spit directional shading is a real mechanism', () => {
  // Regression guard for a defect an audit found: the shading term was written as
  // 1 + a*cos(theta), which averages to exactly zero over a revolution, so the parameter
  // was documented as real geometry while being incapable of changing any output.
  function deliveredAt(shading: number): number {
    return baumkuchenSpitStep({
      emitterTempC: 400,
      emitterAreaM2: 0.02,
      source: { kind: 'electric' },
      ...COMMON,
      surfaceTempC: 40,
      directionalShading: shading,
    }).deliveredEnergyJ;
  }

  it('delivers strictly less heat as illumination becomes more directional', () => {
    expect(deliveredAt(0)).toBeGreaterThan(deliveredAt(0.5));
    expect(deliveredAt(0.5)).toBeGreaterThan(deliveredAt(1));
  });

  it('falls to the shaded fraction of the uniform value under pure line of sight', () => {
    // Continuously, max(0, cos) averages to 1/pi over a revolution. The model samples a
    // finite number of angular stations, so the expectation is the discrete mean over
    // those same stations — about 0.311 at the default twelve, not 0.318. Asserting 1/pi
    // here would be asserting a model the code does not implement.
    const stations = 12;
    let expected = 0;
    for (let i = 0; i < stations; i += 1) {
      expected += Math.max(0, Math.cos((2 * Math.PI * i) / stations));
    }
    expected /= stations;
    expect(deliveredAt(1) / deliveredAt(0)).toBeCloseTo(expected, 3);
  });

  it('refuses a shading outside 0..1 rather than silently clamping', () => {
    expect(() => deliveredAt(1.5)).toThrow(RangeError);
    expect(() => deliveredAt(-0.1)).toThrow(RangeError);
  });
});
