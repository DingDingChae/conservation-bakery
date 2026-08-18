/**
 * Every oven family: a pluggable common interface (`types.ts`), the shared
 * ledger/moisture bookkeeping every family reuses (`support.ts`), one module
 * per real heat-transfer mechanism, and a queryable registry of what each is
 * good and bad at (`registry.ts`). See each family module's own doc comment
 * for its citations.
 */

export * from './types.js';
export * from './registry.js';
export * from './steamPhysics.js';
export * from './deck.js';
export * from './rackRotary.js';
export * from './convection.js';
export * from './tunnelDirectFired.js';
export * from './tunnelIndirect.js';
export * from './steamTube.js';
export * from './spiral.js';
export * from './hearth.js';
export * from './woodFired.js';
export * from './infrared.js';
export * from './rfAssist.js';
export * from './bainMarie.js';
export * from './pressureSteamer.js';
export * from './plateIron.js';
export * from './baumkuchenSpit.js';
