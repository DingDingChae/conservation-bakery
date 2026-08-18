import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { grams } from '../core/commodity.js';
import { seedWorld } from '../world/accounts.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';
import { extractBeetColour, makeCaramelColour } from './colour.js';

function setUp() {
  const ledger = new Ledger();
  seedWorld(ledger, { fields: [] });
  return { ledger, registry: defaultSubstanceRegistry() };
}

describe('food colour', () => {
  it('extracts real beet red colour from sugar beet, exactly', () => {
    const { ledger, registry } = setUp();
    const result = extractBeetColour(ledger, registry, grams(1_000), 'test.beet-colour', 'test.beet-residue');
    expect(result.colourMassUg).toBeGreaterThan(0n);
    expect(result.colourMassUg + result.residueMassUg).toBe(result.beetMassUg);
    expect(ledger.audit().ok).toBe(true);
  });

  it('makes real caramel colour from heated sucrose, exactly', () => {
    const { ledger } = setUp();
    const result = makeCaramelColour(ledger, grams(500), 'test.caramel-colour');
    expect(result.caramelMassUg).toBeGreaterThan(0n);
    expect(result.caramelMassUg + result.waterLossUg).toBe(result.sucroseMassUg);
    expect(ledger.audit().ok).toBe(true);
  });
});
