/**
 * Formatting for `ExactString` conserved quantities that never converts to a `number`.
 *
 * This is the important file in this kit. A conserved quantity crosses the process
 * boundary as a decimal integer string (`ExactString`, see `shared/ipc.ts`) so it can
 * exceed `Number.MAX_SAFE_INTEGER` without losing a gram. Every function here renders
 * that string as kilograms, grams, joules or money by slicing and rounding the digits
 * directly — the value is never parsed into a `number`, so there is nothing here that
 * could round-trip inexactly no matter how large the world's totals get.
 *
 * The scale constants below (micrograms per gram/kilogram, microjoules per joule/
 * kilojoule/megajoule) mirror `packages/sim/src/core/commodity.ts`'s `UG_PER_*` /
 * `UJ_PER_*` bigints. They are repeated here, as digit counts rather than bigints,
 * because this module has no reason to depend on `@conservation-bakery/sim` for three
 * numbers that are physical unit definitions, not simulation behaviour.
 */

/** A conserved quantity in transit: an exact integer written in base 10. Duplicated
 * from `shared/ipc.ts`'s type alias rather than imported, so this module stays usable
 * without pulling in the IPC contract — it is structurally the same `string`. */
export type ExactString = string;

export interface FormatOptions {
  /** Insert a separator every three integer digits. Default `true`. */
  readonly grouping?: boolean;
  readonly groupSeparator?: string;
  readonly decimalSeparator?: string;
  /** `'auto'` shows `-` only for negative values (default). `'always'` also shows `+`
   * for positive values. `'never'` shows neither. Zero never shows a sign either way. */
  readonly signDisplay?: 'auto' | 'always' | 'never';
}

const EXACT_STRING_PATTERN = /^-?\d+$/;

/** Micrograms per gram: 10^6. */
const MASS_G_SCALE_DIGITS = 6;
/** Micrograms per kilogram: 10^9. */
const MASS_KG_SCALE_DIGITS = 9;
/** Microjoules per joule: 10^6. */
const ENERGY_J_SCALE_DIGITS = 6;
/** Microjoules per kilojoule: 10^9. */
const ENERGY_KJ_SCALE_DIGITS = 9;
/** Microjoules per megajoule: 10^12. */
const ENERGY_MJ_SCALE_DIGITS = 12;

export type MassUnit = 'g' | 'kg';
export type EnergyUnit = 'J' | 'kJ' | 'MJ';

/**
 * Render `microgramsExact` (a base-ug `ExactString`) in the given mass unit, to
 * `precision` fractional digits, entirely by string manipulation.
 */
export function formatMass(microgramsExact: ExactString, unit: MassUnit = 'kg', precision = 3, options?: FormatOptions): string {
  const scaleDigits = unit === 'kg' ? MASS_KG_SCALE_DIGITS : MASS_G_SCALE_DIGITS;
  return formatScaledInteger(microgramsExact, scaleDigits, precision, options);
}

/**
 * Render `microjoulesExact` (a base-uJ `ExactString`) in the given energy unit, to
 * `precision` fractional digits, entirely by string manipulation.
 */
export function formatEnergy(microjoulesExact: ExactString, unit: EnergyUnit = 'MJ', precision = 3, options?: FormatOptions): string {
  const scaleDigits =
    unit === 'MJ' ? ENERGY_MJ_SCALE_DIGITS : unit === 'kJ' ? ENERGY_KJ_SCALE_DIGITS : ENERGY_J_SCALE_DIGITS;
  return formatScaledInteger(microjoulesExact, scaleDigits, precision, options);
}

/**
 * Render `minorUnitsExact` (money in minor currency units, e.g. cents) as major units,
 * to `decimalDigits` fractional digits (2 for a currency with a hundredth minor unit),
 * entirely by string manipulation. No currency symbol is added — that is a locale/copy
 * decision for the caller, not a numeric-formatting one.
 */
export function formatMoney(minorUnitsExact: ExactString, decimalDigits = 2, options?: FormatOptions): string {
  return formatScaledInteger(minorUnitsExact, decimalDigits, decimalDigits, options);
}

/**
 * The general-purpose formatter every unit-specific helper above delegates to: render
 * the exact integer `raw` (in some base unit) as a decimal with `precision` fractional
 * digits, where the base unit is `10^-scaleDigits` of the display unit — by slicing and
 * rounding the digit string directly. Exported because money, mass and energy are all
 * the same operation with a different scale, and a caller with its own commodity may
 * need the same guarantee.
 */
