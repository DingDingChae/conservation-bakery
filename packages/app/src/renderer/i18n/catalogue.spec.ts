import { describe, expect, it } from 'vitest';

import { CATALOGUE_KEYS, createTranslate, interpolate, translate } from './catalogue.js';
import { enKid } from './en-kid.js';
import { enPanel } from './en-panel.js';
import { scanKeyUsage } from './keyUsage.js';
import { yueKid } from './yue-kid.js';
import { yuePanel } from './yue-panel.js';

const CATALOGUES = {
  'en-panel': enPanel,
  'en-kid': enKid,
  'yue-panel': yuePanel,
  'yue-kid': yueKid,
} as const;

describe('catalogue key parity', () => {
  // Catalogue-versus-catalogue only: a key present in one catalogue and absent from
  // another is still a bug, and TypeScript's own excess-property check on each
  // catalogue file's `Record<CatalogueKey, string>` literal already catches it at
  // compile time — this test re-asserts the same invariant at runtime with plain
  // `Object.keys`, so the guarantee holds even if a catalogue file is ever refactored
  // away from a literal object assignment. It is deliberately *not* the test that
  // matters most: all four catalogues can agree with each other and still all be
  // missing a key the real renderer calls `t()` with — see "catalogue completeness
  // against real call sites" below, which is the check that would actually have caught
  // that.
  const canonical = [...CATALOGUE_KEYS].sort();

  it.each(Object.entries(CATALOGUES))('%s has every canonical key and no others', (_name, catalogue) => {
    const actual = Object.keys(catalogue).sort();
    expect(actual).toEqual(canonical);
  });

  it('has no duplicate keys in the canonical list', () => {
    expect(new Set(CATALOGUE_KEYS).size).toBe(CATALOGUE_KEYS.length);
  });

  it.each(Object.entries(CATALOGUES))('%s is missing nothing relative to the canonical list', (_name, catalogue) => {
    const present = new Set(Object.keys(catalogue));
    const missing = CATALOGUE_KEYS.filter((key) => !present.has(key));
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(CATALOGUES))('%s has no orphaned key beyond the canonical list', (_name, catalogue) => {
    const canonicalSet = new Set<string>(CATALOGUE_KEYS);
    const orphaned = Object.keys(catalogue).filter((key) => !canonicalSet.has(key));
    expect(orphaned).toEqual([]);
  });
});

describe('catalogue completeness against real call sites', () => {
  // This is the test that actually matters, per the i18n task: 48 keys were called as
  // `context.t('faceplate.trend.title')` and the like throughout the renderer, defined
  // in no catalogue, and rendered as the literal `⟦missing:…⟧` placeholder to the
  // player — and the catalogue-versus-catalogue check above could never have caught it,
  // because it only ever compares the four catalogues to each other, never to the code
  // that calls `t()`. `scanKeyUsage()` (`keyUsage.ts`) statically scans every real
  // renderer source file for a `t('...')`/`translate('...')` call site and reports
  // every key it finds — see that module's own doc comment for exactly what it can and
  // cannot see with node builtins alone and no TypeScript parser.
  const scan = scanKeyUsage();
  const canonicalSet = new Set<string>(CATALOGUE_KEYS);

  it('names every key a real call site uses that no catalogue defines', () => {
    const missing = [...scan.callSiteKeys.keys()].filter((key) => !canonicalSet.has(key)).sort();
    expect(missing).toEqual([]);
  });

  it('names every canonical key no scanned source file ever references, so the catalogues cannot rot', () => {
    const unused = CATALOGUE_KEYS.filter(
      (key) =>
        !scan.callSiteKeys.has(key) &&
        !scan.anyKeyShapedLiteral.has(key) &&
        ![...scan.templateKeyPrefixes].some((prefix) => key.startsWith(prefix)),
    );
    expect(unused).toEqual([]);
  });

  it('found at least one real call site, so an empty scan cannot masquerade as a clean one', () => {
    expect(scan.callSiteKeys.size).toBeGreaterThan(0);
  });
});

describe('interpolate', () => {
  it('substitutes every placeholder present in values', () => {
    expect(interpolate('{machine}: set {tag} to {value}{unit}', { machine: 'Oven 1', tag: 'top heat', value: 190, unit: '°C' })).toBe(
      'Oven 1: set top heat to 190°C',
    );
  });

  it('returns the template unchanged when no values are given', () => {
    expect(interpolate('Priority {priority}')).toBe('Priority {priority}');
  });

  it('leaves an unresolved placeholder as visible literal text rather than erasing it', () => {
    expect(interpolate('Priority {priority}', {})).toBe('Priority {priority}');
    expect(interpolate('Priority {priority}', { other: 1 })).toBe('Priority {priority}');
  });

  it('coerces a numeric value to its decimal string form', () => {
    expect(interpolate('{count} results', { count: 3 })).toBe('3 results');
  });

  it('does not corrupt a template with no placeholders', () => {
    expect(interpolate('Pause', { unused: 'x' })).toBe('Pause');
  });
});

describe('translate: single language', () => {
  it('looks up the panel register in English', () => {
    expect(translate('panel', 'en', 'mode.auto')).toBe('AUTO');
  });

  it('looks up the Kid register in English', () => {
    expect(translate('kid', 'en', 'mode.auto')).toBe('Driving itself');
  });

  it('looks up the panel register in Cantonese', () => {
    expect(translate('panel', 'yue', 'mode.auto')).toBe('自動');
  });

  it('looks up the Kid register in Cantonese', () => {
    expect(translate('kid', 'yue', 'mode.auto')).toBe('自己識揸');
  });

  it('interpolates values through the full lookup', () => {
    expect(translate('panel', 'en', 'alarm.priority', { priority: 2 })).toBe('Priority 2');
  });

  it('renders an unknown key as a visible, debuggable placeholder rather than throwing', () => {
    expect(translate('panel', 'en', 'no.such.key')).toBe('⟦missing:no.such.key⟧');
  });
});

describe("translate: 'both' language mode", () => {
  it('stacks the English line then the Cantonese line, joined by a newline, in the panel register', () => {
    expect(translate('panel', 'both', 'mode.auto')).toBe('AUTO\n自動');
  });

  it('stacks the English line then the Cantonese line, joined by a newline, in the Kid register', () => {
    expect(translate('kid', 'both', 'mode.auto')).toBe('Driving itself\n自己識揸');
  });

  it('interpolates the same values into both lines', () => {
    expect(translate('panel', 'both', 'alarm.priority', { priority: 2 })).toBe('Priority 2\n優先度 2');
  });

  it('splitting the result on the newline recovers each language separately', () => {
    const [en, yue] = translate('panel', 'both', 'speed.pause').split('\n');
    expect(en).toBe('Pause');
    expect(yue).toBe('暫停');
  });
});

describe('createTranslate', () => {
  it('reflects a live preferences source without needing to be rebuilt', () => {
    let register: 'panel' | 'kid' = 'panel';
    let language: 'en' | 'yue' | 'both' = 'en';
    const t = createTranslate(() => ({ register, language }));

    expect(t('mode.auto')).toBe('AUTO');

    register = 'kid';
    expect(t('mode.auto')).toBe('Driving itself');

    language = 'yue';
    expect(t('mode.auto')).toBe('自己識揸');

    language = 'both';
    expect(t('mode.auto')).toBe('Driving itself\n自己識揸');
  });

  it('passes interpolation values through', () => {
    const t = createTranslate(() => ({ register: 'panel' as const, language: 'en' as const }));
    expect(t('speed.current', { speed: 5 })).toBe('Running at 5×');
  });
});

describe('the Kid register is a rewrite, not a copy of the panel register', () => {
  it('differs from the panel register on almost every key, in both languages', () => {
    const enIdentical = CATALOGUE_KEYS.filter((key) => enPanel[key] === enKid[key]);
    const yueIdentical = CATALOGUE_KEYS.filter((key) => yuePanel[key] === yueKid[key]);

    // A handful of short, register-independent tokens (a bare "1×", a unit symbol
    // reused verbatim) are legitimately identical between registers. If most of the
    // catalogue were identical, the Kid register would be the panel register with a
    // different name, which is exactly what this test exists to catch.
    expect(enIdentical.length).toBeLessThan(CATALOGUE_KEYS.length * 0.2);
    expect(yueIdentical.length).toBeLessThan(CATALOGUE_KEYS.length * 0.2);
  });

  it('rewrites jargon into an explanatory phrase rather than a synonym, for a representative sample', () => {
    // Spot-check specific keys where the panel register is bare engineering shorthand:
    // the Kid entry must be materially longer prose, not just a shorter or re-cased
    // version of the same word.
    const rewritten: readonly (keyof typeof enPanel)[] = [
      'mode.auto',
      'alarm.state.activeUnacknowledged',
      'balance.ok',
      'refusal.notCommissioned',
    ];
    for (const key of rewritten) {
      expect(enKid[key]).not.toBe(enPanel[key]);
      expect(enKid[key].length).toBeGreaterThan(enPanel[key].length);
      expect(yueKid[key]).not.toBe(yuePanel[key]);
    }
  });

  it('never states a bare number without an explanatory phrase around it, for run hours', () => {
    // The panel register is allowed to be terse ("{hours} h run time"); the Kid
    // register's whole point is that every number gets explained in words.
    expect(enKid['mode.runHours']).toMatch(/it's been working for/i);
    expect(yueKid['mode.runHours']).toContain('已經做咗');
  });
});

describe('rule 2 vocabulary is equipment/product only, in every catalogue', () => {
  // A light, local sanity check alongside the repository-wide `tests/content/no-harm.spec.ts`
  // gate: every hazard-adjacent word this catalogue actually uses names a machine or
  // process condition — an interlock, a safeguard on the equipment — and nothing about
  // anyone involved.
  it('uses "interlock"/"safeguard" refusal language that stays equipment- and product-only', () => {
    for (const catalogue of Object.values(CATALOGUES)) {
      expect(catalogue['refusal.interlock']).not.toMatch(/hurt/i);
    }
  });
});
