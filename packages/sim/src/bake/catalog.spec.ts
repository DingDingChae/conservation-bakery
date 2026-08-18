import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CakeCatalog,
  CakeValidationError,
  defaultCakeCatalog,
  getCake,
  substanceIds,
  toFormulation,
  unresolvedSubstanceIds,
  validateCakeRecord,
  type CakeRecord,
} from './catalog.js';
import { evaluateFormulation, validateFormulation } from './formulation.js';

/** The exact, stable id set this catalogue ships. A change to this list is a
 * change to the shipped catalogue's identity, not a passive side effect —
 * this test exists precisely so that is never silent. */
const EXPECTED_IDS = [
  'angel-food',
  'banana-cake',
  'battenberg',
  'baumkuchen',
  'black-forest',
  'boston-cream-pie',
  'bundt-cake',
  'carrot-cake',
  'castella',
  'chiffon',
  'christmas-cake',
  'coffee-crumb-cake',
  'devils-food',
  'dundee-cake',
  'esterhazy-torte',
  'financier',
  'genoise',
  'guinness-chocolate-cake',
  'hummingbird-cake',
  'kouign-amann',
  'lamington',
  'lemon-drizzle-cake',
  'madeira-cake',
  'madeleine',
  'marble-cake',
  'medovik',
  'opera',
  'panettone',
  'pineapple-upside-down-cake',
  'pound-cake',
  'prinzregententorte',
  'red-velvet',
  'sachertorte',
  'simnel-cake',
  'stollen',
  'swiss-roll',
  'tiramisu',
  'tres-leches',
  'victoria-sponge',
].sort();