export function formatScaledInteger(raw: ExactString, scaleDigits: number, precision: number, options: FormatOptions = {}): string {
  if (!EXACT_STRING_PATTERN.test(raw)) {
    throw new RangeError(`formatScaledInteger: "${raw}" is not an exact decimal integer string`);
  }
  if (!Number.isInteger(scaleDigits) || scaleDigits < 0) {
    throw new RangeError(`formatScaledInteger: scaleDigits must be a non-negative integer, got ${scaleDigits}`);
  }
  if (!Number.isInteger(precision) || precision < 0) {
    throw new RangeError(`formatScaledInteger: precision must be a non-negative integer, got ${precision}`);
  }

  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  // Canonicalise leading zeros ("007" -> "7") but never strip the value down to nothing.
  const magnitude = digits.replace(/^0+(?=\d)/, '');

  // Pad so there is always at least one integer digit, even when the value is entirely
  // fractional (e.g. 5 micrograms as kilograms: shorter than the scale factor).
  const padded = magnitude.padStart(scaleDigits + 1, '0');
  let integerPart = padded.slice(0, padded.length - scaleDigits);
  let fractionalPart = padded.slice(padded.length - scaleDigits);

  if (precision < scaleDigits) {
    const rounded = roundFractional(integerPart, fractionalPart, precision);
    integerPart = rounded.integerPart;
    fractionalPart = rounded.fractionalPart;
  } else if (precision > scaleDigits) {
    fractionalPart = fractionalPart.padEnd(precision, '0');
  }

  const isZero = !/[1-9]/.test(integerPart) && !/[1-9]/.test(fractionalPart);

  const grouping = options.grouping ?? true;
  const groupSeparator = options.groupSeparator ?? ',';
  const decimalSeparator = options.decimalSeparator ?? '.';
  const signDisplay = options.signDisplay ?? 'auto';

  const groupedInteger = grouping ? groupDigits(integerPart, groupSeparator) : integerPart;

  let sign = '';
  if (!isZero) {
    if (negative) sign = signDisplay === 'never' ? '' : '-';
    else sign = signDisplay === 'always' ? '+' : '';
  }

  const fractionalSuffix = precision > 0 ? decimalSeparator + fractionalPart : '';
  return sign + groupedInteger + fractionalSuffix;
}

/** Insert `separator` every three digits from the right, e.g. "1234567" -> "1,234,567". */
function groupDigits(integerDigits: string, separator: string): string {
  const parts: string[] = [];
  for (let i = 0; i < integerDigits.length; i++) {
    if (i > 0 && (integerDigits.length - i) % 3 === 0) parts.push(separator);
    parts.push(integerDigits.charAt(i));
  }
  return parts.join('');
}

/**
 * Round `integerPart + "." + fractionalPart` to `precision` fractional digits using
 * round-half-to-even (banker's rounding, matching `roundHalfEven` in
 * `packages/sim/src/core/commodity.ts`), operating only on digit characters — the
 * value never passes through a `number`, so this is exact regardless of length.
 */
function roundFractional(
  integerPart: string,
  fractionalPart: string,
  precision: number,
): { integerPart: string; fractionalPart: string } {
  const kept = fractionalPart.slice(0, precision);
  const dropped = fractionalPart.slice(precision);
  const firstDropped = dropped.charAt(0);

  let roundUp: boolean;
  if (firstDropped < '5') {
    roundUp = false;
  } else if (firstDropped > '5') {
    roundUp = true;
  } else {
    // The first dropped digit is exactly '5'. If anything after it is nonzero, the true
    // remainder is strictly greater than half, so round up unconditionally. Otherwise
    // this is an exact tie: round to whichever neighbour has an even last digit.
    const isExactHalf = !/[1-9]/.test(dropped.slice(1));
    if (!isExactHalf) {
      roundUp = true;
    } else {
      const lastKeptDigit = precision > 0 ? kept.charAt(precision - 1) : integerPart.charAt(integerPart.length - 1);
      const lastKeptIsOdd = (lastKeptDigit.charCodeAt(0) - 48) % 2 === 1;
      roundUp = lastKeptIsOdd;
    }
  }

  if (!roundUp) {
    return { integerPart, fractionalPart: kept };
  }

  const incremented = incrementDecimalString(integerPart + kept);
  // A carry out of the very top digit ("999" -> "1000") grows the string by one digit;
  // that extra digit belongs to the integer part.
  const growth = incremented.length - (integerPart.length + kept.length);
  const newIntegerLength = integerPart.length + growth;
  return {
    integerPart: incremented.slice(0, newIntegerLength),
    fractionalPart: incremented.slice(newIntegerLength),
  };
}

/** Add exactly 1 to a non-negative decimal digit string, propagating carry by hand. */
function incrementDecimalString(digits: string): string {
  const chars = digits.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    const digit = chars[i];
    if (digit === undefined) break;
    if (digit === '9') {
      chars[i] = '0';
    } else {
      chars[i] = String.fromCharCode(digit.charCodeAt(0) + 1);
      return chars.join('');
    }
  }
  return '1' + chars.join('');
}
