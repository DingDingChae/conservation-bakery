import { describe, expect, it } from 'vitest';

import { formatEnergy, formatMass, formatMoney, formatScaledInteger } from './format.js';

describe('formatScaledInteger', () => {
  it('formats zero with no sign at any precision', () => {
    expect(formatScaledInteger('0', 9, 3)).toBe('0.000');
    expect(formatScaledInteger('0', 9, 0)).toBe('0');
    expect(formatScaledInteger('0', 2, 2, { signDisplay: 'always' })).toBe('0.00');
  });

  it('formats a value shorter than the scale factor', () => {
    // 5 micrograms is far smaller than one kilogram (10^9 ug): the integer part is 0
    // and the fractional part must still show the correct number of leading zeros.
    expect(formatScaledInteger('5', 9, 3)).toBe('0.000');
    expect(formatScaledInteger('5', 9, 9)).toBe('0.000000005');
  });

  it('formats an exact multiple of the scale factor', () => {
    expect(formatScaledInteger('1000000000', 9, 3)).toBe('1.000');
  });

  it('formats negative values with a leading minus, grouped', () => {
    expect(formatScaledInteger('-123456789012345678901234567890', 9, 3)).toBe(
      '-123,456,789,012,345,678,901.235',
    );
  });

  it('formats positive values far beyond Number.MAX_SAFE_INTEGER exactly', () => {
    // Number.MAX_SAFE_INTEGER is 16 digits; these are 30-41 digits. A number-based
    // implementation would silently lose precision here.
    expect(formatScaledInteger('123456789012345678901234567890', 9, 3)).toBe(
      '123,456,789,012,345,678,901.235',
    );
    expect(formatScaledInteger('123456789012345678901234567890123456789', 12, 6)).toBe(
      '123,456,789,012,345,678,901,234,567.890123',
    );
  });

  it('propagates a rounding carry through an unbroken run of 9s', () => {
    expect(formatScaledInteger('999999999999999999999999999999999999999', 6, 2)).toBe(
      '1,000,000,000,000,000,000,000,000,000,000,000.00',
    );
  });

  it('rounds half-to-even at the fractional boundary', () => {
    // 2.5 -> 2 (even neighbour), 3.5 -> 4 (even neighbour), 9.5 -> 10, 1.5 -> 2, 4.5 -> 4.
    expect(formatScaledInteger('25', 1, 0)).toBe('2');
    expect(formatScaledInteger('35', 1, 0)).toBe('4');
    expect(formatScaledInteger('95', 1, 0)).toBe('10');
    expect(formatScaledInteger('15', 1, 0)).toBe('2');
    expect(formatScaledInteger('45', 1, 0)).toBe('4');
  });

  it('rounds up unconditionally when the remainder is strictly past half', () => {
    // 2.51 is not a tie: it must round to 3 regardless of parity.
    expect(formatScaledInteger('251', 2, 0)).toBe('3');
  });

  it('rounds down when the remainder is strictly below half', () => {
    expect(formatScaledInteger('249', 2, 0)).toBe('2');
  });

  it('pads with zeros, never rounds, when precision exceeds the scale', () => {
    expect(formatScaledInteger('7', 2, 5)).toBe('0.07000');
  });

  it('leaves the value unchanged when precision equals the scale', () => {
    expect(formatScaledInteger('123456', 6, 6)).toBe('0.123456');
  });

  it('canonicalises leading zeros in the input', () => {
    expect(formatScaledInteger('007', 0, 0)).toBe('7');
  });

  it('never prints a sign for an input of "-0"', () => {
    expect(formatScaledInteger('-0', 2, 2)).toBe('0.00');
  });

  it('groups digits every three places and handles the no-separator-yet boundary', () => {
    expect(formatScaledInteger('123', 0, 0)).toBe('123');
    expect(formatScaledInteger('1234', 0, 0)).toBe('1,234');
    expect(formatScaledInteger('1234567', 0, 0)).toBe('1,234,567');
  });

  it('can disable grouping', () => {
    expect(formatScaledInteger('1234567', 0, 0, { grouping: false })).toBe('1234567');
  });

  it('honours a custom group and decimal separator', () => {
    expect(formatScaledInteger('123456789', 2, 2, { groupSeparator: '.', decimalSeparator: ',' })).toBe(
      '1.234.567,89',
    );
  });

  it('honours signDisplay: always and never', () => {
    expect(formatScaledInteger('500', 2, 2, { signDisplay: 'always' })).toBe('+5.00');
    expect(formatScaledInteger('-500', 2, 2, { signDisplay: 'always' })).toBe('-5.00');
    expect(formatScaledInteger('-500', 2, 2, { signDisplay: 'never' })).toBe('5.00');
  });

  it('rejects a malformed exact string', () => {
    expect(() => formatScaledInteger('12.3', 2, 2)).toThrow(RangeError);
    expect(() => formatScaledInteger('abc', 2, 2)).toThrow(RangeError);
    expect(() => formatScaledInteger('', 2, 2)).toThrow(RangeError);
    expect(() => formatScaledInteger('1e9', 2, 2)).toThrow(RangeError);
  });

  it('rejects a negative scale or precision', () => {
    expect(() => formatScaledInteger('1', -1, 0)).toThrow(RangeError);
    expect(() => formatScaledInteger('1', 0, -1)).toThrow(RangeError);
  });
});

describe('formatMass', () => {
  it('defaults to kilograms at 3 decimal places', () => {
    expect(formatMass('1000000000')).toBe('1.000');
  });

  it('formats grams using the 10^6 scale', () => {
    expect(formatMass('1500000', 'g', 1)).toBe('1.5');
  });

  it('formats kilograms using the 10^9 scale', () => {
    expect(formatMass('2500000000', 'kg', 1)).toBe('2.5');
  });

  it('formats zero mass', () => {
    expect(formatMass('0', 'kg', 2)).toBe('0.00');
  });

  it('formats negative mass', () => {
    expect(formatMass('-2500000000', 'kg', 1)).toBe('-2.5');
  });
});

describe('formatEnergy', () => {
  it('defaults to megajoules', () => {
    expect(formatEnergy('1000000000000')).toBe('1.000');
  });

  it('formats joules using the 10^6 scale', () => {
    expect(formatEnergy('2500000', 'J', 1)).toBe('2.5');
  });

  it('formats kilojoules using the 10^9 scale', () => {
    expect(formatEnergy('2500000000', 'kJ', 1)).toBe('2.5');
  });

  it('formats megajoules using the 10^12 scale', () => {
    expect(formatEnergy('2500000000000', 'MJ', 1)).toBe('2.5');
  });
});

describe('formatMoney', () => {
  it('formats minor units as major units at 2 decimal places by default', () => {
    expect(formatMoney('123456789')).toBe('1,234,567.89');
  });

  it('formats a value shorter than one major unit', () => {
    expect(formatMoney('5')).toBe('0.05');
  });

  it('formats zero money with no sign', () => {
    expect(formatMoney('0')).toBe('0.00');
  });

  it('formats negative money', () => {
    expect(formatMoney('-500')).toBe('-5.00');
  });

  it('formats grouping boundaries correctly', () => {
    expect(formatMoney('100000000')).toBe('1,000,000.00');
    expect(formatMoney('12300')).toBe('123.00');
    expect(formatMoney('123400')).toBe('1,234.00');
  });

  it('supports a currency with no minor unit at all', () => {
    expect(formatMoney('1234', 0)).toBe('1,234');
  });
});
