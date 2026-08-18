/**
 * Small shared helpers used by every chain in this directory: splitting an
 * account's exact holdings by a fixed mass ratio, moving one account's whole
 * balance to another, and safely respiring a bounded, real fraction of an
 * account's own stored organic matter. None of these touch a `Ledger` beyond
 * `post`ing an already-balanced posting — every one of them either builds or
 * applies a posting whose entries are guaranteed to sum to zero by
 * construction (CONTRACT.md rule 1).
 */

import type { CommodityId, Element, Micrograms } from '../core/commodity.js';
import { ENERGY, elementCommodity, partition } from '../core/commodity.js';
import type { AccountId, Entry, Ledger, Posting } from '../core/ledger.js';
import { respire } from '../world/exchange.js';
import { GLUCOSE_C_MASS_FRACTION, GLUCOSE_ENERGY_PER_UG, GLUCOSE_H_MASS_FRACTION } from './constants.js';

function isElementCommodity(commodity: CommodityId): commodity is `el:${Element}` {
  return commodity.startsWith('el:');
}

export function floorMicrograms(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value));
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** The exact elemental composition an account currently holds, read straight
 * off the ledger — the same technique `scenario/firstChain.ts`'s own
 * `accountComposition` uses. */
export function accountComposition(ledger: Ledger, account: AccountId): Map<Element, Micrograms> {
  const out = new Map<Element, Micrograms>();
  for (const [commodity, amount] of ledger.balances(account)) {
    if (amount === 0n || !isElementCommodity(commodity)) continue;
    out.set(commodity.slice(3) as Element, amount);
  }
  return out;
}

export interface FixedRatioStream {
  readonly account: AccountId;
  /** Relative share among the streams passed to one call — only the ratio
   * between streams matters, exactly like `plant/unit.ts`'s `StreamProfile`. */
  readonly weight: bigint;
}

export interface FixedRatioSplitResult {
  readonly posting: Posting;
  /** Elemental (not energy) mass credited to each stream, in the same order
   * as `streams`. */
  readonly massUg: readonly Micrograms[];
}

/**
 * Split every commodity `fromAccount` currently holds — every tracked element
 * and any stored chemical energy — across `streams` in a single fixed mass
 * ratio, using `partition()` so each commodity's shares always sum back to
 * exactly what `fromAccount` held. This is `agri/harvest.ts`'s
 * `splitStandingBiomass` technique, generalised from "one crop's own
 * `harvestIndex`" to any fixed ratio and any number of streams — used where a
 * step's real yield is a fixed mass fraction (a pod opened into bean and husk,
 * a cherry depulped into bean and pulp) rather than a composition-driven split
 * (for which see `plant/unit.ts`'s `splitByProfile`).
 */
export function splitByFixedRatio(
  ledger: Ledger,
  fromAccount: AccountId,
  streams: readonly FixedRatioStream[],
  process: string,
): FixedRatioSplitResult {
  const balances = ledger.balances(fromAccount);
  const weights = streams.map((s) => s.weight);
  const entries: Entry[] = [];
  const massUg = streams.map(() => 0n as Micrograms);

  for (const [commodity, amount] of balances) {
    if (amount === 0n) continue;
    const shares = partition(amount, weights);
    entries.push({ account: fromAccount, commodity, delta: -amount });
    shares.forEach((share, index) => {
      if (share === 0n) return;
      const stream = streams[index];
      if (!stream) return;
      entries.push({ account: stream.account, commodity, delta: share });
      if (isElementCommodity(commodity)) massUg[index] = (massUg[index] ?? 0n) + share;
    });
  }

  return { posting: { process, entries }, massUg };
}

/** Move every commodity `fromAccount` holds — elements and energy alike — to
 * `toAccount` in one balanced posting. Used for a pure relabelling/phase-change
 * step (grinding nib to liquor, melting, a straight hand-off between accounts)
 * that changes no mass at all. */
export function transferAccount(ledger: Ledger, fromAccount: AccountId, toAccount: AccountId, process: string): Posting | undefined {
  const entries: Entry[] = [];
  for (const [commodity, amount] of ledger.balances(fromAccount)) {
    if (amount === 0n) continue;
    entries.push({ account: fromAccount, commodity, delta: -amount });
    entries.push({ account: toAccount, commodity, delta: amount });
  }
  if (entries.length === 0) return undefined;
  return ledger.post({ process, entries });
}

export interface RespireClampedResult {
  readonly posting: Posting;
  /** The glucose-equivalent mass actually respired — may be less than
   * requested if the account did not hold enough stored carbon, hydrogen or
   * chemical energy to support it. */
  readonly glucoseMassUg: Micrograms;
}

/**
 * Respire a real, bounded fraction of `account`'s own stored organic matter —
 * `world/exchange.ts`'s `respire`, clamped first to what the account can
 * actually support (its own carbon, hydrogen and stored chemical energy,
 * mirroring `agri/livestock.ts`'s own clamping technique for exactly this
 * reason), so a caller sizing a "respire roughly X%" fermentation or
 * propagation step never has to worry about a `NegativeStockError` at the
 * extremes of a wide input range. Returns `undefined` if nothing could be
 * respired at all.
 */
export function respireClamped(
  ledger: Ledger,
  account: AccountId,
  heatAccount: AccountId,
  atmosphereAccount: AccountId,
  targetGlucoseUg: Micrograms,
  process?: string,
): RespireClampedResult | undefined {
  if (targetGlucoseUg <= 0n) return undefined;
  const availableC = ledger.balance(account, elementCommodity('C'));
  const availableH = ledger.balance(account, elementCommodity('H'));
  const availableEnergy = ledger.balance(account, ENERGY);

  const ceilingC = floorMicrograms(Number(availableC) / GLUCOSE_C_MASS_FRACTION);
  const ceilingH = floorMicrograms(Number(availableH) / GLUCOSE_H_MASS_FRACTION);
  const ceilingEnergy = floorMicrograms(Number(availableEnergy) / GLUCOSE_ENERGY_PER_UG);

  const glucoseMassUg = minBig(minBig(minBig(targetGlucoseUg, ceilingC), ceilingH), ceilingEnergy);
  if (glucoseMassUg <= 0n) return undefined;

  const posting = respire({
    biomassAccount: account,
    atmosphereAccount,
    heatAccount,
    glucoseMass: glucoseMassUg,
    process: process ?? 'origin:respire',
  });
  ledger.post(posting);
  return { posting, glucoseMassUg };
}
