/**
 * The headline test for this module: record a run, replay it into a fresh world,
 * and assert the two are byte-for-byte identical by digest. This exercises the
 * whole determinism layer together — Rng, Clock, Journal and digest — against a
 * small but real ledger-backed "world" built on the already-reviewed core Ledger,
 * rather than against a toy in-memory counter.
 */

import { describe, expect, it, vi } from 'vitest';
import { GENESIS, Ledger } from '../core/ledger.js';
import { elementCommodity, grams, type ElementCommodity } from '../core/commodity.js';
import { Clock, type TickContext } from './clock.js';
import { digest, type Digestible } from './digest.js';
import { Journal, type Command } from './journal.js';
import { Rng, type RngState } from './rng.js';

const CARBON: ElementCommodity = elementCommodity('C');
const STOCK_ACCOUNTS = ['stockA', 'stockB', 'stockC'] as const;
type StockAccount = (typeof STOCK_ACCOUNTS)[number];
const WASTE = 'waste';

interface WastePayload {
  readonly from: StockAccount;
  /** Decimal micrograms, as a JSON-safe string — see journal.ts on why not bigint. */
  readonly amount: string;
}
type WasteCommand = Command<'waste', WastePayload>;

interface World {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly rng: Rng;
}

function buildWorld(seed: number, startInstantMs: number): World {
  const ledger = new Ledger();
  for (const account of STOCK_ACCOUNTS) {
    ledger.openAccount({ id: account, kind: 'stock', label: account });
  }
  ledger.openAccount({ id: WASTE, kind: 'stock', label: 'waste' });

  return { ledger, clock: new Clock(startInstantMs), rng: Rng.fromSeed(seed) };
}

/** Wire up the two systems that make this world's tick actually do something. */
function registerSystems(world: World, journal: Journal<WasteCommand>): void {
  world.clock.register({
    name: 'delivery',
    order: 0,
    run: (ctx: TickContext) => {
      // A sourced, ledgered delivery every tick: material moves from the outside
      // world (genesis) into a randomly chosen stock account. Never a spawn.
      const target = STOCK_ACCOUNTS[world.rng.nextInt(STOCK_ACCOUNTS.length)] as StockAccount;
      const amount = grams(world.rng.nextInt(1000));
      world.ledger.setTick(ctx.tick);
      world.ledger.post({
        process: 'delivery',
        entries: [
          { account: GENESIS, commodity: CARBON, delta: -amount },
          { account: target, commodity: CARBON, delta: amount },
        ],
      });
    },
  });

  world.clock.register({
    name: 'commands',
    order: 1,
    run: (ctx: TickContext) => {
      for (const command of journal.at(ctx.tick)) {
        const requested = BigInt(command.payload.amount);
        const available = world.ledger.balance(command.payload.from, CARBON);
        const amount = requested < available ? requested : available;
        if (amount <= 0n) continue;
        world.ledger.post({
          process: 'waste',
          entries: [
            { account: command.payload.from, commodity: CARBON, delta: -amount },
            { account: WASTE, commodity: CARBON, delta: amount },
          ],
        });
      }
    },
  });
}

/**
 * Build the command log for a run. Uses its own throwaway RNG stream, forked off a
 * (separately constructed, never reused) generator for the same seed — entirely
 * independent of `world.rng`, which is created fresh in `buildWorld` and is the
 * only generator the tick systems ever draw from.
 */
function buildJournal(seed: number, startInstantMs: number, totalTicks: number): Journal<WasteCommand> {
  const journal = new Journal<WasteCommand>({ seed, startInstantMs });
  const scriptRng = Rng.fromSeed(seed).fork();

  for (let tick = 1; tick <= totalTicks; tick += 1) {
    if (scriptRng.nextInt(7) !== 0) continue; // roughly one command every 7 ticks
    const from = STOCK_ACCOUNTS[scriptRng.nextInt(STOCK_ACCOUNTS.length)] as StockAccount;
    const amount = grams(scriptRng.nextInt(500));
    journal.append({ type: 'waste', tick, payload: { from, amount: amount.toString() } });
  }

  return journal;
}

function runToTick(
  world: World,
  journal: Journal<WasteCommand>,
  targetTick: number,
  chunk: number,
): void {
  registerSystems(world, journal);
  let remaining = targetTick - world.clock.tick;
  while (remaining > 0) {
    const step = Math.min(chunk, remaining);
    world.clock.advance(step);
    remaining -= step;
  }
}

function rngStateToDigestible(state: RngState): Digestible {
  return { s0: state.s0, s1: state.s1, s2: state.s2, s3: state.s3 };
}

function worldDigest(world: World): string {
  const balances: { [account: string]: Digestible } = {};
  for (const account of [...STOCK_ACCOUNTS, WASTE, GENESIS]) {
    balances[account] = world.ledger.balance(account, CARBON);
  }
  const state: Digestible = {
    tick: world.clock.tick,
    balances,
    rng: rngStateToDigestible(world.rng.getState()),
  };
  return digest(state);
}

describe('headline: deterministic replay', () => {
  const seed = 0xc0ffee;
  const startInstantMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  const totalTicks = 5000;

  it('replaying the same (seed, startInstant, commands) into a fresh world reproduces the digest', () => {
    const journal = buildJournal(seed, startInstantMs, totalTicks);
    expect(journal.commands.length).toBeGreaterThan(0);

    const original = buildWorld(journal.seed, journal.startInstantMs);
    runToTick(original, journal, totalTicks, 37);
    expect(original.clock.tick).toBe(totalTicks);
    expect(original.ledger.audit().ok).toBe(true);
    const originalDigest = worldDigest(original);

    // Round-trip the journal through JSON exactly as a saved run would be loaded,
    // then replay it into a brand new world with a different chunking of ticks.
    const restoredJournal = Journal.deserialize<WasteCommand>(journal.serialize());
    const replay = buildWorld(restoredJournal.seed, restoredJournal.startInstantMs);
    runToTick(replay, restoredJournal, totalTicks, 11);
    expect(replay.ledger.audit().ok).toBe(true);

    expect(worldDigest(replay)).toBe(originalDigest);
  });

  it('advancing at 1x and at 60x reaches an identical digest', () => {
    const journal = buildJournal(seed, startInstantMs, totalTicks);

    const speed1 = buildWorld(journal.seed, journal.startInstantMs);
    runToTick(speed1, journal, totalTicks, 1);

    const speed60 = buildWorld(journal.seed, journal.startInstantMs);
    runToTick(speed60, journal, totalTicks, 60);

    expect(speed60.clock.tick).toBe(speed1.clock.tick);
    expect(worldDigest(speed60)).toBe(worldDigest(speed1));
  });

  it('exercises a large, non-degenerate number of postings', () => {
    const journal = buildJournal(seed, startInstantMs, totalTicks);
    const world = buildWorld(journal.seed, journal.startInstantMs);

    // An independent tally of posting calls, taken at the call site rather than read
    // back from the ledger, so the two counts below are not the same measurement
    // asked twice: this one would still be correct even if Ledger.postingCount were
    // broken, and vice versa.
    const postSpy = vi.spyOn(world.ledger, 'post');
    runToTick(world, journal, totalTicks, 60);

    // One delivery posting per tick, plus at least one waste posting from the
    // journal's commands. If the commands system stopped posting altogether, this
    // would collapse to exactly totalTicks and fail.
    expect(postSpy.mock.calls.length).toBeGreaterThan(totalTicks);

    // The ledger's reported posting count must match the number of posts actually
    // made, confirmed against the independent tally above.
    expect(world.ledger.postingCount).toBe(postSpy.mock.calls.length);
  });
});