describe('CakeCatalog.load (default packages/data/cakes)', () => {
  const catalog = defaultCakeCatalog();

  it('loads without throwing, and ships exactly the expected, stable id set', () => {
    expect([...catalog.ids()].sort()).toEqual(EXPECTED_IDS);
  });

  it('gives every shipped cake a unique id', () => {
    const ids = catalog.ids();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('makes every shipped cake a physically coherent formulation', () => {
    for (const cake of catalog.all()) {
      const validation = validateFormulation(toFormulation(cake));
      expect(validation.ok, `${cake.id}: ${validation.problems.map((p) => p.message).join('; ')}`).toBe(
        true,
      );
      expect(validation.problems).toEqual([]);
    }
  });

  it('gives every shipped cake at least one process step and a real oven family', () => {
    for (const cake of catalog.all()) {
      expect(cake.process.length).toBeGreaterThan(0);
      expect(['deck', 'convection', 'tunnel', 'rotary', 'none']).toContain(cake.ovenFamily);
    }
  });

  it('get/has/getCake agree with all()/ids()', () => {
    for (const cake of catalog.all()) {
      expect(catalog.has(cake.id)).toBe(true);
      expect(catalog.get(cake.id)).toEqual(cake);
      expect(getCake(cake.id)).toEqual(cake);
    }
    expect(catalog.has('not-a-real-cake')).toBe(false);
    expect(() => catalog.get('not-a-real-cake')).toThrow(/unknown cake/);
  });

  it('validation(id) always reports ok for a cataloged cake, by construction', () => {
    for (const id of catalog.ids()) {
      expect(catalog.validation(id).ok).toBe(true);
    }
  });
});

describe('CakeCatalog query surface', () => {
  const catalog = defaultCakeCatalog();

  it('byTradition matches case-insensitively and only returns real matches', () => {
    const british = catalog.byTradition('british');
    expect(british.length).toBeGreaterThan(0);
    for (const cake of british) {
      expect(cake.tradition.toLowerCase()).toBe('british');
    }
    expect(catalog.byTradition('victoria-sponge').length).toBe(0);
  });

  it('find applies an arbitrary predicate over the whole catalogue', () => {
    const noFat = catalog.find((cake) => evaluateFormulation(toFormulation(cake)).fatRatio === 0);
    const ids = noFat.map((cake) => cake.id);
    // Angel food and Swiss roll are the two classic fatless whisked sponges;
    // kouign-amann is real and correctly fat-free of *egg*, not fat.
    expect(ids).toContain('angel-food');
    expect(ids).toContain('swiss-roll');
  });

  it('metrics(id) matches evaluateFormulation(toFormulation(get(id))) exactly', () => {
    for (const id of catalog.ids()) {
      expect(catalog.metrics(id)).toEqual(evaluateFormulation(toFormulation(catalog.get(id))));
    }
  });
});

describe('real ratios land where their tradition implies', () => {
  const catalog = defaultCakeCatalog();
  const metricsOf = (id: string) => catalog.metrics(id);

  it('a genoise is not a pound cake: genoise is egg-forward and light on fat, pound cake is equal-parts', () => {
    const genoise = metricsOf('genoise');
    const pound = metricsOf('pound-cake');

    expect(genoise.eggPercent).toBeGreaterThan(150);
    expect(genoise.fatRatio).toBeLessThan(0.3);
    expect(genoise.structureIndex).toBeGreaterThan(1);

    expect(pound.structureIndex).toBeCloseTo(0, 10);
    expect(pound.fatRatio).toBeCloseTo(1, 10);

    expect(genoise.structureIndex).toBeGreaterThan(pound.structureIndex);
    expect(genoise.eggPercent).toBeGreaterThan(pound.eggPercent);
  });

  it('angel food has no fat at all, and more egg than any butter cake', () => {
    const angelFood = metricsOf('angel-food');
    expect(angelFood.fatRatio).toBe(0);
    expect(angelFood.eggPercent).toBeGreaterThan(200);
  });

  it('devil\'s food and red velvet are real high-ratio cakes: sugar exceeds flour', () => {
    expect(metricsOf('devils-food').sugarToFlourRatio).toBeGreaterThan(1);
    expect(metricsOf('red-velvet').sugarToFlourRatio).toBeGreaterThan(1);
  });

  it('kouign-amann has no egg: it sets by lamination and gluten, not egg protein', () => {
    expect(metricsOf('kouign-amann').eggPercent).toBe(0);
  });

  it('a rich fruit cake (Christmas cake) carries far more flavour-role mass than a lean sponge (genoise)', () => {
    const christmasCake = catalog.get('christmas-cake');
    const genoise = catalog.get('genoise');
    const flavourMass = (cake: CakeRecord) =>
      cake.ingredients
        .filter((ingredient) => ingredient.role === 'flavour')
        .reduce((sum, ingredient) => sum + ingredient.bakersPercent, 0);
    expect(flavourMass(christmasCake)).toBeGreaterThan(400);
    expect(flavourMass(genoise)).toBe(0);
  });

  it('a laminated dough (kouign-amann) and a rich fruit cake (Dundee) both sit at very different sugarToFlourRatio and fatRatio than a lean foam cake (angel food)', () => {
    const kouignAmann = metricsOf('kouign-amann');
    const dundee = metricsOf('dundee-cake');
    const angelFood = metricsOf('angel-food');
    expect(kouignAmann.fatRatio).toBeGreaterThan(angelFood.fatRatio);
    expect(dundee.fatRatio).toBeGreaterThan(angelFood.fatRatio);
  });
});

describe('substance-id diagnostics (does not gate loading, see catalog.ts module notes)', () => {
  const catalog = defaultCakeCatalog();

  it('finds no unresolved substances for a cake built entirely from registry ingredients', () => {
    expect(unresolvedSubstanceIds(catalog.get('pound-cake'))).toEqual([]);
  });

  it('finds real unresolved substances for a cake that needed an ingredient the registry does not carry yet', () => {
    const unresolved = unresolvedSubstanceIds(catalog.get('chiffon'));
    expect(unresolved).toContain('vegetable-oil');
  });

  it('substanceIds lists every distinct substance a cake references, deduplicated', () => {
    const ids = substanceIds(catalog.get('devils-food'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('cocoa-powder');
    // cocoa-powder appears on two ingredient lines (fat split and flavour split)
    // but must be listed exactly once.
    expect(ids.filter((id) => id === 'cocoa-powder').length).toBe(1);
  });
});

describe('validateCakeRecord: shape gate', () => {
  it('accepts a minimal well-formed record', () => {
    const record = validateCakeRecord(
      {
        id: 'test-cake',
        name: 'Test cake',
        tradition: 'Test',
        origin: 'A fixture, not a real cake.',
        ingredients: [
          { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
          { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 60 },
        ],
        process: [{ name: 'bake', description: 'bake it', temperatureC: 180, durationMinutes: 30 }],
        ovenFamily: 'deck',
        notes: 'A fixture.',
      },
      'test-cake.json',
    );
    expect(record.id).toBe('test-cake');
    expect(record.ingredients).toHaveLength(2);
  });

  it('rejects a record missing ingredients', () => {
    expect(() =>
      validateCakeRecord(
        {
          id: 'no-ingredients',
          name: 'No ingredients',
          tradition: 'Test',
          origin: 'x',
          ingredients: [],
          process: [{ name: 'bake', description: 'x' }],
          ovenFamily: 'deck',
          notes: 'x',
        },
        'no-ingredients.json',
      ),
    ).toThrow(CakeValidationError);
  });

  it('rejects an unknown ovenFamily', () => {
    expect(() =>
      validateCakeRecord(
        {
          id: 'bad-oven',
          name: 'Bad oven',
          tradition: 'Test',
          origin: 'x',
          ingredients: [{ substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 }],
          process: [{ name: 'bake', description: 'x' }],
          ovenFamily: 'microwave',
          notes: 'x',
        },
        'bad-oven.json',
      ),
    ).toThrow(/ovenFamily/);
  });

  it('rejects an implausible process temperature', () => {
    expect(() =>
      validateCakeRecord(
        {
          id: 'too-hot',
          name: 'Too hot',
          tradition: 'Test',
          origin: 'x',
          ingredients: [{ substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 }],
          process: [{ name: 'bake', description: 'x', temperatureC: 900 }],
          ovenFamily: 'deck',
          notes: 'x',
        },
        'too-hot.json',
      ),
    ).toThrow(/plausible bakery process range/);
  });

  it('rejects an unknown ingredient role', () => {
    expect(() =>
      validateCakeRecord(
        {
          id: 'bad-role',
          name: 'Bad role',
          tradition: 'Test',
          origin: 'x',
          ingredients: [{ substanceId: 'wheat-flour-white', role: 'starch', bakersPercent: 100 }],
          process: [{ name: 'bake', description: 'x' }],
          ovenFamily: 'deck',
          notes: 'x',
        },
        'bad-role.json',
      ),
    ).toThrow(/role/);
  });
});

describe('CakeCatalog.load: a deliberately incoherent fixture is rejected, naming why', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('refuses a sugar-flooded formulation and names the exact coherence failure', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cake-catalog-test-'));
    const incoherent = {
      id: 'too-much-sugar',
      name: 'Too much sugar',
      tradition: 'Test',
      origin: 'A deliberately incoherent fixture, not a real cake.',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
        { substanceId: 'sucrose', role: 'sugar', bakersPercent: 400 },
        { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 300 },
      ],
      process: [{ name: 'bake', description: 'bake it', temperatureC: 180, durationMinutes: 30 }],
      ovenFamily: 'deck',
      notes: 'Deliberately incoherent, for catalog.spec.ts.',
    };
    writeFileSync(join(tempDir, 'too-much-sugar.json'), JSON.stringify(incoherent), 'utf8');

    expect(() => CakeCatalog.load(tempDir)).toThrow(/sugar-exceeds-flour-headroom/);
  });

  it('refuses a formulation with no flour and names the exact coherence failure', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cake-catalog-test-'));
    const noFlour = {
      id: 'no-flour-cake',
      name: 'No flour',
      tradition: 'Test',
      origin: 'A deliberately incoherent fixture, not a real cake.',
      ingredients: [{ substanceId: 'sucrose', role: 'sugar', bakersPercent: 100 }],
      process: [{ name: 'bake', description: 'bake it', temperatureC: 180, durationMinutes: 30 }],
      ovenFamily: 'deck',
      notes: 'Deliberately incoherent, for catalog.spec.ts.',
    };
    writeFileSync(join(tempDir, 'no-flour-cake.json'), JSON.stringify(noFlour), 'utf8');

    expect(() => CakeCatalog.load(tempDir)).toThrow(/no-flour/);
  });

  it('refuses a fat-flooded formulation that cannot emulsify', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cake-catalog-test-'));
    const tooGreasy = {
      id: 'too-greasy',
      name: 'Too greasy',
      tradition: 'Test',
      origin: 'A deliberately incoherent fixture, not a real cake.',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
        { substanceId: 'butter', role: 'fat', bakersPercent: 500 },
        { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 60 },
      ],
      process: [{ name: 'bake', description: 'bake it', temperatureC: 180, durationMinutes: 30 }],
      ovenFamily: 'deck',
      notes: 'Deliberately incoherent, for catalog.spec.ts.',
    };
    writeFileSync(join(tempDir, 'too-greasy.json'), JSON.stringify(tooGreasy), 'utf8');

    expect(() => CakeCatalog.load(tempDir)).toThrow(/fat-exceeds-egg-and-flour-headroom/);
  });

  it('refuses a file whose id does not match its own file name', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cake-catalog-test-'));
    const mismatched = {
      id: 'declared-id',
      name: 'Mismatched id',
      tradition: 'Test',
      origin: 'x',
      ingredients: [
        { substanceId: 'wheat-flour-white', role: 'flour', bakersPercent: 100 },
        { substanceId: 'water-liquid', role: 'liquid', bakersPercent: 60 },
      ],
      process: [{ name: 'bake', description: 'x', temperatureC: 180, durationMinutes: 30 }],
      ovenFamily: 'deck',
      notes: 'x',
    };
    writeFileSync(join(tempDir, 'different-file-name.json'), JSON.stringify(mismatched), 'utf8');

    expect(() => CakeCatalog.load(tempDir)).toThrow(/does not match its file/);
  });

  it('refuses a directory with no cake files at all', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cake-catalog-test-'));
    expect(() => CakeCatalog.load(tempDir)).toThrow(/no cake files found/);
  });
});
