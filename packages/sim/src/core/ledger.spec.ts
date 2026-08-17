/**
 * Exactness and conservation tests for ledger.ts.
 *
 * The headline test in this file — "conservation holds under 100000 random
 * postings" — is the closest thing this repository has to a proof of CONTRACT.md
 * rule 1: that a running ledger, subjected to a large number of arbitrary balanced
 * postings, never drifts away from Σ balance === 0 for any commodity.
 */

import { describe, expect, it } from 'vitest';
import type { CommodityId } from './commodity.js';
import {
  GENESIS,
  Ledger,
  NegativeStockError,
  SealedLedgerError,
  UnbalancedPostingError,
  UnknownAccountError,
  type AppliedPosting,
  type Posting,
} from './ledger.js';

/**
 * A tiny deterministic PRNG (mulberry32), duplicated from commodity.spec.ts rather
 * than imported: each spec file should be independently reproducible without
 * relying on shared test-only infrastructure, and the generator is a few lines.
 * Do NOT use Math.random — the suite must be reproducible.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng: () => number, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

const CASH: CommodityId = 'cash:GBP';
const CARBON: CommodityId = 'el:C';
const ENERGY: CommodityId = 'energy:uJ';

function freshLedger(onPosting?: (p: AppliedPosting) => void): Ledger {
  const ledger = new Ledger(onPosting ? { onPosting } : {});
  ledger.openAccount({ id: 'stock.warehouse', kind: 'stock', label: 'Warehouse' });
  ledger.openAccount({ id: 'reservoir.atmosphere', kind: 'reservoir', label: 'Atmosphere' });
  ledger.openAccount({ id: 'market.suppliers', kind: 'external', label: 'Suppliers' });
  return ledger;
}

describe('Ledger.post — balance validation', () => {
  it('rejects an unbalanced posting with UnbalancedPostingError naming the commodity and residual', () => {
    const ledger = freshLedger();
    const posting: Posting = {
      process: 'test.unbalanced',
      entries: [{ account: 'stock.warehouse', commodity: CARBON, delta: 5n }],
    };
    let caught: unknown;
    try {
      ledger.post(posting);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnbalancedPostingError);
    const err = caught as UnbalancedPostingError;
    expect(err.commodity).toBe(CARBON);
    expect(err.residual).toBe(5n);
    expect(err.posting).toBe(posting);
  });

  it('rejects an unbalanced posting even when other commodities in the same posting do balance', () => {
    const ledger = freshLedger();
    const posting: Posting = {
      process: 'test.partial-balance',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 10n },
        { account: 'market.suppliers', commodity: CARBON, delta: -10n },
        { account: 'stock.warehouse', commodity: ENERGY, delta: 3n },
        // Energy left unbalanced.
      ],
    };
    expect(() => ledger.post(posting)).toThrow(UnbalancedPostingError);
    try {
      ledger.post(posting);
    } catch (error) {
      expect((error as UnbalancedPostingError).commodity).toBe(ENERGY);
      expect((error as UnbalancedPostingError).residual).toBe(3n);
    }
  });

  it('mutates nothing when a posting is rejected for imbalance', () => {
    const ledger = freshLedger();
    ledger.post({
      process: 'setup',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 100n },
        { account: 'market.suppliers', commodity: CARBON, delta: -100n },
      ],
    });
    const before = ledger.balance('stock.warehouse', CARBON);
    const countBefore = ledger.postingCount;

    expect(() =>
      ledger.post({
        process: 'test.bad',
        entries: [{ account: 'stock.warehouse', commodity: CARBON, delta: 999n }],
      }),
    ).toThrow(UnbalancedPostingError);

    expect(ledger.balance('stock.warehouse', CARBON)).toBe(before);
    expect(ledger.postingCount).toBe(countBefore);
    expect(ledger.audit().ok).toBe(true);
  });

  it('rejects a posting referencing an unknown account, and mutates nothing', () => {
    const ledger = freshLedger();
    const before = ledger.balance('stock.warehouse', CARBON);
    expect(() =>
      ledger.post({
        process: 'test.unknown-account',
        entries: [
          { account: 'stock.nonexistent', commodity: CARBON, delta: 10n },
          { account: 'market.suppliers', commodity: CARBON, delta: -10n },
        ],
      }),
    ).toThrow(UnknownAccountError);
    expect(ledger.balance('stock.warehouse', CARBON)).toBe(before);
  });
});

describe('Ledger.post — negative stock validation', () => {
  it('rejects a posting that would drive a stock account negative', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.post({
        process: 'test.overdraw-stock',
        entries: [
          { account: 'stock.warehouse', commodity: CARBON, delta: -5n },
          { account: 'market.suppliers', commodity: CARBON, delta: 5n },
        ],
      }),
    ).toThrow(NegativeStockError);
  });

  it('rejects a posting that would drive a reservoir account negative', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.post({
        process: 'test.overdraw-reservoir',
        entries: [
          { account: 'reservoir.atmosphere', commodity: CARBON, delta: -5n },
          { account: 'market.suppliers', commodity: CARBON, delta: 5n },
        ],
      }),
    ).toThrow(NegativeStockError);
  });

  it('allows an external account to go negative', () => {
    const ledger = freshLedger();
    ledger.post({
      process: 'test.supply',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 5n },
        { account: 'market.suppliers', commodity: CARBON, delta: -5n },
      ],
    });
    expect(ledger.balance('market.suppliers', CARBON)).toBe(-5n);
  });

  it('allows genesis (an external account) to go negative during setup', () => {
    const ledger = freshLedger();
    ledger.post({
      process: 'genesis.seed',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 1000n },
        { account: GENESIS, commodity: CARBON, delta: -1000n },
      ],
    });
    expect(ledger.balance(GENESIS, CARBON)).toBe(-1000n);
  });

  it('judges a posting that draws and returns to the same account by its net effect', () => {
    const ledger = freshLedger();
    ledger.post({
      process: 'setup',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 10n },
        { account: 'market.suppliers', commodity: CARBON, delta: -10n },
      ],
    });
    // Draws 10 and returns 10 to the same account in one posting: net zero, so
    // it must succeed even though an intermediate reading would be negative.
    expect(() =>
      ledger.post({
        process: 'test.net-zero-same-account',
        entries: [
          { account: 'stock.warehouse', commodity: CARBON, delta: -10n },
          { account: 'stock.warehouse', commodity: CARBON, delta: 10n },
        ],
      }),
    ).not.toThrow();
    expect(ledger.balance('stock.warehouse', CARBON)).toBe(10n);
  });

  it('allows a same-account posting whose net effect is a permitted decrease', () => {
    const ledger = freshLedger();
    ledger.post({
      process: 'setup',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 10n },
        { account: 'market.suppliers', commodity: CARBON, delta: -10n },
      ],
    });
    // Net effect on stock.warehouse is -10 (draw 20, return 10): allowed since
    // the resulting balance (0) is not negative.
    ledger.post({
      process: 'test.net-negative-same-account',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: -20n },
        { account: 'stock.warehouse', commodity: CARBON, delta: 10n },
        { account: 'market.suppliers', commodity: CARBON, delta: 10n },
      ],
    });
    expect(ledger.balance('stock.warehouse', CARBON)).toBe(0n);
  });

  it('rejects a same-account posting whose net effect would be negative', () => {
    const ledger = freshLedger();
    ledger.post({
      process: 'setup',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 10n },
        { account: 'market.suppliers', commodity: CARBON, delta: -10n },
      ],
    });
    expect(() =>
      ledger.post({
        process: 'test.net-negative-rejected',
        entries: [
          { account: 'stock.warehouse', commodity: CARBON, delta: -30n },
          { account: 'stock.warehouse', commodity: CARBON, delta: 10n },
          { account: 'market.suppliers', commodity: CARBON, delta: 20n },
        ],
      }),
    ).toThrow(NegativeStockError);
  });
});

describe('Ledger — genesis and sealing', () => {
  it('allows draws on genesis before sealing', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.post({
        process: 'genesis.seed',
        entries: [
          { account: 'stock.warehouse', commodity: CARBON, delta: 50n },
          { account: GENESIS, commodity: CARBON, delta: -50n },
        ],
      }),
    ).not.toThrow();
  });

  it('blocks further genesis draws after seal()', () => {
    const ledger = freshLedger();
    ledger.seal();
    expect(() =>
      ledger.post({
        process: 'genesis.late',
        entries: [
          { account: 'stock.warehouse', commodity: CARBON, delta: 50n },
          { account: GENESIS, commodity: CARBON, delta: -50n },
        ],
      }),
    ).toThrow(SealedLedgerError);
  });

  it('still allows ordinary postings not touching genesis after seal()', () => {
    const ledger = freshLedger();
    ledger.seal();
    expect(() =>
      ledger.post({
        process: 'test.post-seal',
        entries: [
          { account: 'stock.warehouse', commodity: CARBON, delta: 5n },
          { account: 'market.suppliers', commodity: CARBON, delta: -5n },
        ],
      }),
    ).not.toThrow();
  });
});

describe('Ledger — onPosting callback', () => {
  it('fires exactly once per applied posting, with the correct seq and tick', () => {
    const applied: AppliedPosting[] = [];
    const ledger = freshLedger((p) => applied.push(p));
    ledger.setTick(7);
    ledger.post({
      process: 'test.first',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 1n },
        { account: 'market.suppliers', commodity: CARBON, delta: -1n },
      ],
    });
    ledger.setTick(8);
    ledger.post({
      process: 'test.second',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 2n },
        { account: 'market.suppliers', commodity: CARBON, delta: -2n },
      ],
    });

    expect(applied).toHaveLength(2);
    expect(applied[0]?.seq).toBe(1);
    expect(applied[0]?.tick).toBe(7);
    expect(applied[1]?.seq).toBe(2);
    expect(applied[1]?.tick).toBe(8);
  });

  it('does not fire for a rejected posting', () => {
    const applied: AppliedPosting[] = [];
    const ledger = freshLedger((p) => applied.push(p));
    expect(() =>
      ledger.post({
        process: 'test.rejected',
        entries: [{ account: 'stock.warehouse', commodity: CARBON, delta: 3n }],
      }),
    ).toThrow(UnbalancedPostingError);
    expect(applied).toHaveLength(0);
  });
});

describe('Ledger.audit', () => {
  it('reports ok with zero discrepancies on an empty ledger', () => {
    const ledger = freshLedger();
    const report = ledger.audit();
    expect(report.ok).toBe(true);
    expect(report.discrepancies).toHaveLength(0);
  });

  it('reports ok after a balanced sequence of postings', () => {
    const ledger = freshLedger();
    ledger.post({
      process: 'genesis.seed',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 500n },
        { account: GENESIS, commodity: CARBON, delta: -500n },
      ],
    });
    ledger.post({
      process: 'test.sale',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: -200n },
        { account: 'market.suppliers', commodity: CARBON, delta: 200n },
      ],
    });
    const report = ledger.audit();
    expect(report.ok).toBe(true);
    expect(report.commoditiesChecked).toBeGreaterThan(0);
  });
});

describe('Ledger.assertBalanced', () => {
  it('does not throw when the ledger is balanced', () => {
    const ledger = freshLedger();
    ledger.post({
      process: 'genesis.seed',
      entries: [
        { account: 'stock.warehouse', commodity: CARBON, delta: 10n },
        { account: GENESIS, commodity: CARBON, delta: -10n },
      ],
    });
    expect(() => ledger.assertBalanced('test-tick')).not.toThrow();
  });
});

describe('Ledger.openAccount', () => {
  it('rejects opening the same account id twice', () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.openAccount({ id: 'stock.warehouse', kind: 'stock', label: 'Duplicate' }),
    ).toThrow();
  });

  it('reports hasAccount and accountSpec correctly', () => {
    const ledger = freshLedger();
    expect(ledger.hasAccount('stock.warehouse')).toBe(true);
    expect(ledger.hasAccount('nope')).toBe(false);
    expect(ledger.accountSpec('stock.warehouse')?.kind).toBe('stock');
    expect(ledger.accountSpec('nope')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// THE HEADLINE TEST
// ---------------------------------------------------------------------------

describe('conservation under random load', () => {
  it(
    'conservation holds after every one of 100000 random balanced postings ' +
      'across ~30 accounts, and every commodity sums to exactly 0n at the end',
    () => {
      const rng = mulberry32(0x5eed_5eed);

      const ledger = new Ledger();

      const accountIds: string[] = [GENESIS];
      const stockCount = 20;
      const reservoirCount = 5;
      const externalCount = 4;

      for (let i = 0; i < stockCount; i += 1) {
        const id = `stock.${i}`;
        ledger.openAccount({ id, kind: 'stock', label: `Stock ${i}` });
        accountIds.push(id);
      }
      for (let i = 0; i < reservoirCount; i += 1) {
        const id = `reservoir.${i}`;
        ledger.openAccount({ id, kind: 'reservoir', label: `Reservoir ${i}` });
        accountIds.push(id);
      }
      for (let i = 0; i < externalCount; i += 1) {
        const id = `external.${i}`;
        ledger.openAccount({ id, kind: 'external', label: `External ${i}` });
        accountIds.push(id);
      }
      // GENESIS + 20 + 5 + 4 = 30 accounts.
      expect(accountIds).toHaveLength(30);

      const commodities: CommodityId[] = [CARBON, 'el:H', 'el:O', ENERGY, CASH];

      // Seed every stock and reservoir account generously via genesis so that
      // later random draws have material to work with without every posting
      // needing a bespoke sufficiency check.
      for (const account of accountIds) {
        const spec = ledger.accountSpec(account);
        if (!spec || spec.kind === 'external') continue;
        for (const commodity of commodities) {
          const amount = 10_000_000n;
          ledger.post({
            process: 'seed',
            entries: [
              { account, commodity, delta: amount },
              { account: GENESIS, commodity, delta: -amount },
            ],
          });
        }
      }
      ledger.seal();

      const postings = 100_000;
      let successes = 0;
      let attempts = 0;

      while (successes < postings) {
        attempts += 1;
        const commodity = commodities[randomInt(rng, commodities.length)]!;

        // Pick two or three distinct non-genesis accounts, since genesis is
        // sealed and every candidate account can legally send or receive.
        const nonGenesis = accountIds.slice(1);
        const legCount = 2 + (rng() < 0.3 ? 1 : 0);
        const legs = new Set<string>();
        while (legs.size < legCount) {
          legs.add(nonGenesis[randomInt(rng, nonGenesis.length)]!);
        }
        const legAccounts = [...legs];

        // Build random deltas for all but the last leg, then force the last
        // leg to be the exact negation of the sum so the posting balances by
        // construction (this is the only sanctioned way to guarantee balance
        // for a synthetic test posting — real code derives it the same way).
        const entries: { account: string; commodity: CommodityId; delta: bigint }[] = [];
        let runningSum = 0n;
        for (let i = 0; i < legAccounts.length - 1; i += 1) {
          const magnitude = BigInt(1 + randomInt(rng, 500));
          const delta = rng() < 0.5 ? magnitude : -magnitude;
          entries.push({ account: legAccounts[i]!, commodity, delta });
          runningSum += delta;
        }
        entries.push({
          account: legAccounts[legAccounts.length - 1]!,
          commodity,
          delta: -runningSum,
        });

        try {
          ledger.post({ process: 'test.random-load', entries });
          successes += 1;
        } catch (error) {
          // A NegativeStockError here is an expected, ordinary outcome — the
          // random draw exceeded what a stock/reservoir account holds. Retry
          // with a new random posting rather than failing the test.
          if (!(error instanceof NegativeStockError)) throw error;
        }

        // Guard against a pathological run where random postings can never
        // succeed (should not happen given the generous seeding above).
        if (attempts > postings * 20) {
          throw new Error(
            `too many rejected postings: ${attempts} attempts for ${successes} successes`,
          );
        }

        // Audit after every single applied posting, as required.
        const report = ledger.audit();
        expect(report.ok).toBe(true);
      }

      expect(successes).toBe(postings);

      const finalReport = ledger.audit();
      expect(finalReport.ok).toBe(true);
      for (const discrepancy of finalReport.discrepancies) {
        expect(discrepancy.residual).toBe(0n);
      }
      for (const commodity of commodities) {
        let total = 0n;
        for (const account of accountIds) {
          total += ledger.balance(account, commodity);
        }
        expect(total).toBe(0n);
      }
    },
  );
});
