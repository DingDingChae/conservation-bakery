import { describe, expect, it } from 'vitest';
import { Ledger } from '../core/ledger.js';
import { grams } from '../core/commodity.js';
import { seedWorld } from '../world/accounts.js';
import { REGIONS } from './region.js';
import { renderGelatin, seedRenderingWorks } from './gelatin.js';

describe('gelatin, from rendering', () => {
  it('renders real gelatin from a hide-and-bone-stock reservoir', () => {
    const ledger = new Ledger();
    seedRenderingWorks(ledger, REGIONS.renderingWorks!);
    seedWorld(ledger, { fields: [] });

    const result = renderGelatin(ledger, REGIONS.renderingWorks!, grams(2_000), 'test.gelatin');
    expect(result.gelatinMassUg).toBeGreaterThan(0n);
    expect(ledger.balance('test.gelatin', 'el:N')).toBeGreaterThan(0n);
    expect(ledger.audit().ok).toBe(true);
  });
});
