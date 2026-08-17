/**
 * The machine faceplate — public surface.
 *
 * `faceplatePanel` is a `Panel` per `renderer/context.ts` that shows the first
 * machine in the current snapshot and follows a `reveal({ kind: 'machine' })`
 * request to any other one. `createFaceplatePanel(machineId)` is the factory for a
 * screen that already knows which machine it owns.
 *
 * See `render.ts` for the DOM and `logic.ts` for the pure, tested formatting,
 * validation, mode-legality and alarm-ordering rules it is built from.
 */
export { createFaceplatePanel, faceplatePanel } from './render.js';
