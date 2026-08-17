/**
 * English, panel register.
 *
 * The real engineering vocabulary — the words an actual control room uses: machine
 * modes as the plant would print them on a mode selector (`AUTO`, not "automatic"),
 * alarm states as an annunciator tile states them, terse column headers, exact units.
 * See `en-kid.ts` for the same meanings rewritten in plain language, and
 * `catalogue.ts` for the key type every one of these entries is checked against.
 */

import type { Catalogue } from './catalogue.js';

export const enPanel: Catalogue = {
  // -- Machine mode --------------------------------------------------------------------
  'mode.off': 'OFF',
  'mode.manual': 'MANUAL',
  'mode.auto': 'AUTO',
  'mode.service': 'SERVICE',
  'mode.label': 'Mode',
  'mode.legend': '{machine} mode',
  'mode.commissioned': 'Commissioned',
  'mode.notCommissioned': 'Not commissioned',
  'mode.running': 'Running',
  'mode.stopped': 'Stopped',
  'mode.runHours': '{hours} h run time',
  'mode.serviceDue': 'Service due in {hours} h',

  // -- Alarm state ------------------------------------------------------------------
  'alarm.state.normal': 'Normal',
  'alarm.state.activeUnacknowledged': 'Active — unacknowledged',
  'alarm.state.activeAcknowledged': 'Active — acknowledged',
  'alarm.state.cleared': 'Cleared — press reset',
  'alarm.acknowledge': 'Acknowledge',
  'alarm.reset': 'Reset',
  'alarm.priority': 'Priority {priority}',
  'alarm.firstOut': 'First out',
  'alarm.raisedAtTick': 'Raised at tick {tick}',
  'alarm.announceRaised': '{label} alarm raised',
  'alarm.announceCleared': '{label} alarm cleared',
  'alarm.announceAcknowledged': '{label} alarm acknowledged',
  'alarm.title': 'Alarms',
  'alarm.none': 'No active alarms',

  // -- Balance panel ------------------------------------------------------------------
  'balance.title': 'Mass & energy balance',
  'balance.commodity': 'Commodity',
  'balance.residual': 'Residual',
  'balance.ok': 'Books close — zero residual',
  'balance.notOk': '{commodity}: residual {residual}, expected 0',
  'balance.row': '{commodity} residual is {residual}',
  'balance.tick': 'Tick {tick}',

  // -- Provenance tree ------------------------------------------------------------------
  'provenance.title': 'Provenance',
  'provenance.root': 'Root source: {label}',
  'provenance.process': '{process}',
  'provenance.tick': 'Tick {tick}',
  'provenance.mass': '{mass}{unit}',
  'provenance.truncated': 'Ancestry walk truncated — showing partial detail',
  'provenance.empty': 'No provenance recorded',
  'provenance.lot': 'Lot {lotId}',

  // -- Speed controls --------------------------------------------------------------------
  'speed.label': 'Speed',
  'speed.pause': 'Pause',
  'speed.x1': '1×',
  'speed.x5': '5×',
  'speed.x60': '60×',
  'speed.current': 'Running at {speed}×',
  'speed.currentPaused': 'Paused',

  // -- Difficulty presets and knobs -----------------------------------------------------
  'difficulty.title': 'Difficulty',
  'difficulty.freePlay': 'Free Play',
  'difficulty.easy': 'Easy',
  'difficulty.realistic': 'Realistic',
  'difficulty.punishing': 'Punishing',
  'difficulty.knob.yield': 'Crop & product yield',
  'difficulty.knob.price': 'Market prices',
  'difficulty.knob.tolerance': 'Setpoint tolerance',
  'difficulty.knob.breakdownRate': 'Breakdown rate',
  'difficulty.knob.help': 'Operator assistance',
  'difficulty.callSupplier': 'Call a supplier',
  'difficulty.callSupplierHint': 'Brings a real, sourced, costed delivery to the gate',

  // -- Command palette --------------------------------------------------------------
  'palette.title': 'Command palette',
  'palette.placeholder': 'Type a command or search…',
  'palette.noResults': 'No matching commands',
  'palette.hint': 'Ctrl+Shift+F opens this from anywhere',
  'palette.groupMachines': 'Machines',
  'palette.groupAlarms': 'Alarms',
  'palette.groupSpeed': 'Speed',
  'palette.groupDifficulty': 'Difficulty',
  'palette.groupProvenance': 'Provenance',
  'palette.resultCount': '{count} results',

  // -- Command labels -----------------------------------------------------------------
  'command.setSpeed': 'Set speed to {speed}×',
  'command.setMode': '{machine}: switch to {mode}',
  'command.setSetpoint': '{machine}: set {tag} to {value}{unit}',
  'command.acknowledgeAlarm': '{machine}: acknowledge {alarm}',
  'command.resetAlarm': '{machine}: reset {alarm}',
  'command.callSupplier': 'Call supplier for {substance}',

  // -- Command refusal reasons --------------------------------------------------------
  'refusal.title': 'Command refused',
  'refusal.generic': 'Refused — {reason}',
  'refusal.notCommissioned': '{machine} has not been commissioned and cannot run',
  'refusal.modeTransition': '{machine} cannot switch from {from} to {to}',
  'refusal.alarmNotUnacknowledged': 'Alarm {alarm} is {state}, not ready to acknowledge',
  'refusal.alarmNotCleared': 'Alarm {alarm} is {state}, not ready to reset',
  'refusal.interlock': '{machine}: an interlock refused the command — {condition}',
  'refusal.outOfRange': '{value}{unit} is outside the allowed range {low}–{high}{unit}',
  'refusal.simulationNotRunning': 'The simulation is not running',

  // -- Units ----------------------------------------------------------------------------
  'unit.celsius': '°C',
  'unit.kilogram': 'kg',
  'unit.gram': 'g',
  'unit.hour': 'h',
  'unit.minute': 'min',
  'unit.second': 's',
  'unit.percent': '%',
  'unit.perHour': '/h',
  'unit.tick': 'tick',

  // -- Language/register settings ------------------------------------------------------
  'settings.register.panel': 'Panel',
  'settings.register.kid': 'Kid mode',
  'settings.language.en': 'English',
  'settings.language.yue': 'Cantonese',
  'settings.language.both': 'Both',
  'settings.reducedMotion': 'Reduced motion',
  'settings.muted': 'Muted',

  // -- Faceplate --------------------------------------------------------------------
  'faceplate.notFound': 'Machine {machine} not found',
  'faceplate.palette.tag': '{machine}: {tag}',
  'faceplate.setpoint.enterNumber': 'Enter a number',
  'faceplate.setpoint.enterValue': 'Enter a value',
  'faceplate.setpoint.hint': 'Range {range}{unit}',
  'faceplate.setpoint.title': 'Setpoints',
  'faceplate.tag.pv': 'PV',
  'faceplate.tag.range': 'Range {range}{unit}',
  'faceplate.tag.sp': 'SP',
  'faceplate.tag.status.deviationHigh': 'Deviation high',
  'faceplate.tag.status.deviationLow': 'Deviation low',
  'faceplate.tag.status.noSetpoint': 'No setpoint',
  'faceplate.tag.status.withinTolerance': 'Within tolerance',
  'faceplate.trend.columnPv': 'PV ({unit})',
  'faceplate.trend.columnSp': 'SP ({unit})',
  'faceplate.trend.columnTick': 'Tick',
  'faceplate.trend.legendPv': 'Process value ({unit})',
  'faceplate.trend.legendSp': 'Setpoint ({unit})',
  'faceplate.trend.svgDesc': '{label} trend, {count} samples — latest {value}{unit}',
  'faceplate.trend.svgDescEmpty': '{label} trend — no samples recorded yet',
  'faceplate.trend.svgTitle': '{label} trend',
  'faceplate.trend.tableCaption': '{label}, sampled every tick',
  'faceplate.trend.tableToggle': 'View trend data as a table',
  'faceplate.trend.title': 'Trend',

  // -- Command palette (keys with no shared equivalent) --------------------------------
  'palette.caseSensitive': 'Case-sensitive',
  'palette.close': 'Close',
  'palette.patternMode.contains': 'Contains',
  'palette.patternMode.legend': 'Pattern mode',
  'palette.patternMode.literal': 'Literal',
  'palette.patternMode.prefix': 'Starts with',
  'palette.patternMode.regex': 'Regular expression',
  'palette.patternMode.suffix': 'Ends with',
  'palette.patternMode.wholeWord': 'Whole word',
  'palette.runFailed': '{label} failed to run',
  'palette.usePattern': 'Use a pattern',

  // -- Ancestry lookup form -------------------------------------------------------------
  'provenance.tree.loadFailed': 'Lot {lotId} failed to load — {reason}',
  'provenance.tree.loading': 'Loading lot {lotId}…',
  'provenance.tree.lookupLabel': 'Lot id',
  'provenance.tree.lookupSubmit': 'Look up',

  // -- Shell chrome ---------------------------------------------------------------------
  'shell.appTitle': 'Conservation Bakery',
  'shell.fault.body':
    "The world's books have stopped balancing. This window has stopped rather than keep showing a factory it can no longer vouch for.",
  'shell.fault.detailUnavailable': 'No further detail is available for this fault',
  'shell.fault.heartbeatLost': 'No snapshot has been received from the simulation for several seconds',
  'shell.fault.noBridge': 'This window could not reach the application at all',
  'shell.fault.title': 'Simulation fault',
  'shell.header.annunciatorActive': '{count} active — most urgent: {machine}: {label}',
  'shell.header.annunciatorLabel': 'Annunciator',
  'shell.header.annunciatorOk': 'Normal — no active alarms',
  'shell.header.clock': '{time} · tick {tick}',
  'shell.header.noSnapshot': 'Waiting for a snapshot…',
  'shell.nav.ancestry': 'Ancestry',
  'shell.nav.balance': 'Balance',
  'shell.nav.settings': 'Settings',
  'shell.nav.title': 'Navigation',
  'shell.settings.callSupplierAccepted': 'Delivery of {substance} accepted',
  'shell.settings.callSupplierInvalidMass': 'Enter a whole number of grams greater than zero',
  'shell.settings.callSupplierMass': 'Mass ({unit})',
  'shell.settings.callSupplierSubstance': 'Substance',
  'shell.settings.difficultyNote': 'Reference only — difficulty is fixed at world creation and cannot be changed here',
  'shell.settings.languageLabel': 'Language',
  'shell.settings.registerLabel': 'Register',
};
