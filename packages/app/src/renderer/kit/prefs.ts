/**
 * Preference persistence to `localStorage`, with a versioned schema and safe
 * migration — the `Preferences` half of `RendererContext` (`preferences`,
 * `setPreferences`, `onPreferences` in `renderer/context.ts`).
 *
 * Every read is defensive: a missing key, a value saved by an older build, or an
 * outright corrupt value (bad JSON, or JSON that parses but is not shaped like
 * preferences at all) all fall back to sane defaults rather than throwing — a broken
 * preferences entry must never be the reason the control room fails to open.
 */

import type { Preferences } from '../context.js';
import type { LanguageMode, Register } from '../../shared/ipc.js';

const STORAGE_KEY = 'conservation-bakery.preferences';

/** Bumped whenever the stored shape changes; `MIGRATIONS[v]` upgrades a v-schema
 * payload to v+1. */
const CURRENT_VERSION = 1;

const DEFAULT_PREFERENCES: Preferences = {
  register: 'panel',
  language: 'en',
  reducedMotion: false,
  muted: false,
};

const REGISTERS: readonly Register[] = ['panel', 'kid'];
const LANGUAGES: readonly LanguageMode[] = ['en', 'yue', 'both'];

/** What `Storage.getItem`/`setItem`/`removeItem` need to be, and nothing more — real
 * `localStorage` satisfies this, and so does an in-memory stand-in for a test or for a
 * context where `localStorage` itself is unavailable. */
export type PreferencesStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface StoredEnvelope {
  readonly version: number;
  readonly preferences: unknown;
}

/** Each migration upgrades the *raw parsed JSON* from its own version to the next.
 * Entry 0 covers the pre-versioning shape: before this envelope existed, the key held
 * a bare preferences-shaped object with no `version` field at all. */
const MIGRATIONS: readonly ((raw: unknown) => StoredEnvelope)[] = [
  (raw) => ({ version: 1, preferences: raw }),
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T>(value: unknown, allowed: readonly T[]): value is T {
  return (allowed as readonly unknown[]).includes(value);
}

/** Fill in each field independently from `defaults` rather than rejecting the whole
 * object on one bad field — an old save missing `muted` should keep the `register` and
 * `language` it did have, not lose all four to one gap. */
function sanitizePreferences(raw: unknown, defaults: Preferences): Preferences {
  const record = isRecord(raw) ? raw : {};
  return {
    register: isOneOf(record.register, REGISTERS) ? record.register : defaults.register,
    language: isOneOf(record.language, LANGUAGES) ? record.language : defaults.language,
    reducedMotion: typeof record.reducedMotion === 'boolean' ? record.reducedMotion : defaults.reducedMotion,
    muted: typeof record.muted === 'boolean' ? record.muted : defaults.muted,
  };
}

function preferencesEqual(a: Preferences, b: Preferences): boolean {
  return a.register === b.register && a.language === b.language && a.reducedMotion === b.reducedMotion && a.muted === b.muted;
}

/** Parse the stored JSON and walk it forward through `MIGRATIONS` to `CURRENT_VERSION`.
 * Returns `null` for anything that cannot be made sense of — missing key, invalid
 * JSON, a value that isn't even an object, or a version with no migration path — so
 * the caller can fall back to defaults uniformly. */
function readEnvelope(storage: PreferencesStorage): StoredEnvelope | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  let envelope: StoredEnvelope;
  if (isRecord(parsed) && typeof parsed.version === 'number') {
    envelope = { version: parsed.version, preferences: parsed.preferences };
  } else if (isRecord(parsed)) {
    envelope = { version: 0, preferences: parsed };
  } else {
    return null;
  }

  while (envelope.version < CURRENT_VERSION) {
    const migrate = MIGRATIONS[envelope.version];
    if (!migrate) return null;
    envelope = migrate(envelope.preferences);
  }
  return envelope.version === CURRENT_VERSION ? envelope : null;
}

class MemoryStorage implements PreferencesStorage {
  readonly #map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
}

function safeLocalStorage(): PreferencesStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Reading `localStorage` itself can throw in a locked-down context (private
    // browsing in some engines, a denied permission). Fall through to in-memory.
  }
  return new MemoryStorage();
}

/**
 * Owns one player's preferences: loads them once (migrating or defaulting as needed),
 * persists every change, and notifies subscribers. This is the concrete type behind
 * `RendererContext.preferences` / `setPreferences` / `onPreferences` — a caller wires
 * `store.preferences`, `store.setPreferences` and `store.onPreferences` straight in.
 */
export class PreferenceStore {
  readonly #storage: PreferencesStorage;
  readonly #defaults: Preferences;
  readonly #listeners = new Set<(preferences: Preferences) => void>();
  #current: Preferences;

  constructor(storage: PreferencesStorage = safeLocalStorage(), defaults: Partial<Preferences> = {}) {
    this.#storage = storage;
    this.#defaults = { ...DEFAULT_PREFERENCES, ...defaults };
    this.#current = this.#load();
  }

  preferences = (): Preferences => this.#current;

  setPreferences = (patch: Partial<Preferences>): void => {
    const next = sanitizePreferences({ ...this.#current, ...patch }, this.#defaults);
    if (preferencesEqual(next, this.#current)) return;
    this.#current = next;
    this.#save(next);
    for (const listener of this.#listeners) listener(next);
  };

  onPreferences = (listener: (preferences: Preferences) => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #load(): Preferences {
    const envelope = readEnvelope(this.#storage);
    const preferences = sanitizePreferences(envelope?.preferences, this.#defaults);
    // Normalise on disk immediately: a migrated or corrupt-then-defaulted value is
    // rewritten in the current shape now, rather than re-migrated or re-discarded on
    // every single load.
    this.#save(preferences);
    return preferences;
  }

  #save(preferences: Preferences): void {
    const envelope: StoredEnvelope = { version: CURRENT_VERSION, preferences };
    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      // Storage can throw (quota exceeded, privacy mode). Preferences still work
      // in-memory for the session; persistence is best-effort, never required.
    }
  }
}
