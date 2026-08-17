/**
 * The control room layout: composes every piece this task owns (header, nav rail, main
 * area, the always-visible balance panel, settings, the fault surface) with every panel
 * a sibling task built (`faceplate`, `provenance/balance`, `provenance/tree`,
 * `palette`), entirely through `RendererContext` — this module never imports a
 * panel's internals, only its published `Panel` factory.
 *
 * ## Screen switching and `reveal()`
 *
 * The main area shows exactly one of: a machine's faceplate, the ancestry (provenance
 * tree) screen, or Settings — tracked here as a `ScreenId` (`shell/logic.ts`), never
 * inferred from the DOM. This module registers its own `registerRevealHandler` so a
 * `reveal()` call that names something not on the currently-active screen (a tag on a
 * machine you are not looking at, a lot while you are on Settings) first switches the
 * main area to the right screen, then re-issues the same `reveal()` once so the panel
 * that was *just* mounted — which registers its own, more specific reveal handler
 * synchronously during its own mount — gets a chance to handle the rest (focusing a
 * specific tag, alarm, or lot). This mirrors exactly what `context.ts`'s own doc
 * comment describes reveal for: "how the command palette teleports without knowing how
 * any panel is laid out." This module's own reveal handler therefore always returns
 * `false` — it never claims to have *fully* handled a target, only to have made the
 * right screen available — and `main.ts`'s `reveal()` tries every registered handler a
 * second time after the first pass, so a target that needed a screen switch first gets
 * a real second chance at the newly-mounted panel's own, more specific handler.
 *
 * The fault surface (`fault.ts`) is owned and mounted by `main.ts`, not by this module
 * — it has to exist, and has to be able to report a fault, from the moment the very
 * first `getSnapshot()`/`send()` call is made, which is before this module's `root` is
 * even built. This module only lays the shell out; it never handles the fault case.
 *
 * ## Why the faceplate and the palette are remounted on a register/language change,
 * and the balance panel and the provenance tree are not
 *
 * `provenance/balance.ts` and `provenance/tree.ts` both already subscribe to
 * `context.onPreferences` and re-render their own copy — remounting them here would
 * needlessly discard real state (the ancestry screen's currently-loaded lot). The
 * faceplate (`faceplate/render.ts`) and the command palette (`palette/palette.ts`) do
 * not subscribe to `onPreferences` at all (checked directly against their source before
 * writing this file) — their static copy would otherwise go stale the moment a player
 * flips the register or language toggle live, which is exactly the requirement this
 * task's brief calls out by name. Remounting them from the current snapshot is a
 * correct substitute: `CLAUDE.md`'s "without losing state" refers to the *simulation*
 * world, which a remount never touches — only the DOM subtree and each panel's own
 * ephemeral view cache (e.g. the faceplate's trend history) are rebuilt, from the
 * exact same live data.
 */

import type { WorldSnapshot } from '../../shared/ipc.js';
import type { Disposable, RendererContext, RevealTarget } from '../context.js';
import { mountProvenanceBalance } from '../provenance/balance.js';
import { mountProvenanceTree } from '../provenance/tree.js';
import { createFaceplatePanel } from '../faceplate/index.js';
import { mountPalette } from '../palette/palette.js';
import { el } from '../kit/dom.js';
import { mountHeader } from './header.js';
import { mountNavRail } from './navRail.js';
import { mountSettings } from './settings.js';
import { screenEquals, screenForRevealTarget, type ScreenId } from './logic.js';

function defaultScreen(snapshot: WorldSnapshot | null): ScreenId {
  const first = snapshot?.machines[0];
  return first ? { kind: 'machine', machineId: first.id } : { kind: 'settings' };
}

export function mountShell(root: HTMLElement, context: RendererContext): Disposable {
  const shellRoot = el('div', { class: 'cb-shell' });
  const headerSlot = el('div', { class: 'cb-shell__header-slot' });
  const body = el('div', { class: 'cb-shell__body' });
  const navSlot = el('div', { class: 'cb-shell__nav-slot' });
  const mainSlot = el('main', { class: 'cb-shell__main-slot', attrs: { id: 'shell-main', tabindex: '-1' } });
  const asideSlot = el('aside', { class: 'cb-shell__aside-slot', attrs: { 'aria-label': 'balance' } });
  body.append(navSlot, mainSlot, asideSlot);
  shellRoot.append(headerSlot, body);
  root.append(shellRoot);

  const disposeHeader = mountHeader(headerSlot, context);
  const disposeBalance = mountProvenanceBalance(asideSlot, context);

  let currentScreen: ScreenId = defaultScreen(context.snapshot());
  let disposeMainPanel: Disposable | null = null;

  function mountScreen(screen: ScreenId): void {
    disposeMainPanel?.();
    mainSlot.replaceChildren();
    currentScreen = screen;
    navRail.setActive(screen);
    if (screen.kind === 'machine') {
      disposeMainPanel = createFaceplatePanel(screen.machineId)(mainSlot, context);
    } else if (screen.kind === 'provenance-tree') {
      disposeMainPanel = mountProvenanceTree(mainSlot, context);
    } else {
      disposeMainPanel = mountSettings(mainSlot, context);
    }
  }

  const navRail = mountNavRail(
    navSlot,
    context,
    (screen) => {
      if (!screenEquals(screen, currentScreen)) mountScreen(screen);
    },
    () => asideSlot.scrollIntoView({ block: 'nearest' }),
  );

  mountScreen(currentScreen);

  // --- reveal(): switch screens for a target the active screen cannot handle itself ---
  // Always returns `false` — see the module doc comment for why full credit for
  // handling a `tag`/`alarm`/`lot` target belongs to the panel that gets (re)mounted
  // here, tried again by `main.ts`'s second reveal pass, not to this handler.
  const unregisterReveal = context.registerRevealHandler((target: RevealTarget) => {
    const screen = screenForRevealTarget(target);
    if (!screen || screenEquals(screen, currentScreen)) return false;
    mountScreen(screen);
    return false;
  });

  let disposePalette = mountPalette(root, context);

  // --- Retranslate the pieces that do not self-update on a preference change ---
  const unsubscribePreferences = context.onPreferences(() => {
    if (currentScreen.kind === 'machine') mountScreen(currentScreen);
    // The palette is a hidden <dialog> until opened, so remounting it on a preference
    // change is cheap and never visible mid-interaction — see the module doc comment.
    disposePalette();
    disposePalette = mountPalette(root, context);
  });

  return () => {
    unsubscribePreferences();
    unregisterReveal();
    disposeMainPanel?.();
    navRail.dispose();
    disposeBalance();
    disposeHeader();
    disposePalette();
    shellRoot.remove();
  };
}
