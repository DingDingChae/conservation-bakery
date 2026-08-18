/**
 * Every oven family's profile, queryable as data rather than left implicit in
 * a comment — so a designer surface (or a test) can ask "what is family X
 * good and bad at?" without importing that family's own implementation
 * module.
 */

import { BAIN_MARIE_PROFILE } from './bainMarie.js';
import { BAUMKUCHEN_SPIT_PROFILE } from './baumkuchenSpit.js';
import { CONVECTION_PROFILE } from './convection.js';
import { DECK_PROFILE } from './deck.js';
import { HEARTH_PROFILE } from './hearth.js';
import { INFRARED_PROFILE } from './infrared.js';
import { PLATE_IRON_PROFILE } from './plateIron.js';
import { PRESSURE_STEAMER_PROFILE } from './pressureSteamer.js';
import { RACK_ROTARY_PROFILE } from './rackRotary.js';
import { RF_ASSIST_PROFILE } from './rfAssist.js';
import { SPIRAL_PROFILE } from './spiral.js';
import { STEAM_TUBE_PROFILE } from './steamTube.js';
import { TUNNEL_DIRECT_FIRED_PROFILE } from './tunnelDirectFired.js';
import { TUNNEL_INDIRECT_PROFILE } from './tunnelIndirect.js';
import { WOOD_FIRED_PROFILE } from './woodFired.js';
import type { OvenFamilyId, OvenProfile } from './types.js';

/** Every oven family this directory implements, keyed by id. */
export const OVEN_FAMILY_PROFILES: Readonly<Record<OvenFamilyId, OvenProfile>> = {
  deck: DECK_PROFILE,
  'rack-rotary': RACK_ROTARY_PROFILE,
  convection: CONVECTION_PROFILE,
  'tunnel-direct-fired': TUNNEL_DIRECT_FIRED_PROFILE,
  'tunnel-indirect': TUNNEL_INDIRECT_PROFILE,
  'steam-tube': STEAM_TUBE_PROFILE,
  spiral: SPIRAL_PROFILE,
  hearth: HEARTH_PROFILE,
  'wood-fired': WOOD_FIRED_PROFILE,
  infrared: INFRARED_PROFILE,
  'rf-assist': RF_ASSIST_PROFILE,
  'bain-marie': BAIN_MARIE_PROFILE,
  'pressure-steamer': PRESSURE_STEAMER_PROFILE,
  'plate-iron': PLATE_IRON_PROFILE,
  'baumkuchen-spit': BAUMKUCHEN_SPIT_PROFILE,
};

/** Deterministic listing, in the same order as `OvenFamilyId`'s own
 * declaration. */
export const OVEN_FAMILY_LIST: readonly OvenProfile[] = [
  DECK_PROFILE,
  RACK_ROTARY_PROFILE,
  CONVECTION_PROFILE,
  TUNNEL_DIRECT_FIRED_PROFILE,
  TUNNEL_INDIRECT_PROFILE,
  STEAM_TUBE_PROFILE,
  SPIRAL_PROFILE,
  HEARTH_PROFILE,
  WOOD_FIRED_PROFILE,
  INFRARED_PROFILE,
  RF_ASSIST_PROFILE,
  BAIN_MARIE_PROFILE,
  PRESSURE_STEAMER_PROFILE,
  PLATE_IRON_PROFILE,
  BAUMKUCHEN_SPIT_PROFILE,
];
