/**
 * Nuts: almond, cracked from in-shell to kernel and shell, by composition.
 */

import type { Composition, Micrograms } from '../core/commodity.js';
import { compositionMass } from '../core/commodity.js';
import type { AccountId, Ledger } from '../core/ledger.js';
import type { Rng } from '../clock/rng.js';
import { buildProcessPosting, splitByProfile, type StreamProfile } from '../plant/unit.js';
import type { SubstanceRegistry } from '../substance/registry.js';
import { ALMOND_TREE } from './crops.js';
import { growAndHarvest } from './growth.js';
import { originResidueAccount, type OriginRegion } from './region.js';
import { accountComposition } from './util.js';

/** Real, widely cited kernel share of an in-shell almond's mass: roughly a
 * quarter to a third (almond processing literature); the shell takes the
 * rest. */
export const KERNEL_SHARE_OF_IN_SHELL = 0.3;

export interface AlmondChainAccounts {
  readonly inShell: AccountId;
  readonly kernel: AccountId;
}

export function openAlmondAccounts(ledger: Ledger, prefix = 'almond'): AlmondChainAccounts {
  const accounts: AlmondChainAccounts = { inShell: `${prefix}.in-shell`, kernel: `${prefix}.kernel` };
  for (const id of Object.values(accounts)) {
    if (!ledger.hasAccount(id)) ledger.openAccount({ id, kind: 'stock', label: id });
  }
  return accounts;
}

export interface AlmondChainResult {
  readonly inShellMassUg: Micrograms;
  readonly kernelMassUg: Micrograms;
  readonly shellMassUg: Micrograms;
  readonly daysGrown: number;
}

export function runAlmondChain(
  ledger: Ledger,
  rng: Rng,
  registry: SubstanceRegistry,
  region: OriginRegion,
  fieldId: string,
  accounts: AlmondChainAccounts,
): AlmondChainResult {
  const biomassAccount = `${fieldId}.biomass`;
  if (!ledger.hasAccount(biomassAccount)) {
    ledger.openAccount({ id: biomassAccount, kind: 'stock', label: `standing almond biomass at ${fieldId}` });
  }
  const residue = originResidueAccount(region);

  const harvest = growAndHarvest({
    ledger,
    rng,
    region,
    definition: ALMOND_TREE,
    fieldId,
    biomassAccount,
    primaryAccount: accounts.inShell,
    residueAccount: residue,
  });
  const inShellMassUg = harvest.primaryDryMassUg + harvest.waterAddedUg;

  const inShellComposition = accountComposition(ledger, accounts.inShell);
  const streams: readonly StreamProfile[] = [
    { id: 'kernel', elements: registry.get('almond-kernel').elements, targetShare: KERNEL_SHARE_OF_IN_SHELL },
    { id: 'shell', elements: registry.get('almond-shell').elements, targetShare: 1 - KERNEL_SHARE_OF_IN_SHELL },
  ];
  const [kernelComposition, shellComposition] = splitByProfile(inShellComposition, streams) as [Composition, Composition];
  ledger.post(
    buildProcessPosting({
      process: 'origin:almond:crack',
      inputs: [{ account: accounts.inShell, composition: inShellComposition }],
      outputs: [
        { account: accounts.kernel, composition: kernelComposition },
        { account: residue, composition: shellComposition },
      ],
    }),
  );

  return {
    inShellMassUg,
    kernelMassUg: compositionMass(kernelComposition),
    shellMassUg: compositionMass(shellComposition),
    daysGrown: harvest.daysGrown,
  };
}
