/**
 * `origin/`: the modelled import chain — origin regions with their own soil
 * (or mineral deposit), season and real shipping time, and every real,
 * mass-balanced transformation that turns what grows or is won there into a
 * bakery ingredient. See each module's own doc comment for the physical
 * basis; `docs/ARCHITECTURE.md` and `CONTRACT.md` govern the rules every one
 * of them follows.
 */

export type { AtomCount } from './constants.js';
export { ATOMIC_WEIGHT, GLUCOSE_COMBUSTION_J_PER_MOL, GLUCOSE_ENERGY_PER_UG, GLUCOSE_MOLAR_MASS, molarMass, splitMolecule } from './constants.js';

export type { CropClimate, OriginRegion, OriginRegionKind } from './region.js';
export {
  REGIONS,
  originReservoirAccount,
  originResidueAccount,
  originWarehouseAccount,
  seedCropRegion,
  seedMineralRegion,
} from './region.js';

export type { ImportShipment } from './shipping.js';
export { SECONDS_PER_DAY, ShipmentNotYetArrivedError, departShipment, originInTransitAccount, receiveShipment, shippingDelayTicks } from './shipping.js';

export type { GrowAndHarvestOptions, GrowAndHarvestResult } from './growth.js';
export { growAndHarvest } from './growth.js';

export {
  ALMOND_TREE,
  CHERRY_TREE,
  CITRUS_TREE,
  COCOA_TREE,
  COFFEE_TREE,
  FORAGE_MEADOW,
  STRAWBERRY_PLANT,
  SUGAR_MAPLE,
  VANILLA_VINE,
} from './crops.js';

export type { FixedRatioStream, FixedRatioSplitResult, RespireClampedResult } from './util.js';
export { accountComposition, respireClamped, splitByFixedRatio, transferAccount } from './util.js';

export type { CocoaChainAccounts, CocoaChainResult } from './cocoa.js';
export { openCocoaAccounts, runCocoaChain } from './cocoa.js';

export type { VanillaChainAccounts, VanillaChainResult } from './vanilla.js';
export { openVanillaAccounts, runVanillaChain } from './vanilla.js';

export type { CoffeeChainAccounts, CoffeeChainResult } from './coffee.js';
export { openCoffeeAccounts, runCoffeeChain } from './coffee.js';

export type { CitrusChainAccounts, CitrusChainResult } from './citrus.js';
export { openCitrusAccounts, runCitrusChain } from './citrus.js';

export type { AlmondChainAccounts, AlmondChainResult } from './nuts.js';
export { openAlmondAccounts, runAlmondChain } from './nuts.js';

export type { FreshHarvestResult } from './berries.js';
export { harvestCherries, harvestStrawberries } from './berries.js';

export type { HoneyChainAccounts, HoneyChainResult, BeeswaxResult } from './honey.js';
export { openHoneyAccounts, runHoneyChain, secreteBeeswax } from './honey.js';

export type { MapleChainAccounts, MapleChainResult } from './maple.js';
export { openMapleAccounts, runMapleChain } from './maple.js';

export type { SaltEvaporationAccounts, SaltEvaporationResult, SaltMiningAccounts, SaltMiningResult } from './salt.js';
export { evaporateSalt, mineSalt, seedHaliteRegion, seedSeawaterRegion } from './salt.js';

export {
  crystalliseCreamOfTartar,
  refineGoldLeaf,
  refineSodiumBicarbonate,
  seedGoldReef,
  seedPhosphateBelt,
  seedSodaDeposit,
  seedVineyard,
  synthesizeFromReservoirs,
  synthesizeMcp,
  synthesizeSapp,
} from './minerals.js';

export type { RenderingResult } from './gelatin.js';
export { renderGelatin, seedRenderingWorks } from './gelatin.js';

export type {
  FeedStarterResult,
  SourdoughAccounts,
  YeastAccounts,
  YeastPropagationResult,
} from './culture.js';
export {
  YEAST_YIELD_FRACTION,
  feedStarter,
  fundYeastFeed,
  openSourdoughAccounts,
  openYeastAccounts,
  propagateYeast,
} from './culture.js';

export type { BeetColourResult, CaramelColourResult } from './colour.js';
export { extractBeetColour, makeCaramelColour } from './colour.js';
