import { describe, expect, it } from 'vitest';

import { ENERGY, elementCommodity } from '../core/commodity.js';
import { Ledger } from '../core/ledger.js';
import { WORLD_ACCOUNTS } from '../world/accounts.js';
import {
  deliverHeat,
  heatFluxes,
  ovenStep,
  type HeatTransferGeometry,
  type OvenEnvironment,
} from './oven.js';

const HOT_ENVIRONMENT: OvenEnvironment = { soleTempC: 180, crownTempC: 200, airTempC: 175 };
const GEOMETRY: HeatTransferGeometry = { contactAreaM2: 0.05, crownFacingAreaM2: 0.05, convectiveAreaM2: 0.08 };

describe('heatFluxes', () => {
  it('flows toward a cold product from a hot environment on every path', () => {
    const fluxes = heatFluxes(HOT_ENVIRONMENT, GEOMETRY, 20);
    expect(fluxes.conductionW).toBeGreaterThan(0);
    expect(fluxes.radiationW).toBeGreaterThan(0);
    expect(fluxes.convectionW).toBeGreaterThan(0);
    expect(fluxes.totalW).toBeGreaterThan(0);
  });

  it('flows out of a product hotter than its environment', () => {
    const fluxes = heatFluxes(HOT_ENVIRONMENT, GEOMETRY, 250);
    expect(fluxes.totalW).toBeLessThan(0);
  });

  it('is exactly zero net flux when the product matches every environment temperature', () => {
    const uniform: OvenEnvironment = { soleTempC: 100, crownTempC: 100, airTempC: 100 };
    const fluxes = heatFluxes(uniform, GEOMETRY, 100);
    expect(fluxes.conductionW).toBe(0);
    expect(fluxes.convectionW).toBe(0);
    expect(fluxes.radiationW).toBeCloseTo(0, 9);
  });
});

describe('deliverHeat electric', () => {
  it('posts a balanced transfer from market.utilities to the product', () => {
    const ledger = new Ledger();
    ledger.openAccount({ id: 'product-thermal', kind: 'stock', label: 'test product' });
    // seedWorld not needed: market.utilities is an external account this test
    // opens directly, exactly as `world/accounts.ts` documents it (a real
    // metered counterparty allowed to go negative).
    ledger.openAccount({ id: WORLD_ACCOUNTS.marketUtilities, kind: 'external', label: 'grid' });

    const delivery = deliverHeat({ kind: 'electric' }, 'product-thermal', 1_000);
    expect(delivery.postings).toHaveLength(1);
    for (const posting of delivery.postings) {
      ledger.post(posting);
    }
    ledger.assertBalanced('after electric heat delivery');
    expect(ledger.balance('product-thermal', ENERGY)).toBe(delivery.deliveredEnergy);
    expect(ledger.balance(WORLD_ACCOUNTS.marketUtilities, ENERGY)).toBe(-delivery.deliveredEnergy);
    expect(delivery.wasteEnergy).toBe(0n);
  });

  it('delivers no energy and posts nothing for a non-positive target', () => {
    const delivery = deliverHeat({ kind: 'electric' }, 'product-thermal', 0);
    expect(delivery.postings).toEqual([]);
    expect(delivery.deliveredEnergy).toBe(0n);
  });
});

describe('deliverHeat gas', () => {
  it('draws real methane, returns real combustion products to the atmosphere, and splits useful heat from flue loss', () => {
    const ledger = new Ledger();
    ledger.openAccount({ id: 'fuel-tank', kind: 'stock', label: 'test fuel' });
    ledger.openAccount({ id: 'product-thermal', kind: 'stock', label: 'test product' });
    ledger.openAccount({ id: 'atmosphere', kind: 'reservoir', label: 'test atmosphere' });
    ledger.openAccount({ id: WORLD_ACCOUNTS.space, kind: 'external', label: 'test flue sink' });

    // Fund the fuel tank with plenty of carbon, hydrogen and combustion energy.
    const fuelEnergyPerMicrogram = 802_300 / (12.011 + 4 * 1.008);
    ledger.post({
      process: 'test:fund-fuel',
      entries: [
        { account: 'genesis', commodity: elementCommodity('C'), delta: -1_000_000_000n },
        { account: 'fuel-tank', commodity: elementCommodity('C'), delta: 1_000_000_000n },
        { account: 'genesis', commodity: elementCommodity('H'), delta: -400_000_000n },
        { account: 'fuel-tank', commodity: elementCommodity('H'), delta: 400_000_000n },
        {
          account: 'genesis',
          commodity: ENERGY,
          delta: -BigInt(Math.round(1_400_000_000 * fuelEnergyPerMicrogram)),
        },
        {
          account: 'fuel-tank',
          commodity: ENERGY,
          delta: BigInt(Math.round(1_400_000_000 * fuelEnergyPerMicrogram)),
        },
      ],
    });

    const delivery = deliverHeat(
      { kind: 'gas', fuelAccount: 'fuel-tank', atmosphereAccount: 'atmosphere', efficiency: 0.75 },
      'product-thermal',
      10_000,
    );
    expect(delivery.postings).toHaveLength(2);
    for (const posting of delivery.postings) ledger.post(posting);
    ledger.assertBalanced('after gas heat delivery');

    expect(ledger.balance('product-thermal', ENERGY)).toBe(delivery.deliveredEnergy);
    expect(delivery.wasteEnergy).toBeGreaterThan(0n);
    // Roughly 75% useful, 25% waste, by the requested efficiency.
    const total = delivery.deliveredEnergy + delivery.wasteEnergy;
    expect(Number(delivery.deliveredEnergy) / Number(total)).toBeCloseTo(0.75, 1);
    // Real combustion products actually reached the atmosphere.
    expect(ledger.balance('atmosphere', elementCommodity('C'))).toBeGreaterThan(0n);
  });
});

describe('ovenStep', () => {
  it('delivers heat into the product while the environment is hotter than the surface', () => {
    const result = ovenStep({
      environment: HOT_ENVIRONMENT,
      geometry: GEOMETRY,
      surfaceTempC: 20,
      dtSeconds: 10,
      source: { kind: 'electric' },
      productThermalAccount: 'product-thermal',
    });
    expect(result.fluxes.totalW).toBeGreaterThan(0);
    expect(result.netEnergyJ).toBeGreaterThan(0);
    expect(result.postings.length).toBeGreaterThan(0);
  });

  it('posts heat loss out to the sink when the product runs hotter than its environment', () => {
    const result = ovenStep({
      environment: HOT_ENVIRONMENT,
      geometry: GEOMETRY,
      surfaceTempC: 260,
      dtSeconds: 10,
      source: { kind: 'electric' },
      productThermalAccount: 'product-thermal',
    });
    expect(result.fluxes.totalW).toBeLessThan(0);
    expect(result.netEnergyJ).toBeLessThan(0);
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]?.entries.some((e) => e.account === 'product-thermal' && e.delta < 0n)).toBe(true);
  });

  it('rejects a non-positive timestep', () => {
    expect(() =>
      ovenStep({
        environment: HOT_ENVIRONMENT,
        geometry: GEOMETRY,
        surfaceTempC: 20,
        dtSeconds: 0,
        source: { kind: 'electric' },
        productThermalAccount: 'product-thermal',
      }),
    ).toThrow(RangeError);
  });
});
