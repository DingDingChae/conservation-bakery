import { describe, expect, it } from 'vitest';

import { ENERGY, elementCommodity, grams, kilograms, tonnes } from '../core/commodity.js';
import type { Posting } from '../core/ledger.js';
import { Ledger } from '../core/ledger.js';
import { WORLD_ACCOUNTS, seedWorld } from './accounts.js';
import {
  combustMethane,
  condense,
  evaporate,
  photosynthesize,
  respire,
} from './exchange.js';

/** Every commodity a posting touches must sum to exactly zero across its entries —
 * this is the ledger's own invariant, checked here directly on the posting so a
 * reaction's arithmetic is provably exact even before any account exists. */
function residuals(posting: Posting): Map<string, bigint> {
  const sums = new Map<string, bigint>();
  for (const e of posting.entries) {
    sums.set(e.commodity, (sums.get(e.commodity) ?? 0n) + e.delta);
  }
  return sums;
}

function expectBalanced(posting: Posting): void {
  for (const [commodity, residual] of residuals(posting)) {
    expect(residual, `${posting.process}: ${commodity} residual`).toBe(0n);
  }
}

/** A spread of masses deliberately chosen to be awkward for stoichiometry that
 * does not divide evenly into micrograms: the smallest possible unit, small
 * primes, a large prime, and ordinary human-scale quantities. */
const AWKWARD_MASSES: readonly bigint[] = [
  1n,
  2n,
  3n,
  7n,
  13n,
  97n,
  9_973n, // prime
  1_299_827n, // prime
  999_999_999_999n, // a large, deliberately not-round quantity
  grams(1),
  grams(7),
  grams(500),
  kilograms(3),
];

describe('combustMethane', () => {
  it.each(AWKWARD_MASSES)('balances exactly for %s micrograms of methane', (methaneMass) => {
    const posting = combustMethane({
      fuelAccount: 'fuel-tank',
      energyAccount: 'burner-heat',
      methaneMass,
    });
    expectBalanced(posting);
  });

  it('releases positive energy for a positive fuel mass', () => {
    const posting = combustMethane({
      fuelAccount: 'fuel-tank',
      energyAccount: 'burner-heat',
      methaneMass: grams(16), // roughly one mole of methane
    });
    const energyEntries = posting.entries.filter((e) => e.commodity === ENERGY && e.delta > 0n);
    expect(energyEntries).toHaveLength(1);
    // ~802.3 kJ/mol, one mole of methane is ~16 g: expect the right order of magnitude.
    expect(energyEntries[0]?.delta ?? 0n).toBeGreaterThan(700_000_000_000n);
    expect(energyEntries[0]?.delta ?? 0n).toBeLessThan(900_000_000_000n);
  });
});

describe('respire', () => {
  it.each(AWKWARD_MASSES)('balances exactly for %s micrograms of glucose', (glucoseMass) => {
    const posting = respire({
      biomassAccount: 'biomass',
      heatAccount: 'metabolic-heat',
      glucoseMass,
    });
    expectBalanced(posting);
  });
});

describe('photosynthesize', () => {
  it.each(AWKWARD_MASSES)('balances exactly for %s micrograms of glucose', (glucoseMass) => {
    const posting = photosynthesize({
      biomassAccount: 'biomass',
      glucoseMass,
    });
    expectBalanced(posting);
  });

  it('is the exact mirror of respire: same masses, opposite direction', () => {
    const glucoseMass = grams(180); // roughly one mole of glucose
    const made = photosynthesize({ biomassAccount: 'biomass', glucoseMass });
    const burned = respire({ biomassAccount: 'biomass', heatAccount: 'metabolic-heat', glucoseMass });

    // Net per (account, commodity), since a single posting may legitimately
    // touch the same account and commodity more than once (a draw and a
    // return within the same reaction).
    const netByKey = (posting: Posting): Map<string, bigint> => {
      const nets = new Map<string, bigint>();
      for (const e of posting.entries) {
        const key = `${e.account}:${e.commodity}`;
        nets.set(key, (nets.get(key) ?? 0n) + e.delta);
      }
      return nets;
    };

    const madeNets = netByKey(made);
    const burnedNets = netByKey(burned);
    for (const account of [WORLD_ACCOUNTS.atmosphere, 'biomass']) {
      for (const commodity of ['el:C', 'el:H', 'el:O', ENERGY]) {
        const key = `${account}:${commodity}`;
        expect(madeNets.get(key) ?? 0n, key).toBe(-(burnedNets.get(key) ?? 0n));
      }
    }
  });
});

describe('evaporate and condense', () => {
  it.each(AWKWARD_MASSES)('evaporate balances exactly for %s micrograms of water', (waterMass) => {
    expectBalanced(evaporate({ waterAccount: 'groundwater', waterMass }));
  });

  it.each(AWKWARD_MASSES)('condense balances exactly for %s micrograms of water', (waterMass) => {
    expectBalanced(condense({ waterAccount: 'groundwater', waterMass }));
  });

  it('splits water into hydrogen and oxygen in real molar-mass ratio', () => {
    const posting = evaporate({ waterAccount: 'groundwater', waterMass: grams(18) }); // ~1 mole
    const massH = posting.entries.find((e) => e.account === 'groundwater' && e.commodity === 'el:H')?.delta;
    const massO = posting.entries.find((e) => e.account === 'groundwater' && e.commodity === 'el:O')?.delta;
    expect(massH).toBeDefined();
    expect(massO).toBeDefined();
    // H2O is ~11.19% hydrogen, ~88.81% oxygen by mass.
    const ratio = Number(-(massH ?? 0n)) / Number(-(massO ?? 0n));
    expect(ratio).toBeCloseTo(2.016 / 15.999, 3);
  });
});

