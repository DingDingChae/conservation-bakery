import { describe, expect, it } from 'vitest';

import { classifyMachine, findTag, fractionOfRange } from './roles.js';
import { mixerMachine, ovenMachine, tag } from './testSupport/fixtures.js';

describe('classifyMachine', () => {
  it('classifies the two machines actually wired into the interactive world today', () => {
    expect(classifyMachine({ id: 'mixer-1', label: 'Mixing bowl' })).toBe('mixer');
    expect(classifyMachine({ id: 'oven-1', label: 'Deck oven' })).toBe('oven');
  });

  it.each([
    ['spiral-mixer-1', 'Spiral mixer', 'mixer'],
    ['deck-oven-2', 'Deck oven', 'oven'],
    ['extraction-fan-1', 'Extraction fan', 'extractor'],
    ['spiral-cooler-1', 'Spiral cooler', 'conveyor'],
    ['flow-wrapper-1', 'Flow wrapper', 'wrapper'],
    ['case-packer-1', 'Case packer', 'wrapper'],
  ] as const)('classifies "%s" / "%s" as %s', (id, label, role) => {
    expect(classifyMachine({ id, label })).toBe(role);
  });

  it('falls back to generic for a machine matching no known vocabulary', () => {
    expect(classifyMachine({ id: 'qa-lab-1', label: 'QA lab' })).toBe('generic');
  });
});

describe('findTag', () => {
  it('finds a tag by id pattern', () => {
    const found = findTag(mixerMachine(), /speed|rpm/i);
    expect(found?.id).toBe('mix-speed-rpm');
  });

  it('finds a tag by unit pattern when the id itself does not match', () => {
    const machine = ovenMachine({ tags: [tag({ id: 'obscure-name', unit: 'rpm', value: 10, rangeHigh: 20 })] });
    expect(findTag(machine, /rpm/i)?.id).toBe('obscure-name');
  });

  it('returns undefined when nothing matches', () => {
    expect(findTag(mixerMachine(), /nonexistent/i)).toBeUndefined();
  });
});

describe('fractionOfRange', () => {
  it('is 0 for an undefined tag', () => {
    expect(fractionOfRange(undefined)).toBe(0);
  });

  it('is 0 for a degenerate (zero-span) range', () => {
    expect(fractionOfRange(tag({ id: 't', value: 5, rangeLow: 10, rangeHigh: 10 }))).toBe(0);
  });

  it('maps the low and high end of the range to 0 and 1', () => {
    expect(fractionOfRange(tag({ id: 't', value: 0, rangeLow: 0, rangeHigh: 200 }))).toBe(0);
    expect(fractionOfRange(tag({ id: 't', value: 200, rangeLow: 0, rangeHigh: 200 }))).toBe(1);
    expect(fractionOfRange(tag({ id: 't', value: 100, rangeLow: 0, rangeHigh: 200 }))).toBeCloseTo(0.5);
  });

  it('clamps a value outside its own declared range rather than returning outside [0, 1]', () => {
    expect(fractionOfRange(tag({ id: 't', value: -50, rangeLow: 0, rangeHigh: 200 }))).toBe(0);
    expect(fractionOfRange(tag({ id: 't', value: 250, rangeLow: 0, rangeHigh: 200 }))).toBe(1);
  });
});
