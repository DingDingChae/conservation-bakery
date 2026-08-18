# Releasing

## What a release contains

Windows x64 only, for now. Two artefacts:

| Artefact | What it is |
| --- | --- |
| `Conservation Bakery-<version>-x64-unsigned.exe` | An NSIS installer. Not one-click: it asks where to install and can be pointed anywhere. Installs per-user, no administrator rights required. |
| `Conservation Bakery-<version>-x64-portable-unsigned.exe` | The same application as a single portable executable that installs nothing. |

Linux and macOS remain buildable in principle — the simulation core has no platform
dependency and the shell is ordinary Electron — but neither is built, tested, or
released today, and neither should be described as supported until one actually is.

## These installers are unsigned

This is permanent and deliberate, not an oversight awaiting a certificate.

Windows will show a SmartScreen "unknown publisher" warning when the installer runs.
That is the correct and expected behaviour for an unsigned executable, and it is not
worked around by any means: no signing, no reputation-farming, no instructions telling a
user to disable a protection.

Every signer control in `packages/app/electron-builder.yml` is explicitly cleared rather
than left to a default, so a build cannot accidentally pick up a certificate present on
whatever machine it runs on. The product makes no signature-authenticity claim anywhere,
and there is no auto-update channel, because an unverifiable update feed is worse than
none.

## Building a release locally

```
npm ci
npx tsc --build --force
node packages/app/scripts/copy-renderer-assets.mjs
npx vitest run
npx electron-builder --config packages/app/electron-builder.yml --project packages/app
```

Artefacts land in `release/` at the repository root, which is git-ignored.

`release/` and `out/` are excluded from the rule 2 content sweep, because packaging
output embeds a whole Chromium runtime including its third-party licence manifest, and
that manifest legitimately contains denied words in other people's licence text. The
sweep polices what this product says, not what its runtime's dependencies say. Every
authored file is still swept, `packages/app/build` included. The order of the commands
above therefore no longer matters to the result.

`packages/app/electron-builder.yml`'s `files` entry explicitly copies
`packages/data` into the package as `node_modules/@conservation-bakery/data`.
This is not optional decoration: `packages/sim/src/substance/registry.ts`
and `packages/sim/src/bake/catalog.ts` both read substance and cake data
from that path at run time via a relative-directory assumption, not a
package import, so electron-builder's automatic dependency walk (which
found `@conservation-bakery/sim` and `@conservation-bakery/design` because
`packages/app/package.json` actually depends on them) never discovers it
needs to include `@conservation-bakery/data` too. Omitting it does not fail
the build — it fails the *running application*, silently: the simulation
worker throws `ENOENT ... node_modules/@conservation-bakery/data/substances`
during startup, the fault reaches the renderer, and the control room never
gets past "waiting for the bakery's first update" followed by the
transport-loss notice. This was caught only by actually launching the
packaged build on a real desktop and watching what it did — the build
itself reports no error at all when this file set is wrong.

## The gates a release must pass

A build is not a release. All of the following must hold, and each must be *observed*
rather than assumed:

1. `npx tsc --build --force` clean.
2. The whole test suite green, including the conservation property test and the rule 2
   content sweep. Report the real count. Run this before packaging — see the note above
   on why `release/` existing changes the result of the content sweep.
3. The packaged application launches and reaches the control room — not a fault surface.
   Verify by running the built artefact, not the development tree. "The build succeeded"
   is not evidence of this: a missing runtime data directory (see above) packages
   cleanly and only fails once the application actually runs, so this gate means
   launching the real `.exe` and watching it, every time, not just checking `files` in
   the config looks plausible.
4. A real interaction works end to end in the packaged build: navigate to a machine
   faceplate, change a setpoint, and see the balance panel still reading zero residual.
5. Screenshots in `captures/` reflect the build being released. A stale capture of a
   screen that no longer exists is worse than no capture.
6. `captures/README.md` states honestly what the captures do *not* show.
7. The release notes say plainly that the installer is unsigned, and that claim is
   itself verified, not assumed from the config: PowerShell's
   `Get-AuthenticodeSignature -FilePath <exe>` on both artefacts must report
   `Status: NotSigned`, since `signAndEditExecutable: false` alone is a build-time
   instruction, not proof of the artefact actually produced.

## Versioning

The version in `packages/app/package.json` is the released version. Nothing is published
from `0.0.0`; that value means "not released", and while it is set the README must
continue to say no release exists.
