import { describe, expect, it } from 'vitest';
import { residualIsExactlyZero } from './balanceRows.js';

describe('residualIsExactlyZero', () => {
  it('is true for the ordinary zero string a balanced ledger emits', () => {
    expect(residualIsExactlyZero('0')).toBe(true);
  });

  it('is true for a negative-zero string, in case one is ever produced', () => {
    expect(residualIsExactlyZero('-0')).toBe(true);
  });

  it('is true for a zero string with extra leading digits, however unlikely', () => {
    expect(residualIsExactlyZero('00')).toBe(true);
  });

  it('is false for any nonzero residual, however small', () => {
    expect(residualIsExactlyZero('1')).toBe(false);
    expect(residualIsExactlyZero('-1')).toBe(false);
  });

  it('is false for a nonzero residual so large it would lose precision as a Number', () => {
    // Deliberately past Number.MAX_SAFE_INTEGER: this must still be caught as
    // nonzero without ever being parsed into a float.
    expect(residualIsExactlyZero('9007199254740993000001')).toBe(false);
  });

  it('is false (fails closed, not open) for an empty or malformed string rather than assuming it means zero', () => {
    expect(residualIsExactlyZero('')).toBe(false);
    expect(residualIsExactlyZero('abc')).toBe(false);
    expect(residualIsExactlyZero(' 0')).toBe(false);
  });
});
