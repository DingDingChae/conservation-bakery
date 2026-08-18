import { describe, expect, it } from 'vitest';
import { UG_PER_KG } from '../core/commodity.js';
import { defaultSubstanceRegistry } from '../substance/registry.js';

/** Every substance this task added, by file name (without `.json`) — see
 * `packages/data/substances/`. Listed explicitly so this spec fails loudly if
 * a file is ever accidentally removed, not just "the registry loaded fewer
 * files than before". */
const NEW_SUBSTANCE_IDS = [
  'cocoa-pod', 'cocoa-pod-husk', 'cocoa-bean-wet', 'cocoa-bean-dried', 'cocoa-bean-roasted',
  'cocoa-nib', 'cocoa-shell', 'cocoa-butter', 'cocoa-powder',
  'vanilla-bean-green', 'vanilla-bean-cured',
  'coffee-cherry', 'coffee-bean-green',
  'orange', 'orange-peel', 'orange-juice', 'pectin',
  'almond-in-shell', 'almond-kernel', 'almond-shell',
  'strawberry', 'cherry',
  'forage-nectar', 'honey', 'beeswax',
  'maple-sap', 'maple-syrup',
  'cream-of-tartar', 'sodium-acid-pyrophosphate', 'monocalcium-phosphate',
  'gelatin', 'yeast', 'sourdough-starter',
  'beet-red-colour', 'caramel-colour',
  'gold-leaf',
] as const;

/** The 27 substances present before this task, per the module doc comment in
 * `docs/ARCHITECTURE.md` — asserted still present and unbroken. */
const PRE_EXISTING_SUBSTANCE_IDS = [
  'atmospheric-nitrogen', 'atmospheric-oxygen', 'butter', 'buttermilk', 'carbon-dioxide',
  'cardboard', 'cattle-feed-maize-silage', 'cow-milk-whole', 'cream', 'hen-egg-white',
  'hen-egg-whole', 'hen-egg-yolk', 'methane', 'polypropylene-film', 'sodium-bicarbonate',
  'sodium-chloride', 'soil-nitrate', 'soil-phosphate', 'soil-potash', 'sucrose', 'sugar-beet',
  'water-liquid', 'water-vapour', 'wheat-bran', 'wheat-flour-white', 'wheat-germ', 'wheat-grain',
] as const;

describe('origin substance data', () => {
  const registry = defaultSubstanceRegistry();

  it('loads every new substance, validated, alongside every pre-existing one', () => {
    for (const id of [...NEW_SUBSTANCE_IDS, ...PRE_EXISTING_SUBSTANCE_IDS]) {
      expect(registry.has(id), `missing substance "${id}"`).toBe(true);
    }
    expect(registry.ids().length).toBe(NEW_SUBSTANCE_IDS.length + PRE_EXISTING_SUBSTANCE_IDS.length);
  });

  it('every new substance file sums to exactly UG_PER_KG', () => {
    for (const id of NEW_SUBSTANCE_IDS) {
      const record = registry.get(id);
      let sum = 0n;
      for (const value of Object.values(record.elements)) sum += BigInt(value ?? 0);
      expect(sum, `substance "${id}" sums to ${sum}, not ${UG_PER_KG}`).toBe(UG_PER_KG);
    }
  });

  it('every new substance carries a non-empty source and notes citation', () => {
    for (const id of NEW_SUBSTANCE_IDS) {
      const record = registry.get(id);
      expect(record.source.length, `substance "${id}" has no source citation`).toBeGreaterThan(0);
      expect(record.notes.length, `substance "${id}" has no notes`).toBeGreaterThan(0);
    }
  });

  it("getComposition of any mass reconciles to exactly that mass, for every new substance", () => {
    const massesUg = [0n, 1n, 999_999_999n, 1_000_000_000n, 7n, 3_333_333_333n];
    for (const id of NEW_SUBSTANCE_IDS) {
      for (const massUg of massesUg) {
        const composition = registry.getComposition(id, massUg);
        let total = 0n;
        for (const amount of composition.values()) total += amount;
        expect(total, `getComposition("${id}", ${massUg}) totalled ${total}`).toBe(massUg);
      }
    }
  });

  it('gold leaf is entirely Ash — Au is not a tracked element', () => {
    const gold = registry.get('gold-leaf');
    expect(gold.elements.Ash).toBe(Number(UG_PER_KG));
    for (const [element, amount] of Object.entries(gold.elements)) {
      if (element === 'Ash') continue;
      expect(amount ?? 0).toBe(0);
    }
  });

  it('every real molecular-compound substance closes to the cited molar-mass ratio', () => {
    // Cream of tartar: KC4H5O6, K fraction 39.098/188.177.
    const tartar = registry.get('cream-of-tartar');
    const kFraction = (tartar.elements.K ?? 0) / Number(UG_PER_KG);
    expect(kFraction).toBeCloseTo(39.098 / 188.177, 3);

    // Sodium acid pyrophosphate: Na2H2P2O7, Na fraction 45.98/221.937.
    const sapp = registry.get('sodium-acid-pyrophosphate');
    const naFraction = (sapp.elements.Na ?? 0) / Number(UG_PER_KG);
    expect(naFraction).toBeCloseTo(45.98 / 221.937, 3);

    // Monocalcium phosphate: Ca(H2PO4)2, Ca fraction 40.078/234.05.
    const mcp = registry.get('monocalcium-phosphate');
    const caFraction = (mcp.elements.Ca ?? 0) / Number(UG_PER_KG);
    expect(caFraction).toBeCloseTo(40.078 / 234.05, 3);
  });
});