describe('a fully seeded world under sustained mixed exchange', () => {
  it('stays exactly balanced through 1000 ticks of combustion, respiration, photosynthesis, evaporation and condensation', () => {
    const ledger = new Ledger();

    // Equipment and biology accounts, outside the fixed world set, funded once
    // from genesis before the ledger seals — exactly like any other stock.
    ledger.openAccount({ id: 'fuel-tank', kind: 'stock', label: 'test fuel tank' });
    ledger.openAccount({ id: 'burner-heat', kind: 'stock', label: 'test burner' });
    ledger.openAccount({ id: 'biomass', kind: 'stock', label: 'test biomass' });
    ledger.openAccount({ id: 'metabolic-heat', kind: 'stock', label: 'test metabolism' });

    const fuelMass = tonnes(1);
    const fuelEnergyPerMicrogram = 802_300 / (12.011 + 4 * 1.008);
    ledger.post({
      process: 'test:fund-fuel-tank',
      entries: [
        { account: 'genesis', commodity: elementCommodity('C'), delta: -(fuelMass / 5n) },
        { account: 'fuel-tank', commodity: elementCommodity('C'), delta: fuelMass / 5n },
        { account: 'genesis', commodity: elementCommodity('H'), delta: -(fuelMass - fuelMass / 5n) },
        { account: 'fuel-tank', commodity: elementCommodity('H'), delta: fuelMass - fuelMass / 5n },
        {
          account: 'genesis',
          commodity: ENERGY,
          delta: -BigInt(Math.round(Number(fuelMass) * fuelEnergyPerMicrogram)),
        },
        {
          account: 'fuel-tank',
          commodity: ENERGY,
          delta: BigInt(Math.round(Number(fuelMass) * fuelEnergyPerMicrogram)),
        },
      ],
    });

    const glucoseMass = tonnes(1);
    const glucoseEnergyPerMicrogram = 2_803_000 / (6 * 12.011 + 12 * 1.008 + 6 * 15.999);
    ledger.post({
      process: 'test:fund-biomass',
      entries: [
        { account: 'genesis', commodity: elementCommodity('C'), delta: -(glucoseMass * 4n) / 10n },
        { account: 'biomass', commodity: elementCommodity('C'), delta: (glucoseMass * 4n) / 10n },
        { account: 'genesis', commodity: elementCommodity('H'), delta: -(glucoseMass * 1n) / 10n },
        { account: 'biomass', commodity: elementCommodity('H'), delta: (glucoseMass * 1n) / 10n },
        {
          account: 'genesis',
          commodity: elementCommodity('O'),
          delta: -(glucoseMass - (glucoseMass * 4n) / 10n - (glucoseMass * 1n) / 10n),
        },
        {
          account: 'biomass',
          commodity: elementCommodity('O'),
          delta: glucoseMass - (glucoseMass * 4n) / 10n - (glucoseMass * 1n) / 10n,
        },
        {
          account: 'genesis',
          commodity: ENERGY,
          delta: -BigInt(Math.round(Number(glucoseMass) * glucoseEnergyPerMicrogram)),
        },
        {
          account: 'biomass',
          commodity: ENERGY,
          delta: BigInt(Math.round(Number(glucoseMass) * glucoseEnergyPerMicrogram)),
        },
      ],
    });

    seedWorld(ledger, { fields: ['test-field'] });
    expect(ledger.sealed).toBe(true);

    // A small deterministic linear congruential generator: reproducible across
    // runs and platforms, unlike Math.random, which matters for a test that
    // claims a specific tick count stays balanced.
    let state = 0x2545f4914f6cdd1dn;
    const next = (): bigint => {
      state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
      return state;
    };

    for (let tick = 0; tick < 1000; tick += 1) {
      ledger.setTick(tick);
      const pick = Number(next() % 5n);
      const mass = grams(1) + (next() % grams(50));

      switch (pick) {
        case 0:
          ledger.post(combustMethane({ fuelAccount: 'fuel-tank', energyAccount: 'burner-heat', methaneMass: mass }));
          break;
        case 1:
          ledger.post(respire({ biomassAccount: 'biomass', heatAccount: 'metabolic-heat', glucoseMass: mass }));
          break;
        case 2:
          ledger.post(photosynthesize({ biomassAccount: 'biomass', glucoseMass: mass }));
          break;
        case 3:
          ledger.post(evaporate({ waterAccount: WORLD_ACCOUNTS.groundwater, waterMass: mass }));
          break;
        default:
          ledger.post(condense({ waterAccount: WORLD_ACCOUNTS.groundwater, waterMass: mass }));
          break;
      }

      // Re-derive the invariant from scratch every tick, not just at the end —
      // a leak that self-cancels by tick 1000 would still be a leak.
      ledger.assertBalanced(`tick ${tick}`);
    }

    const report = ledger.audit();
    expect(report.ok).toBe(true);
    expect(report.discrepancies).toEqual([]);
  });
});
