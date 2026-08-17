/**
 * The renderer's shared seam.
 *
 * Every part of the control room is a module that mounts into an element and is handed
 * this context. Nothing reaches around it: a panel does not import another panel, does
 * not read global state, and does not talk to the main process directly. That is what
 * keeps a screen replaceable and keeps the Kid register from becoming a second codebase.
 *
 * The rule that shapes everything here: **the renderer observes, it never owns.** There
 * is no setter on a snapshot. To change the world you send a Command and wait for the
 * next snapshot to tell you what actually happened — which may be nothing, because an
 * interlock refused it.
 */

import type {
  Command,
  CommandResult,
  LanguageMode,
  ProvenanceNode,
  Register,
  WorldSnapshot,
} from '../shared/ipc.js';

/** Undo a mount. Every mount returns one; the shell calls it on teardown. */
export type Disposable = () => void;

/**
 * A translated string.
 *
 * `key` is looked up in the catalogue for the active language *and the active register*.
 * The panel register says "TOP HEAT SP"; the Kid register says "how hot the top is".
 * They are different entries under the same key, never one string with a toggle, because
 * plain language is a rewrite and not a synonym.
 */
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string;

/**
 * Announce something to assistive technology without moving focus.
 *
 * `polite` for a value that changed; `assertive` for an alarm that just latched. Every
 * audio cue in the product has a call here as its counterpart — the contract is that no
 * information is carried by sound alone, and none by colour alone.
 */
export type Announce = (message: string, urgency?: 'polite' | 'assertive') => void;

export interface Preferences {
  readonly register: Register;
  readonly language: LanguageMode;
  readonly reducedMotion: boolean;
  readonly muted: boolean;
}

export interface RendererContext {
  /** The most recent snapshot. Never mutate it. */
  readonly snapshot: () => WorldSnapshot | null;
  /** Subscribe to snapshots. Returns an unsubscribe. */
  readonly subscribe: (listener: (snapshot: WorldSnapshot) => void) => Disposable;
  /** Request a change. The result says whether the world accepted it, and why not. */
  readonly send: (command: Command) => Promise<CommandResult>;
  readonly provenance: (lotId: string) => Promise<ProvenanceNode>;

  readonly t: Translate;
  readonly announce: Announce;

  readonly preferences: () => Preferences;
  readonly setPreferences: (patch: Partial<Preferences>) => void;
  readonly onPreferences: (listener: (preferences: Preferences) => void) => Disposable;

  /**
   * Ask the shell to reveal a thing by id — a machine, a tag, a lot, an alarm. This is
   * how the command palette teleports without knowing how any panel is laid out.
   */
  readonly reveal: (target: RevealTarget) => void;
  readonly registerRevealHandler: (handler: (target: RevealTarget) => boolean) => Disposable;

  /** Register a palette entry. The palette owns matching; panels own their own verbs. */
  readonly registerCommands: (entries: readonly PaletteEntry[]) => Disposable;
  readonly paletteEntries: () => readonly PaletteEntry[];
}

export type RevealTarget =
  | { readonly kind: 'machine'; readonly machineId: string }
  | { readonly kind: 'tag'; readonly machineId: string; readonly tagId: string }
  | { readonly kind: 'alarm'; readonly machineId: string; readonly alarmId: string }
  | { readonly kind: 'lot'; readonly lotId: string }
  | { readonly kind: 'panel'; readonly panelId: string };

export interface PaletteEntry {
  readonly id: string;
  /** Already-translated label. The palette does not translate; the registrant does. */
  readonly label: string;
  readonly group: string;
  /** Extra words the search should match but not display, e.g. an engineering tag name. */
  readonly keywords?: readonly string[];
  readonly run: () => void | Promise<void>;
}

/** Every mountable part of the control room has this shape. */
export type Panel = (root: HTMLElement, context: RendererContext) => Disposable;
