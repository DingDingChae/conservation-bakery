import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { elementCommodity } from '../core/commodity.js';
import { seedWorld, WORLD_ACCOUNTS } from '../world/accounts.js';
import { originReservoirAccount, REGIONS, seedCropRegion, seedMineralRegion } from './region.js';
import { departShipment, receiveShipment, shippingDelayTicks, ShipmentNotYetArrivedError } from './shipping.js';

describe('origin regions', () => {
  it('every region has a real, positive shipping time and area', () => {
    for (const region of Object.values(REGIONS)) {
      expect(region.shippingDays).toBeGreaterThan(0);
      expect(region.areaM2).toBeGreaterThan(0n);
      if (region.kind === 'crop') {
        expect(region.climate).toBeDefined();
        expect(region.climate!.peakInsolationWPerM2).toBeGreaterThan(0);
      }
    }
  });

  it('seeds a crop region soil reservoir from genesis, exactly, before sealing', () => {
    const ledger = new Ledger();
    seedCropRegion(ledger, REGIONS.cocoaBelt!);
    seedWorld(ledger, { fields: [] });

    const soilCarbon = ledger.balance(originReservoirAccount(REGIONS.cocoaBelt!), elementCommodity('C'));
    expect(soilCarbon).toBeGreaterThan(0n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('seeds a mineral region deposit from genesis, exactly, before sealing', () => {
    const ledger = new Ledger();
    seedMineralRegion(ledger, REGIONS.phosphateBelt!, { Ca: 0.3, P: 0.15 });
    seedWorld(ledger, { fields: [] });

    const p = ledger.balance(originReservoirAccount(REGIONS.phosphateBelt!), elementCommodity('P'));
    expect(p).toBeGreaterThan(0n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('refuses to seed the wrong kind of region', () => {
    const ledger = new Ledger();
    expect(() => seedCropRegion(ledger, REGIONS.saltMine!)).toThrow();
    expect(() => seedMineralRegion(ledger, REGIONS.cocoaBelt!, {})).toThrow();
  });
});

describe('shipping', () => {
  function setUp() {
    const ledger = new Ledger();
    seedCropRegion(ledger, REGIONS.cocoaBelt!);
    seedWorld(ledger, { fields: [] });
    return ledger;
  }

  it('computes a real, positive delay in ticks from a region shipping days', () => {
    const region = REGIONS.cocoaBelt!;
    const ticks = shippingDelayTicks(region, 1);
    expect(ticks).toBe(region.shippingDays * 86_400);
  });

  it('moves real cargo through an in-transit account and only releases it at or after arrival', () => {
    const ledger = setUp();
    const region = REGIONS.cocoaBelt!;
    const source = 'test.source';
    const destination = 'test.destination';
    ledger.openAccount({ id: source, kind: 'stock', label: source });
    ledger.openAccount({ id: destination, kind: 'stock', label: destination });
    ledger.post({
      process: 'test:fund',
      entries: [
        { account: source, commodity: elementCommodity('C'), delta: 1_000_000n },
        { account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity('C'), delta: -1_000_000n },
      ],
    });

    const departed = departShipment({
      ledger,
      region,
      cargo: 'test-cargo',
      sourceAccount: source,
      destinationAccount: destination,
      departureTick: 0,
    });
    expect(departed).toBeDefined();
    const { shipment } = departed!;

    // The cargo is real and conserved while "at sea": it left the source...
    expect(ledger.balance(source, elementCommodity('C'))).toBe(0n);
    // ...but is not yet at the destination.
    expect(ledger.balance(destination, elementCommodity('C'))).toBe(0n);
    expect(ledger.audit().ok).toBe(true);

    // Too early: refused.
    expect(() => receiveShipment(ledger, shipment, shipment.arrivalTick - 1)).toThrow(ShipmentNotYetArrivedError);
    expect(ledger.balance(destination, elementCommodity('C'))).toBe(0n);

    // Right on time: released, exactly.
    receiveShipment(ledger, shipment, shipment.arrivalTick);
    expect(ledger.balance(destination, elementCommodity('C'))).toBe(1_000_000n);
    expect(ledger.audit().ok).toBe(true);
  });

  it('two simultaneous cargoes from the same region do not mix', () => {
    const ledger = setUp();
    const region = REGIONS.cocoaBelt!;
    for (const id of ['test.butter', 'test.powder', 'test.butter-dest', 'test.powder-dest']) {
      ledger.openAccount({ id, kind: 'stock', label: id });
    }
    ledger.post({
      process: 'test:fund',
      entries: [
        { account: 'test.butter', commodity: elementCommodity('C'), delta: 500_000n },
        { account: 'test.powder', commodity: elementCommodity('N'), delta: 200_000n },
        { account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity('C'), delta: -500_000n },
        { account: WORLD_ACCOUNTS.marketSuppliers, commodity: elementCommodity('N'), delta: -200_000n },
      ],
    });

    const butter = departShipment({ ledger, region, cargo: 'butter', sourceAccount: 'test.butter', destinationAccount: 'test.butter-dest', departureTick: 0 })!;
    const powder = departShipment({ ledger, region, cargo: 'powder', sourceAccount: 'test.powder', destinationAccount: 'test.powder-dest', departureTick: 0 })!;

    receiveShipment(ledger, butter.shipment, butter.shipment.arrivalTick);
    receiveShipment(ledger, powder.shipment, powder.shipment.arrivalTick);

    expect(ledger.balance('test.butter-dest', elementCommodity('C'))).toBe(500_000n);
    expect(ledger.balance('test.butter-dest', elementCommodity('N'))).toBe(0n);
    expect(ledger.balance('test.powder-dest', elementCommodity('N'))).toBe(200_000n);
    expect(ledger.balance('test.powder-dest', elementCommodity('C'))).toBe(0n);
    expect(ledger.audit().ok).toBe(true);
  });
});
