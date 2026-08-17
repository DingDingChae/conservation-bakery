/**
 * Public entry point for `renderer/i18n`. Whoever builds `RendererContext.t` (the
 * renderer shell) imports `createTranslate` from here and nothing else in this
 * directory — the four catalogue files and `translate`/`rawLookup`'s internals are
 * this module's own concern, not something a panel should import directly.
 */

export type { Catalogue, CatalogueKey, InterpolationValues } from './catalogue.js';
export { CATALOGUE_KEYS, createTranslate, interpolate, translate } from './catalogue.js';
