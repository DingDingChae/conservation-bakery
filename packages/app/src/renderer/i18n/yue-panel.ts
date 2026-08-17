/**
 * Cantonese (廣東話), panel register.
 *
 * Written in natural Hong Kong Cantonese grammar and vocabulary — 唔 not 不, 冇 not
 * 沒有, 喺 not 在, 咗 not 了, 畀 not 給, 嘅 not 的, 巴仙 (the Cantonese loanword for
 * "per cent") not 百分比 — not Mandarin-style written Chinese with the characters
 * swapped. Technical nouns that are genuinely shared vocabulary across written Chinese
 * (機器, 溫度, 警報) stay as they are; that is ordinary technical terminology, not a
 * Mandarin-ism. See `yue-kid.ts` for the same meanings in colloquial Kid Cantonese, and
 * `en-panel.ts` for the English counterpart these entries are paired with key-for-key.
 */

import type { Catalogue } from './catalogue.js';

export const yuePanel: Catalogue = {
  // -- Machine mode --------------------------------------------------------------------
  'mode.off': '停',
  'mode.manual': '手動',
  'mode.auto': '自動',
  'mode.service': '維修',
  'mode.label': '模式',
  'mode.legend': '{machine} 模式',
  'mode.commissioned': '已驗收',
  'mode.notCommissioned': '未驗收',
  'mode.running': '運行中',
  'mode.stopped': '已停止',
  'mode.runHours': '運行咗 {hours} 小時',
  'mode.serviceDue': '仲有 {hours} 小時要維修',

  // -- Alarm state ------------------------------------------------------------------
  'alarm.state.normal': '正常',
  'alarm.state.activeUnacknowledged': '生效中 — 未確認',
  'alarm.state.activeAcknowledged': '生效中 — 已確認',
  'alarm.state.cleared': '已清除 — 請按重設',
  'alarm.acknowledge': '確認',
  'alarm.reset': '重設',
  'alarm.priority': '優先度 {priority}',
  'alarm.firstOut': '首發',
  'alarm.raisedAtTick': '喺第 {tick} 格觸發',
  'alarm.announceRaised': '{label} 警報已觸發',
  'alarm.announceCleared': '{label} 警報已清除',
  'alarm.announceAcknowledged': '{label} 警報已確認',
  'alarm.title': '警報',
  'alarm.none': '冇生效中嘅警報',

  // -- Balance panel ------------------------------------------------------------------
  'balance.title': '質量同能量結算',
  'balance.commodity': '項目',
  'balance.residual': '餘額',
  'balance.ok': '數目啱晒 — 餘額為零',
  'balance.notOk': '{commodity}：餘額 {residual}，應為 0',
  'balance.row': '{commodity} 嘅餘額係 {residual}',
  'balance.tick': '第 {tick} 格',

  // -- Provenance tree ------------------------------------------------------------------
  'provenance.title': '來源追蹤',
  'provenance.root': '根源：{label}',
  'provenance.process': '{process}',
  'provenance.tick': '第 {tick} 格',
  'provenance.mass': '{mass}{unit}',
  'provenance.truncated': '追蹤已截斷 — 只顯示部分資料',
  'provenance.empty': '未有來源紀錄',
  'provenance.lot': '批次 {lotId}',

  // -- Speed controls --------------------------------------------------------------------
  'speed.label': '速度',
  'speed.pause': '暫停',
  'speed.x1': '1×',
  'speed.x5': '5×',
  'speed.x60': '60×',
  'speed.current': '現以 {speed}× 運行',
  'speed.currentPaused': '已暫停',

  // -- Difficulty presets and knobs -----------------------------------------------------
  'difficulty.title': '難度',
  'difficulty.freePlay': '自由模式',
  'difficulty.easy': '簡單',
  'difficulty.realistic': '寫實',
  'difficulty.punishing': '嚴苛',
  'difficulty.knob.yield': '作物同產品產量',
  'difficulty.knob.price': '市場價格',
  'difficulty.knob.tolerance': '設定值容差',
  'difficulty.knob.breakdownRate': '故障率',
  'difficulty.knob.help': '操作協助',
  'difficulty.callSupplier': '致電供應商',
  'difficulty.callSupplierHint': '會送嚟一批有真實來源、已計價嘅貨',

  // -- Command palette --------------------------------------------------------------
  'palette.title': '指令面板',
  'palette.placeholder': '輸入指令或搜尋…',
  'palette.noResults': '冇符合嘅指令',
  'palette.hint': '喺任何地方撳 Ctrl+Shift+F 開啟',
  'palette.groupMachines': '機器',
  'palette.groupAlarms': '警報',
  'palette.groupSpeed': '速度',
  'palette.groupDifficulty': '難度',
  'palette.groupProvenance': '來源追蹤',
  'palette.resultCount': '{count} 個結果',

  // -- Command labels -----------------------------------------------------------------
  'command.setSpeed': '將速度設為 {speed}×',
  'command.setMode': '{machine}：切換去 {mode}',
  'command.setSetpoint': '{machine}：將 {tag} 設為 {value}{unit}',
  'command.acknowledgeAlarm': '{machine}：確認 {alarm}',
  'command.resetAlarm': '{machine}：重設 {alarm}',
  'command.callSupplier': '致電供應商叫 {substance}',

  // -- Command refusal reasons --------------------------------------------------------
  'refusal.title': '指令被拒絕',
  'refusal.generic': '已拒絕 — {reason}',
  'refusal.notCommissioned': '{machine} 未驗收，未可運行',
  'refusal.modeTransition': '{machine} 唔可以由 {from} 切換去 {to}',
  'refusal.alarmNotUnacknowledged': '警報 {alarm} 而家係 {state}，未可以確認',
  'refusal.alarmNotCleared': '警報 {alarm} 而家係 {state}，未可以重設',
  'refusal.interlock': '{machine}：連鎖裝置拒絕咗指令 — {condition}',
  'refusal.outOfRange': '{value}{unit} 超出容許範圍 {low}–{high}{unit}',
  'refusal.simulationNotRunning': '模擬未在運行',

  // -- Units ----------------------------------------------------------------------------
  'unit.celsius': '°C',
  'unit.kilogram': 'kg',
  'unit.gram': 'g',
  'unit.hour': '小時',
  'unit.minute': '分鐘',
  'unit.second': '秒',
  'unit.percent': '%',
  'unit.perHour': '/小時',
  'unit.tick': '格',

  // -- Language/register settings ------------------------------------------------------
  'settings.register.panel': '面板',
  'settings.register.kid': '小朋友模式',
  'settings.language.en': '英文',
  'settings.language.yue': '廣東話',
  'settings.language.both': '雙語',
  'settings.reducedMotion': '減少動畫',
  'settings.muted': '靜音',

  // -- Faceplate --------------------------------------------------------------------
  'faceplate.notFound': '搵唔到機器 {machine}',
  'faceplate.palette.tag': '{machine}：{tag}',
  'faceplate.setpoint.enterNumber': '請輸入數字',
  'faceplate.setpoint.enterValue': '請輸入數值',
  'faceplate.setpoint.hint': '範圍 {range}{unit}',
  'faceplate.setpoint.title': '設定值',
  'faceplate.tag.pv': 'PV',
  'faceplate.tag.range': '範圍 {range}{unit}',
  'faceplate.tag.sp': 'SP',
  'faceplate.tag.status.deviationHigh': '偏高',
  'faceplate.tag.status.deviationLow': '偏低',
  'faceplate.tag.status.noSetpoint': '冇設定值',
  'faceplate.tag.status.withinTolerance': '喺容差範圍內',
  'faceplate.trend.columnPv': 'PV ({unit})',
  'faceplate.trend.columnSp': 'SP ({unit})',
  'faceplate.trend.columnTick': '格',
  'faceplate.trend.legendPv': '製程值 ({unit})',
  'faceplate.trend.legendSp': '設定值 ({unit})',
  'faceplate.trend.svgDesc': '{label} 趨勢，{count} 個樣本 — 最新 {value}{unit}',
  'faceplate.trend.svgDescEmpty': '{label} 趨勢 — 未有樣本紀錄',
  'faceplate.trend.svgTitle': '{label} 趨勢',
  'faceplate.trend.tableCaption': '{label}，每格取樣一次',
  'faceplate.trend.tableToggle': '以表格顯示趨勢數據',
  'faceplate.trend.title': '趨勢',

  // -- Command palette (keys with no shared equivalent) --------------------------------
  'palette.caseSensitive': '區分大小寫',
  'palette.close': '關閉',
  'palette.patternMode.contains': '包含',
  'palette.patternMode.legend': '比對模式',
  'palette.patternMode.literal': '完全相符',
  'palette.patternMode.prefix': '開頭係',
  'palette.patternMode.regex': '正則表達式',
  'palette.patternMode.suffix': '結尾係',
  'palette.patternMode.wholeWord': '完整字詞',
  'palette.runFailed': '{label} 執行失敗',
  'palette.usePattern': '使用比對模式',

  // -- Ancestry lookup form -------------------------------------------------------------
  'provenance.tree.loadFailed': '批次 {lotId} 讀取失敗 — {reason}',
  'provenance.tree.loading': '正在讀取批次 {lotId}…',
  'provenance.tree.lookupLabel': '批次編號',
  'provenance.tree.lookupSubmit': '查詢',

  // -- Shell chrome ---------------------------------------------------------------------
  'shell.appTitle': '守恆麵包廠',
  'shell.fault.body': '呢個世界嘅帳目已經對唔上數，本視窗已停止運作，唔會再顯示一間未能核實嘅工廠。',
  'shell.fault.detailUnavailable': '呢個故障未有更多詳情',
  'shell.fault.heartbeatLost': '模擬已經有幾秒未有更新',
  'shell.fault.noBridge': '本視窗完全連接唔到應用程式',
  'shell.fault.title': '模擬故障',
  'shell.header.annunciatorActive': '{count} 個生效中 — 最緊急：{machine}：{label}',
  'shell.header.annunciatorLabel': '警報總覽',
  'shell.header.annunciatorOk': '正常 — 冇生效中嘅警報',
  'shell.header.clock': '{time} · 第 {tick} 格',
  'shell.header.noSnapshot': '等待快照中…',
  'shell.nav.ancestry': '族譜',
  'shell.nav.balance': '結算',
  'shell.nav.settings': '設定',
  'shell.nav.title': '導覽',
  'shell.settings.callSupplierAccepted': '已接受 {substance} 嘅送貨',
  'shell.settings.callSupplierInvalidMass': '請輸入大於零嘅整數克數',
  'shell.settings.callSupplierMass': '重量 ({unit})',
  'shell.settings.callSupplierSubstance': '物料',
  'shell.settings.difficultyNote': '僅供參考 — 難度喺建立世界時已經定咗，呢度改唔到',
  'shell.settings.languageLabel': '語言',
  'shell.settings.registerLabel': '用字模式',
};
