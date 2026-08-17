/**
 * WCAG 2.x relative-luminance contrast math, implemented from the spec
 * formula rather than pulled in as a dependency (this package adds none).
 *
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

/** A colour category, which selects the WCAG AA threshold that applies to it. */
export type ContrastCategory = 'body' | 'large' | 'nontext';

/**
 * AA thresholds. Body text needs 4.5:1; large text (>=24px, or >=19px bold)
 * and non-text UI indicators (borders, focus rings, state fills that must be
 * distinguishable from their surroundings) need 3:1.
 */
export const AA_THRESHOLD: Readonly<Record<ContrastCategory, number>> = {
  body: 4.5,
  large: 3,
  nontext: 3,
};

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Parses a `#rrggbb` or `#rgb` hex colour into 0-255 channel values. */
export function parseHexColor(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`not a hex colour: ${hex}`);
  }
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

/** One 0-255 sRGB channel to its linear-light value, per the WCAG formula. */
function linearize(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a hex colour, in [0, 1]. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * WCAG contrast ratio between two colours, in [1, 21]. Order of the two
 * arguments does not matter — the formula always divides the lighter
 * luminance by the darker.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** True if `ratio` clears the AA threshold for `category`. */
export function meetsAA(ratio: number, category: ContrastCategory): boolean {
  return ratio >= AA_THRESHOLD[category];
}
