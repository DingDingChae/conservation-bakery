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

Artefacts land in `release/` at the repository root.

## The gates a release must pass

A build is not a release. All of the following must hold, and each must be *observed*
rather than assumed:

1. `npx tsc --build --force` clean.
2. The whole test suite green, including the conservation property test and the rule 2
   content sweep. Report the real count.
3. The packaged application launches and reaches the control room — not a fault surface.
   Verify by running the built artefact, not the development tree.
4. A real interaction works end to end in the packaged build: navigate to a machine
   faceplate, change a setpoint, and see the balance panel still reading zero residual.
5. Screenshots in `captures/` reflect the build being released. A stale capture of a
   screen that no longer exists is worse than no capture.
6. `captures/README.md` states honestly what the captures do *not* show.
7. The release notes say plainly that the installer is unsigned.

## Versioning

The version in `packages/app/package.json` is the released version. Nothing is published
from `0.0.0`; that value means "not released", and while it is set the README must
continue to say no release exists.
