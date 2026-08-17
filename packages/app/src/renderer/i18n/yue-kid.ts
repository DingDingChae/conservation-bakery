/**
 * Cantonese (廣東話), Kid register.
 *
 * A genuine rewrite of `yue-panel.ts` into plain, colloquial Hong Kong Cantonese that a
 * child speaks and reads every day — full of the particles and constructions written
 * technical Chinese normally drops (緊, 咗, 喇, 㗎, 吓, 而家), never Mandarin-style
 * written Chinese and never merely the panel wording with easier characters. Every
 * number the panel register states bare gets a short spoken-Cantonese explanation of
 * what it means, matching the rewrite `en-kid.ts` does for English key-for-key.
 */

import type { Catalogue } from './catalogue.js';

export const yueKid: Catalogue = {
  // -- Machine mode --------------------------------------------------------------------
  'mode.off': '熄咗',
  'mode.manual': '你自己揸',
  'mode.auto': '自己識揸',
  'mode.service': '而家有人喺度睇緊',
  'mode.label': '而家做緊咩',
  'mode.legend': '{machine} 而家做緊咩',
  'mode.commissioned': '已經整好，可以用',
  'mode.notCommissioned': '仲未整好',
  'mode.running': '而家做緊嘢',
  'mode.stopped': '而家冇做嘢',
  'mode.runHours': '已經做咗 {hours} 個鐘',
  'mode.serviceDue': '再過 {hours} 個鐘就要有人嚟睇吓佢',

  // -- Alarm state ------------------------------------------------------------------
  'alarm.state.normal': '冇問題',
  'alarm.state.activeUnacknowledged': '而家響緊 — 仲未有人理',
  'alarm.state.activeAcknowledged': '而家響緊 — 已經有人喺度睇',
  'alarm.state.cleared': '而家冇事喇 — 撳一撳個掣清返佢',
  'alarm.acknowledge': '知道喇',
  'alarm.reset': '清返佢',
  'alarm.priority': '急唔急：{priority}',
  'alarm.firstOut': '呢個係第一個發生嘅',
  'alarm.raisedAtTick': '喺第 {tick} 步開始',
  'alarm.announceRaised': '{label} 有嘢要睇吓',
  'alarm.announceCleared': '{label} 搞掂喇',
  'alarm.announceAcknowledged': '你知道 {label} 嘅事喇',
  'alarm.title': '要留意嘅嘢',
  'alarm.none': '而家冇嘢要留意',

  // -- Balance panel ------------------------------------------------------------------
  'balance.title': '啲嘢加埋啱唔啱數',
  'balance.commodity': '數緊咩',
  'balance.residual': '剩返幾多',
  'balance.ok': '啲數啱晒 — 冇多冇少',
  'balance.notOk': '{commodity} 而家仲未啱數 — 應該係 0，但而家係 {residual}',
  'balance.row': '{commodity} 剩返 {residual}',
  'balance.tick': '第 {tick} 步',

  // -- Provenance tree ------------------------------------------------------------------
  'provenance.title': '呢啲嘢係邊度嚟㗎',
  'provenance.root': '最初係由 {label} 嚟嘅',
  'provenance.process': '整嘅方法：{process}',
  'provenance.tick': '呢件事喺第 {tick} 步發生',
  'provenance.mass': '呢度有 {mass}{unit}',
  'provenance.truncated': '仲有好多歷史未顯示晒',
  'provenance.empty': '而家仲未知呢件嘢係邊度嚟',
  'provenance.lot': '呢批嘢叫做 {lotId}',

  // -- Speed controls --------------------------------------------------------------------
  'speed.label': '時間行幾快',
  'speed.pause': '時間停住',
  'speed.x1': '平時咁快',
  'speed.x5': '快 5 倍',
  'speed.x60': '快 60 倍',
  'speed.current': '而家時間快咗 {speed} 倍',
  'speed.currentPaused': '時間停咗',

  // -- Difficulty presets and knobs -----------------------------------------------------
  'difficulty.title': '有幾難玩',
  'difficulty.freePlay': '淨係玩吓',
  'difficulty.easy': '易玩',
  'difficulty.realistic': '同真嘅工廠一樣',
  'difficulty.punishing': '超級難',
  'difficulty.knob.yield': '每一批攞到幾多',
  'difficulty.knob.price': '買同賣嘅價錢',
  'difficulty.knob.tolerance': '要幾貼近目標先算啱',
  'difficulty.knob.breakdownRate': '機器幾密會停',
  'difficulty.knob.help': '有幾多幫手',
  'difficulty.callSupplier': '打電話叫人送貨',
  'difficulty.callSupplierHint': '會有人送啲真材料嚟畀你，已經找咗數',

  // -- Command palette --------------------------------------------------------------
  'palette.title': '搵你想搵嘅嘢',
  'palette.placeholder': '打你想搵嘅嘢…',
  'palette.noResults': '搵唔到',
  'palette.hint': '隨時撳 Ctrl+Shift+F 就開到',
  'palette.groupMachines': '機器',
  'palette.groupAlarms': '要留意嘅嘢',
  'palette.groupSpeed': '時間行幾快',
  'palette.groupDifficulty': '有幾難玩',
  'palette.groupProvenance': '呢啲嘢係邊度嚟㗎',
  'palette.resultCount': '搵到 {count} 個',

  // -- Command labels -----------------------------------------------------------------
  'command.setSpeed': '將時間調快 {speed} 倍',
  'command.setMode': '叫 {machine} 轉去 {mode}',
  'command.setSetpoint': '同 {machine} 講 {tag} 要係 {value}{unit}',
  'command.acknowledgeAlarm': '話畀 {machine} 知你見到 {alarm} 喇',
  'command.resetAlarm': '將 {machine} 嘅 {alarm} 清返佢',
  'command.callSupplier': '打電話叫人送 {substance} 嚟',

  // -- Command refusal reasons --------------------------------------------------------
  'refusal.title': '呢個做唔到',
  'refusal.generic': '做唔到，因為：{reason}',
  'refusal.notCommissioned': '{machine} 仲未整好、仲未驗過，所以未可以開',
  'refusal.modeTransition': '{machine} 唔可以由 {from} 直接轉去 {to}',
  'refusal.alarmNotUnacknowledged': '{alarm} 而家仲未可以話「知道」',
  'refusal.alarmNotCleared': '{alarm} 仲未清返，未可以撳重設',
  'refusal.interlock': '{machine} 有個保護裝置話唔得 — {condition}',
  'refusal.outOfRange': '{value}{unit} 差得遠喇 — 要喺 {low}{unit} 同 {high}{unit} 之間先得',
  'refusal.simulationNotRunning': '間廠而家未開緊工',

  // -- Units ----------------------------------------------------------------------------
  'unit.celsius': '度',
  'unit.kilogram': '公斤',
  'unit.gram': '克',
  'unit.hour': '個鐘',
  'unit.minute': '分鐘',
  'unit.second': '秒',
  'unit.percent': '巴仙',
  'unit.perHour': '每個鐘',
  'unit.tick': '一步',

  // -- Language/register settings ------------------------------------------------------
  'settings.register.panel': '大人畫面',
  'settings.register.kid': '小朋友模式',
  'settings.language.en': '英文',
  'settings.language.yue': '廣東話',
  'settings.language.both': '兩種語言一齊睇',
  'settings.reducedMotion': '畫面郁少啲',
  'settings.muted': '冇聲',

  // -- Faceplate --------------------------------------------------------------------
  'faceplate.notFound': '搵唔到叫 {machine} 嘅機器喎',
  'faceplate.palette.tag': '{machine} 嘅 {tag}',
  'faceplate.setpoint.enterNumber': '呢個唔係數字嚟 — 淨係打數字啦',
  'faceplate.setpoint.enterValue': '先打個數落去',
  'faceplate.setpoint.hint': '打一個喺 {range}{unit} 之間嘅數就得',
  'faceplate.setpoint.title': '可以自己改嘅數字',
  'faceplate.tag.pv': '而家係幾多',
  'faceplate.tag.range': '應該喺 {range}{unit} 之間',
  'faceplate.tag.sp': '應該係幾多',
  'faceplate.tag.status.deviationHigh': '有少少偏高',
  'faceplate.tag.status.deviationLow': '有少少偏低',
  'faceplate.tag.status.noSetpoint': '呢個淨係睇吓，冇嘢要跟',
  'faceplate.tag.status.withinTolerance': '啱啱好，冇偏差',
  'faceplate.trend.columnPv': '實際係幾多 ({unit})',
  'faceplate.trend.columnSp': '本來應該係幾多 ({unit})',
  'faceplate.trend.columnTick': '第幾步',
  'faceplate.trend.legendPv': '實際係幾多 ({unit})',
  'faceplate.trend.legendSp': '本來應該係幾多 ({unit})',
  'faceplate.trend.svgDesc': '呢個顯示咗 {label} 最近 {count} 次嘅變化 — 而家係 {value}{unit}',
  'faceplate.trend.svgDescEmpty': '仲未記錄到 {label} 嘅資料',
  'faceplate.trend.svgTitle': '{label} 點樣變化緊',
  'faceplate.trend.tableCaption': '{label} 逐次記錄低嘅數字',
  'faceplate.trend.tableToggle': '睇返啲數字，唔睇圖',
  'faceplate.trend.title': '啲嘢點樣變緊',

  // -- Command palette (keys with no shared equivalent) --------------------------------
  'palette.caseSensitive': '大楷細楷要一樣先算啱',
  'palette.close': '閂咗佢',
  'palette.patternMode.contains': '入面有呢幾隻字就得',
  'palette.patternMode.legend': '點樣搵法',
  'palette.patternMode.literal': '要一模一樣先算啱',
  'palette.patternMode.prefix': '開頭係呢幾隻字',
  'palette.patternMode.regex': '識正則表達式嘅大人先用得嘅搵法',
  'palette.patternMode.suffix': '尾係呢幾隻字',
  'palette.patternMode.wholeWord': '要啱啱好一個完整嘅字',
  'palette.runFailed': '{label} 做唔到喎',
  'palette.usePattern': '用個範本嚟搵',

  // -- Ancestry lookup form -------------------------------------------------------------
  'provenance.tree.loadFailed': '搵唔到批次 {lotId} 係邊度嚟 — {reason}',
  'provenance.tree.loading': '搵緊批次 {lotId} 係邊度嚟嘅…',
  'provenance.tree.lookupLabel': '打個批次編號嚟搵',
  'provenance.tree.lookupSubmit': '搵佢',

  // -- Shell chrome ---------------------------------------------------------------------
  'shell.appTitle': '守恆麵包廠',
  'shell.fault.body': '啲數而家對唔返數喇，所以我哋停晒手，唔會再扮冇事噉畀你睇一間信唔過嘅廠。',
  'shell.fault.detailUnavailable': '呢次出咗咩事，我哋都冇更多料喇',
  'shell.fault.heartbeatLost': '有排都冇聽到間廠嘅消息喇 — 可能已經停咗',
  'shell.fault.noBridge': '呢個視窗完全連唔到個 app',
  'shell.fault.title': '出咗好大鑊嘢',
  'shell.header.annunciatorActive': '有 {count} 樣嘢要睇 — 最緊要係 {machine} 嘅 {label}',
  'shell.header.annunciatorLabel': '有嘢要睇吓未？',
  'shell.header.annunciatorOk': '而家冇嘢要睇',
  'shell.header.clock': '{time} — 而家係第 {tick} 步',
  'shell.header.noSnapshot': '仲喺度等緊間廠嘅消息…',
  'shell.nav.ancestry': '睇吓邊度嚟嘅',
  'shell.nav.balance': '啱唔啱數',
  'shell.nav.settings': '設定',
  'shell.nav.title': '去邊度',
  'shell.settings.callSupplierAccepted': '有人而家幫你送 {substance} 嚟喇！',
  'shell.settings.callSupplierInvalidMass': '打返個大過零嘅整數克數畀我哋',
  'shell.settings.callSupplierMass': '幾多克 ({unit})',
  'shell.settings.callSupplierSubstance': '想要咩',
  'shell.settings.difficultyNote': '呢度淨係畀你睇吓啲設定點運作 — 呢度改唔到㗎',
  'shell.settings.languageLabel': '想睇邊種話',
  'shell.settings.registerLabel': '想啲字點講法',
};
