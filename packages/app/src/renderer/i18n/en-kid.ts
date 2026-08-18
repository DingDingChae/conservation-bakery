/**
 * English, Kid register.
 *
 * A genuine rewrite of `en-panel.ts` into plain language, not the same sentence with
 * shorter words: "TOP HEAT SP 190C" becomes "how hot the top is — 190, just right".
 * Every number the panel register states bare gets a short explanation of what it
 * means in this register, and every piece of jargon (`AUTO`, `interlock`,
 * `commissioned`, `residual`) is replaced with a plain description of the same fact,
 * because the underlying simulation state — the two hard rules from CONTRACT.md — is
 * identical in both registers; only the words describing it change.
 *
 * Also holds to CONTRACT.md rule 2 exactly as strictly as the panel register: every
 * hazard here is still described as an equipment or product event, only more gently —
 * never reworded into anything about anyone involved, only about the machine or the
 * batch.
 */

import type { Catalogue } from './catalogue.js';

export const enKid: Catalogue = {
  // -- Machine mode --------------------------------------------------------------------
  'mode.off': 'Turned off',
  'mode.manual': "You're driving it",
  'mode.auto': 'Driving itself',
  'mode.service': 'Being checked over',
  'mode.label': "What it's doing",
  'mode.legend': 'What {machine} is doing right now',
  'mode.commissioned': 'Ready to use',
  'mode.notCommissioned': 'Not ready yet',
  'mode.running': 'Working right now',
  'mode.stopped': 'Not working right now',
  'mode.runHours': "It's been working for {hours} hours",
  'mode.serviceDue': 'Needs a check-up in {hours} hours',

  // -- Alarm state ------------------------------------------------------------------
  'alarm.state.normal': 'All good',
  'alarm.state.activeUnacknowledged': "Something's up — nobody's seen it yet",
  'alarm.state.activeAcknowledged': "Something's up — someone's on it",
  'alarm.state.cleared': "It's fine now — press the button to clear it",
  'alarm.acknowledge': "I've seen it",
  'alarm.reset': 'Clear it',
  'alarm.priority': 'How urgent: {priority}',
  'alarm.firstOut': 'This one happened first',
  'alarm.raisedAtTick': 'It started at step {tick}',
  'alarm.announceRaised': '{label} needs a look',
  'alarm.announceCleared': '{label} is sorted now',
  'alarm.announceAcknowledged': "You've seen {label}",
  'alarm.title': 'Things to check',
  'alarm.none': 'Nothing to check right now',

  // -- Balance panel ------------------------------------------------------------------
  'balance.title': 'Does everything add up?',
  'balance.commodity': "What's being counted",
  'balance.residual': 'Left over',
  'balance.ok': "Everything adds up — nothing left over, nothing missing",
  'balance.notOk': "{commodity} doesn't add up yet — it shows {residual} but it should be exactly 0",
  'balance.row': 'For {commodity}, the leftover amount is {residual}',
  'balance.tick': 'Step {tick}',

  // -- Provenance tree ------------------------------------------------------------------
  'provenance.title': 'Where it came from',
  'provenance.root': 'It all started from {label}',
  'provenance.process': 'Made by: {process}',
  'provenance.tick': 'This happened at step {tick}',
  'provenance.mass': '{mass}{unit} of it',
  'provenance.truncated': "There's more history than we're showing here",
  'provenance.empty': "We don't know where this came from yet",
  'provenance.lot': 'This batch: {lotId}',

  // -- Speed controls --------------------------------------------------------------------
  'speed.label': 'How fast time goes',
  'speed.pause': 'Stop time',
  'speed.x1': 'Normal speed',
  'speed.x5': '5 times faster',
  'speed.x60': '60 times faster',
  'speed.current': 'Time is going {speed} times faster than normal',
  'speed.currentPaused': 'Time is stopped',

  // -- Difficulty presets and knobs -----------------------------------------------------
  'difficulty.title': 'How tricky it is',
  'difficulty.freePlay': 'Just for fun',
  'difficulty.easy': 'Easy',
  'difficulty.realistic': 'Like the real thing',
  'difficulty.punishing': 'Really tough',
  'difficulty.knob.yield': 'How much you get from each batch',
  'difficulty.knob.price': 'How much things cost and sell for',
  'difficulty.knob.tolerance': 'How close you need to be to the target',
  'difficulty.knob.breakdownRate': 'How often machines stop working',
  'difficulty.knob.help': 'How much help you get',
  'difficulty.callSupplier': 'Call for a delivery',
  'difficulty.callSupplierHint': 'Someone brings you real stuff, paid for and counted',

  // -- Command palette --------------------------------------------------------------
  'palette.title': 'Search for anything',
  'palette.placeholder': 'Type what you want to find…',
  'palette.noResults': 'Nothing found',
  'palette.hint': 'Press Ctrl+Shift+F any time to open this',
  'palette.groupMachines': 'Machines',
  'palette.groupAlarms': 'Things to check',
  'palette.groupSpeed': 'How fast time goes',
  'palette.groupDifficulty': 'How tricky it is',
  'palette.groupProvenance': 'Where it came from',
  'palette.resultCount': 'Found {count}',

  // -- Command labels -----------------------------------------------------------------
  'command.setSpeed': 'Make time go {speed} times as fast',
  'command.setMode': 'Make {machine} do this: {mode}',
  'command.setSetpoint': 'Tell {machine} the {tag} should be {value}{unit}',
  'command.acknowledgeAlarm': "Tell {machine} you've seen {alarm}",
  'command.resetAlarm': 'Clear {alarm} on {machine}',
  'command.callSupplier': 'Ask for a delivery of {substance}',

  // -- Command refusal reasons --------------------------------------------------------
  'refusal.title': "That didn't work",
  'refusal.generic': 'It said no, because: {reason}',
  'refusal.notCommissioned': "{machine} hasn't been checked and set up yet, so it can't be turned on",
  'refusal.modeTransition': "{machine} can't go straight from {from} to {to}",
  'refusal.alarmNotUnacknowledged': '{alarm} isn\'t in a state you can say "seen" to yet',
  'refusal.alarmNotCleared': "{alarm} isn't clear yet, so it can't be reset",
  'refusal.interlock': '{machine} has a safeguard that said no — {condition}',
  'refusal.outOfRange': '{value}{unit} is too far off — it needs to be between {low}{unit} and {high}{unit}',
  'refusal.simulationNotRunning': "The factory isn't running right now",

  // -- Units ----------------------------------------------------------------------------
  'unit.celsius': 'degrees',
  'unit.kilogram': 'kilograms',
  'unit.gram': 'grams',
  'unit.hour': 'hours',
  'unit.minute': 'minutes',
  'unit.second': 'seconds',
  'unit.percent': 'percent',
  'unit.perHour': 'per hour',
  'unit.tick': 'simulation step',

  // -- Language/register settings ------------------------------------------------------
  'settings.register.panel': 'Grown-up view',
  'settings.register.kid': 'Kid mode',
  'settings.language.en': 'English',
  'settings.language.yue': 'Cantonese',
  'settings.language.both': 'Both languages',
  'settings.reducedMotion': 'Less movement on screen',
  'settings.muted': 'No sound',

  // -- Faceplate --------------------------------------------------------------------
  'faceplate.notFound': "We can't find a machine called {machine}",
  'faceplate.palette.tag': '{tag} on {machine}',
  'faceplate.setpoint.enterNumber': "That's not a number — try typing digits only",
  'faceplate.setpoint.enterValue': 'Type in a number first',
  'faceplate.setpoint.hint': 'Type a number between {range}{unit}',
  'faceplate.setpoint.title': 'Numbers you can change',
  'faceplate.tag.pv': 'What it is right now',
  'faceplate.tag.range': 'It should stay between {range}{unit}',
  'faceplate.tag.sp': 'What it should be',
  'faceplate.tag.status.deviationHigh': "It's a bit too high",
  'faceplate.tag.status.deviationLow': "It's a bit too low",
  'faceplate.tag.status.noSetpoint': "There's nothing to aim for here — this one just gets read",
  'faceplate.tag.status.withinTolerance': "It's right where it should be",
  'faceplate.trend.columnPv': 'What it really was ({unit})',
  'faceplate.trend.columnSp': "What it should've been ({unit})",
  'faceplate.trend.columnTick': 'Step',
  'faceplate.trend.legendPv': 'What it really was ({unit})',
  'faceplate.trend.legendSp': "What it should've been ({unit})",
  'faceplate.trend.svgDesc': "How {label} has changed over the last {count} readings — right now it's {value}{unit}",
  'faceplate.trend.svgDescEmpty': "We haven't recorded any readings for {label} yet",
  'faceplate.trend.svgTitle': 'How {label} has changed over time',
  'faceplate.trend.tableCaption': "Every reading we've taken of {label}",
  'faceplate.trend.tableToggle': 'See the numbers instead of the picture',
  'faceplate.trend.title': 'How things have changed',

  // -- Command palette (keys with no shared equivalent) --------------------------------
  'palette.caseSensitive': 'Match capital and small letters exactly',
  'palette.close': 'Close this',
  'palette.patternMode.contains': 'Has these letters anywhere',
  'palette.patternMode.legend': 'How to match',
  'palette.patternMode.literal': 'Matches exactly, letter for letter',
  'palette.patternMode.prefix': 'Starts with these letters',
  'palette.patternMode.regex': 'A pattern for grown-ups who know regular expressions',
  'palette.patternMode.suffix': 'Ends with these letters',
  'palette.patternMode.wholeWord': 'Is exactly one whole word',
  'palette.runFailed': "{label} didn't work",
  'palette.usePattern': 'Search using a pattern instead',

  // -- Ancestry lookup form -------------------------------------------------------------
  'provenance.tree.loadFailed': "We couldn't find out where lot {lotId} came from — {reason}",
  'provenance.tree.loading': 'Looking up where lot {lotId} came from…',
  'provenance.tree.lookupLabel': 'Type a batch number to look up',
  'provenance.tree.lookupSubmit': 'Find it',

  // -- Shell chrome ---------------------------------------------------------------------
  'shell.appTitle': 'Conservation Bakery',
  'shell.fault.body':
    "The numbers don't add up any more, so we've stopped everything rather than keep showing you a bakery we can't trust.",
  'shell.fault.detailUnavailable': "We don't have any more detail about what went wrong",
  'shell.fault.heartbeatLost': "We haven't heard from the bakery for a few seconds — it may have stopped",
  'shell.fault.noBridge': "This window can't talk to the app at all",
  'shell.fault.title': "Something's really wrong",
  'shell.header.annunciatorActive': '{count} things need checking — the most urgent is {label} on {machine}',
  'shell.header.annunciatorLabel': 'Anything need checking?',
  'shell.header.annunciatorOk': 'Nothing needs checking right now',
  'shell.header.clock': '{time} — this is step {tick}',
  'shell.header.noSnapshot': 'Still waiting to hear from the bakery…',
  'shell.nav.ancestry': 'Where things came from',
  'shell.nav.balance': 'Does it add up?',
  'shell.nav.settings': 'Settings',
  'shell.nav.title': 'Get around',
  'shell.nav.openMachine': 'Go look at {machine}',
  'shell.nav.search.label': 'Look for a machine by name',
  'shell.nav.search.placeholder': "Type a machine's name…",
  'shell.nav.search.resultsCount': 'You can see {count} machines now',
  'shell.nav.group.milling': 'Grinding flour',
  'shell.nav.group.creamery': 'Making butter',
  'shell.nav.group.refinery': 'Making sugar',
  'shell.nav.group.mixing': 'Stirring the batter',
  'shell.nav.group.ovens': 'The ovens',
  'shell.nav.group.finishing': 'Cooling and wrapping',
  'shell.nav.group.sales': 'Selling cakes',
  'shell.nav.group.other': 'Other stuff',
  'shell.settings.callSupplierAccepted': "Someone's bringing you {substance} now!",
  'shell.settings.callSupplierInvalidMass': 'Type in how many grams you want — a whole number, more than zero',
  'shell.settings.callSupplierMass': 'How much ({unit})',
  'shell.settings.callSupplierSubstance': 'What to order',
  'shell.settings.difficultyNote': "This just shows you how the settings work — you can't change them from here",
  'shell.settings.languageLabel': 'Which language',
  'shell.settings.registerLabel': 'How grown-up the words sound',

  // -- Cake designer --------------------------------------------------------------------
  'designer.title': 'Build a cake',
  'designer.subtitle': "Every check below tests your cake against a real kitchen — what's in stock, what the machines can do, and how fast it cools.",
  'designer.verdict.accepted': 'Yes! This cake can really be made',
  'designer.verdict.refused': "Not yet — here's why, below",
  'designer.announce.accepted': 'Your cake can be made!',
  'designer.announce.refused': "Your cake can't be made yet — see why below",

  'designer.elevation.title': 'Side view',
  'designer.elevation.svgTitle': 'A slice through your cake, tier by tier',
  'designer.elevation.svgDesc': "{tierCount} tier(s) stacked up, {totalHeight} m tall from bottom to top",
  'designer.elevation.tableToggle': 'Show the numbers instead',
  'designer.elevation.tableCaption': 'How wide and how tall each tier is, bottom to top',
  'designer.elevation.columnTier': 'Tier',
  'designer.elevation.columnDiameter': 'How wide (m)',
  'designer.elevation.columnHeight': 'How tall (m)',

  'designer.tier.add': 'Add another tier',
  'designer.tier.remove': 'Take this tier away',
  'designer.tier.legend': 'Tier {tier} — about {diameter} m wide',
  'designer.tier.diameterLabel': 'How wide (m)',
  'designer.tier.dowelledLabel': 'Has support rods inside',
  'designer.tier.dowelCountLabel': 'How many support rods',
  'designer.tier.layerMassLabel': 'How heavy the cake is (g)',
  'designer.tier.layerFormulationLabel': 'What kind of cake',

  'designer.filling.add': 'Add something inside',
  'designer.filling.remove': 'Take that filling out',
  'designer.filling.legend': "What's inside",
  'designer.filling.substanceLabel': "What it's made of",
  'designer.filling.massLabel': 'How much (g)',

  'designer.finish.add': 'Add a decoration',
  'designer.finish.remove': 'Take that decoration off',
  'designer.finish.legend': 'Decoration — {kind}',
  'designer.finish.kindLabel': 'What kind of decoration',
  'designer.finish.substanceLabel': "What it's made of",
  'designer.finish.massLabel': 'How much (g)',
  'designer.finish.elapsedLabel': 'How long after baking it goes on (seconds)',
  'designer.finish.kind.crumbCoat': 'Thin sealing coat',
  'designer.finish.kind.icing': 'Icing',
  'designer.finish.kind.buttercream': 'Buttercream',
  'designer.finish.kind.ganache': 'Chocolate ganache',
  'designer.finish.kind.fondant': 'Rolled fondant',
  'designer.finish.kind.piping': 'Piped detail',
  'designer.finish.kind.transfer': 'Printed picture',

  'designer.topper.add': 'Add something on top',
  'designer.topper.remove': 'Take that off the top',
  'designer.topper.legend': "What's on top",
  'designer.topper.tierLabel': 'Which tier',
  'designer.topper.substanceLabel': "What it's made of",
  'designer.topper.massLabel': 'How much (g)',

  'designer.formulation.poundCake': 'Pound cake — equal parts flour, sugar, egg and butter',
  'designer.formulation.genoise': 'Genoise — a light, whisked-egg sponge',

  'designer.substance.butter': 'Butter',
  'designer.substance.sucrose': 'Sugar',
  'designer.substance.cocoaButter': 'Cocoa butter',
  'designer.substance.honey': 'Honey',
  'designer.substance.cream': 'Cream',
  'designer.substance.gelatin': 'Gelatin',
  'designer.substance.cherry': 'Cherry',
  'designer.substance.strawberry': 'Strawberry',
  'designer.substance.goldLeaf': 'Gold leaf',

  'designer.structure.title': 'Will it stand up?',
  'designer.structure.problem.emptyTier': "Tier {tier} doesn't have any cake in it yet — there's nothing for anything else to sit on",
  'designer.structure.problem.tierOverloadedNoDowels': 'The {tier} tier is too soft to hold what\'s stacked on top of it — it needs some support rods (dowels) put in',
  'designer.structure.problem.insufficientDowels': 'Tier {tier} has {count} support rod(s), but it really needs {required} to hold everything up evenly',
  'designer.structure.problem.overhangingTier': "The tier above {tier} sticks out past its edge — with nothing underneath it, that side will tip",

  'designer.thermal.title': 'Is it cool enough?',
  'designer.thermal.problem.fondantTooWarm': "The cake is still warm ({temp} °C) when the fondant goes on, so it'll go soft and slide",
  'designer.thermal.problem.ganacheTooWarm': "The cake is still warm ({temp} °C) when the ganache goes on, so it won't firm up",
  'designer.thermal.problem.buttercreamFamilyTooWarm': "The cake is still warm ({temp} °C) when the {kind} goes on, so it'll go soft and lose its shape",

  'designer.feasibility.title': 'Can the kitchen actually make it?',
  'designer.feasibility.problem.missingEquipment': 'Nobody in the kitchen has a machine that can do a "{equipment}" step',
  'designer.feasibility.problem.insufficientTime': 'Decorating this takes {needed} minutes, but only {promised} minutes are free for it',
  'designer.feasibility.problem.insufficientStock': "There isn't enough {substance} — you need {needed} g but only {available} g is in the cupboard, {shortfall} g short",

  'designer.cost.title': 'What it costs',
  'designer.cost.material': 'Ingredients',
  'designer.cost.labor': 'Time to make it',
  'designer.cost.total': 'All together',
  'designer.cost.incomplete': "We don't know the price of everything yet, so this isn't the whole cost",
};
