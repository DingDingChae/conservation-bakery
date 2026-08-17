/**
 * Public TypeScript surface of `@conservation-bakery/design`.
 *
 * The design language itself lives in `tokens/*.css` and `components/*.html`
 * — plain CSS and hand-written markup with no build step, consumed directly
 * by whatever links them. This module exports the one piece of the package
 * that is genuinely code: the WCAG contrast utilities used to gate the
 * token colours (see `contrast.spec.ts`), in case another package ever
 * needs to validate a colour pair the same way.
 */

export {
  AA_THRESHOLD,
  contrastRatio,
  meetsAA,
  parseHexColor,
  relativeLuminance,
  type ContrastCategory,
} from './contrast.js';

export { extractRuleBlock, parseCustomProperties, requireVar } from './tokenFile.js';
