import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferenceStore, type PreferencesStorage } from './prefs.js';

const STORAGE_KEY = 'conservation-bakery.preferences';

class FakeStorage implements PreferencesStorage {
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
  /** Test-only inspection helper: what was actually persisted for `key`. */
  raw(key: string): string | null {
    return this.getItem(key);
  }
}

describe('PreferenceStore: migration from a missing value', () => {
  it('falls back to defaults with no stored key at all', () => {
    const storage = new FakeStorage();
    const store = new PreferenceStore(storage);

    expect(store.preferences()).toEqual({
      register: 'panel',
      language: 'en',
      reducedMotion: false,
      muted: false,
    });
  });

  it('persists the normalised defaults on first load', () => {
    const storage = new FakeStorage();
    new PreferenceStore(storage);

    const saved = JSON.parse(storage.raw(STORAGE_KEY)!);
    expect(saved.version).toBe(1);
    expect(saved.preferences.register).toBe('panel');
  });

  it('honours constructor defaults for a missing value', () => {
    const storage = new FakeStorage();
    const store = new PreferenceStore(storage, { register: 'kid', reducedMotion: true });

    expect(store.preferences().register).toBe('kid');
    expect(store.preferences().reducedMotion).toBe(true);
    // Fields not overridden still get the hard-coded default.
    expect(store.preferences().language).toBe('en');
  });
});

describe('PreferenceStore: migration from an old stored value', () => {
  it('migrates a pre-versioning bare object, keeping the fields it had', () => {
    const storage = new FakeStorage();
    // Version 0: no envelope at all, and no `muted` field yet.
    storage.setItem(STORAGE_KEY, JSON.stringify({ register: 'kid', language: 'yue' }));

    const store = new PreferenceStore(storage);

    expect(store.preferences()).toEqual({
      register: 'kid',
      language: 'yue',
      reducedMotion: false,
      muted: false,
    });
  });

  it('rewrites the migrated value in the current envelope shape', () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ register: 'kid', language: 'yue' }));

    new PreferenceStore(storage);

    const saved = JSON.parse(storage.raw(STORAGE_KEY)!);
    expect(saved.version).toBe(1);
    expect(saved.preferences).toEqual({ register: 'kid', language: 'yue', reducedMotion: false, muted: false });
  });

  it('fills only the missing fields of a partially-old object, keeping valid ones', () => {
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, preferences: { register: 'kid', muted: true, language: 'not-a-real-language' } }),
    );

    const store = new PreferenceStore(storage);

    expect(store.preferences()).toEqual({
      register: 'kid',
      language: 'en', // invalid enum value falls back to default rather than the whole object being discarded
      reducedMotion: false,
      muted: true,
    });
  });
});

describe('PreferenceStore: migration from a corrupt stored value', () => {
  it('falls back to defaults for unparseable JSON', () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, '{not json at all');

    expect(() => new PreferenceStore(storage)).not.toThrow();
    const store = new PreferenceStore(storage);
    expect(store.preferences().register).toBe('panel');
  });

  it('falls back to defaults when the stored value is a JSON array', () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));

    const store = new PreferenceStore(storage);
    expect(store.preferences()).toEqual({ register: 'panel', language: 'en', reducedMotion: false, muted: false });
  });

  it('falls back to defaults when the stored value is a bare number', () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, '42');

    const store = new PreferenceStore(storage);
    expect(store.preferences()).toEqual({ register: 'panel', language: 'en', reducedMotion: false, muted: false });
  });

  it('falls back to defaults when the version has no migration path', () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, preferences: { register: 'kid' } }));

    const store = new PreferenceStore(storage);
    expect(store.preferences().register).toBe('panel');
  });

  it('overwrites the corrupt value with valid defaults after load', () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, 'garbage');

    new PreferenceStore(storage);

    expect(() => JSON.parse(storage.raw(STORAGE_KEY)!)).not.toThrow();
  });
});

describe('PreferenceStore: setPreferences / onPreferences', () => {
  it('merges a partial patch into the current preferences', () => {
    const store = new PreferenceStore(new FakeStorage());
    store.setPreferences({ register: 'kid' });

    expect(store.preferences()).toMatchObject({ register: 'kid', language: 'en' });
  });

  it('persists a change', () => {
    const storage = new FakeStorage();
    const store = new PreferenceStore(storage);
    store.setPreferences({ muted: true });

    const reloaded = new PreferenceStore(storage);
    expect(reloaded.preferences().muted).toBe(true);
  });

  it('notifies subscribers of the new value', () => {
    const store = new PreferenceStore(new FakeStorage());
    const listener = vi.fn();
    store.onPreferences(listener);

    store.setPreferences({ register: 'kid' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ register: 'kid' }));
  });

  it('does not notify when the patch does not actually change anything', () => {
    const store = new PreferenceStore(new FakeStorage());
    const listener = vi.fn();
    store.onPreferences(listener);

    store.setPreferences({ register: 'panel' }); // already the default

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after the returned unsubscribe is called', () => {
    const store = new PreferenceStore(new FakeStorage());
    const listener = vi.fn();
    const unsubscribe = store.onPreferences(listener);
    unsubscribe();

    store.setPreferences({ register: 'kid' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores an invalid value in a patch rather than storing it', () => {
    const store = new PreferenceStore(new FakeStorage());
    // @ts-expect-error -- exercising runtime defence against a value TypeScript would
    // normally reject, e.g. from a bridge that did not validate before calling in.
    store.setPreferences({ language: 'klingon' });

    expect(store.preferences().language).toBe('en');
  });

  it('survives a storage that throws on write', () => {
    const throwingStorage: PreferencesStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
    };
    const store = new PreferenceStore(throwingStorage);

    expect(() => store.setPreferences({ register: 'kid' })).not.toThrow();
    expect(store.preferences().register).toBe('kid');
  });
});

describe('PreferenceStore: default storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to an in-memory store when localStorage is unavailable', () => {
    expect(() => new PreferenceStore()).not.toThrow();
    const store = new PreferenceStore();
    expect(store.preferences().register).toBe('panel');
  });
});
