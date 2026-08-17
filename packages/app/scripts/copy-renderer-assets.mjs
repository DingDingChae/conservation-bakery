#!/usr/bin/env node
/**
 * Copies every static asset under `src/renderer` — `index.html` and every component's
 * own `.css` file — to the matching path under `dist/renderer`, after `tsc --build`
 * has already emitted the JavaScript for everything else.
 *
 * `tsc` only ever emits `.js`/`.d.ts`/`.map` for the TypeScript it compiles; it has no
 * idea `index.html` or `palette/palette.css` exist, so without this step the renderer
 * would ship real, working JavaScript with nothing that could ever load it — see
 * `renderer/index.html`'s own comment on this. There is no bundler installed in this
 * repository and this task may not add one, so this is a plain recursive `fs` copy
 * using only Node's built-in modules — no new dependency, nothing fancier than the job
 * needs. Run via `npm run build` (see this package's `package.json`), never on its own
 * against a stale `dist/`.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', 'src', 'renderer');
const distRoot = join(here, '..', 'dist', 'renderer');

/** Everything `tsc` itself already produces a build artefact for, or that is source
 * material never meant to ship (a spec file, a dotfile). Anything else under
 * `src/renderer` — currently just `.html` and `.css` — is copied verbatim. */
const SKIP_EXTENSIONS = new Set(['.ts', '.cts', '.map']);

function copyStaticAssets(srcDir, distDir) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const srcPath = join(srcDir, entry.name);
    const distPath = join(distDir, entry.name);

    if (entry.isDirectory()) {
      copyStaticAssets(srcPath, distPath);
      continue;
    }
    if (entry.name.endsWith('.spec.ts') || SKIP_EXTENSIONS.has(extname(entry.name))) continue;

    mkdirSync(distDir, { recursive: true });
    copyFileSync(srcPath, distPath);
  }
}

copyStaticAssets(srcRoot, distRoot);
