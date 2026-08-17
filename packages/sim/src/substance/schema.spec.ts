import { describe, expect, it } from 'vitest';

import { UG_PER_KG } from '../core/commodity.js';
import { SubstanceValidationError, validateSubstance } from './schema.js';

function validFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test-fixture',
    name: 'Test fixture',
    category: 'mineral',
    state: 'solid',
    elements: { Na: 393374741, Cl: 606625259 },
    source: 'unit test',
    notes: 'unit test',
    ...overrides,
  };
}

describe('validateSubstance', () => {
  it('accepts a well-formed, exactly-balanced substance', () => {
    const record = validateSubstance(validFixture(), 'test-fixture.json');
    expect(record.id).toBe('test-fixture');
    expect(record.elements['Na']).toBe(393374741);
    expect(record.elements['Cl']).toBe(606625259);
  });

  it('rejects a composition that does not sum to exactly 1e9, naming the offending sum', () => {
    const fixture = validFixture({ elements: { Na: 393374741, Cl: 606625260 } }); // +1 over
    let thrown: unknown;
    try {
      validateSubstance(fixture, 'unbalanced.json');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SubstanceValidationError);
    const message = (thrown as Error).message;
    // The offending sum itself must be named in the error.
    expect(message).toContain('1000000001');
    expect(message).toContain(String(UG_PER_KG));
  });

  it('rejects a composition that sums to less than 1e9, naming the offending sum', () => {
    const fixture = validFixture({ elements: { Na: 393374741, Cl: 606625258 } }); // -1 under
    expect(() => validateSubstance(fixture, 'unbalanced-low.json')).toThrowError(/999999999/);
  });

  it('rejects an unknown element key', () => {
    const fixture = validFixture({ elements: { Zn: 1_000_000_000 } });
    expect(() => validateSubstance(fixture, 'bad-element.json')).toThrowError(/Zn/);
  });

  it('rejects a negative element value', () => {
    const fixture = validFixture({ elements: { Na: -1, Cl: 1_000_000_001 } });
    expect(() => validateSubstance(fixture, 'negative.json')).toThrowError(/negative/);
  });

  it('rejects a non-integer element value', () => {
    const fixture = validFixture({ elements: { Na: 393374741.5, Cl: 606625258.5 } });
    expect(() => validateSubstance(fixture, 'fractional.json')).toThrow(SubstanceValidationError);
  });

  it('rejects a malformed id', () => {
    const fixture = validFixture({ id: 'Not_Kebab_Case' });
    expect(() => validateSubstance(fixture, 'bad-id.json')).toThrowError(/kebab-case/);
  });

  it('rejects an unknown category', () => {
    const fixture = validFixture({ category: 'not-a-real-category' });
    expect(() => validateSubstance(fixture, 'bad-category.json')).toThrowError(/category/);
  });

  it('rejects an unknown state', () => {
    const fixture = validFixture({ state: 'plasma' });
    expect(() => validateSubstance(fixture, 'bad-state.json')).toThrowError(/state/);
  });

  it('rejects missing required metadata', () => {
    const { source: _source, ...rest } = validFixture();
    expect(() => validateSubstance(rest, 'missing-source.json')).toThrowError(/source/);
  });

  it('rejects a non-object payload', () => {
    expect(() => validateSubstance(null, 'null.json')).toThrow(SubstanceValidationError);
    expect(() => validateSubstance('nope', 'string.json')).toThrow(SubstanceValidationError);
    expect(() => validateSubstance([], 'array.json')).toThrow(SubstanceValidationError);
  });
});
