# Captures

Real screenshots of the real, **packaged** application (electron-builder's `win-unpacked`
output, copied to a temporary directory outside the repository and launched from there —
never the development tree), taken with Win32 `PrintWindow` against a live Electron
window running on an off-screen Windows desktop. Nothing here is a mock-up, a design
comp, or a rendering of markup outside the app.

Every capture below was taken from one continuous session of the built 0.1.0 application
driven by real background mouse clicks, after `packages/app/electron-builder.yml` was
fixed to actually include `@conservation-bakery/data` in the package (see
[`docs/RELEASE.md`](../docs/RELEASE.md) for what broke without it, and how that was
found — the packaged build launched and reported nothing wrong at package time; only
running it showed the fault). The simulation was running throughout — the tick counter
advances between shots, and the balance panel is reading live ledger state, not
placeholder data.

| Capture | What it shows |
| --- | --- |
| `01-control-room.png` | The control room on load, Panel register, English. Header clock and tick counter, speed control, annunciator reading no active alarms, navigation rail, the settings surface, and the balance panel listing every conserved commodity — cash and every tracked element and energy unit — at residual `0`. |
| `02-deck-oven-faceplate.png` | The deck oven faceplate reached by clicking the navigation rail. Commissioning state and run hours, two alarms with their priority and the tick they were raised, the mode selector, three setpoint-versus-process-value readouts with engineering range and tolerance status, and a setpoint entry — with the balance panel, at the tick shown, still reading zero residual across every commodity. |
| `03-kid-register.png` | The same running world in the Kid register, English. "tick" becomes "step", the annunciator becomes "anything need checking?", and zero residual becomes "everything adds up — nothing left over, nothing missing". |
| `04-cantonese-kid-register.png` | The same world again in Cantonese, Kid register, switched live without a reload. |

## How these were taken

1. `npx electron-builder --config packages/app/electron-builder.yml --project packages/app`
   from the repository root, producing `release/win-unpacked/`.
2. The whole `win-unpacked` directory copied to a temporary directory under the current
   Windows user's `%TEMP%` — a location outside the repository and outside the npm
   workspace, so nothing here is quietly running against source files or workspace
   symlinks.
3. An off-screen Windows desktop created for this session only; `Conservation Bakery.exe`
   launched on it directly (never on the visible desktop); windows resolved at run time
   via `list_headless_windows`, never a hard-coded handle.
4. Every click is a real Win32 background click (`PostMessage`, not `SetForegroundWindow`)
   against the resolved window handle; every screenshot is a real `PrintWindow` capture
   of that handle.
5. The temporary directory, the off-screen desktop, and every process launched on it were
   all torn down at the end of the session — nothing here is a still-running leftover.

## What these captures do not show

Being honest about the gaps is the point of keeping this file.

- **The command palette.** `Ctrl+Shift+F` could not be exercised in this session either.
  Chromium ignores synthetic key messages posted to an unfocused window, so background
  keyboard injection cannot reach it on an off-screen desktop — this is a limitation of
  driving the app without ever touching the visible desktop, not something observed about
  the palette itself. The palette's matching, ranking and regex behaviour are covered by
  unit tests, but no capture proves the dialog opens in the real, packaged application.
- **The provenance tree.** Not captured in this session.
- **Machine labels in Cantonese.** Visible in `04`: "Flour mill", "Deck oven" and similar
  remain English, because machine labels arrive as data on the world snapshot rather than
  as catalogue keys. That is a real gap, not a rendering artefact.
- **The NSIS installer's actual install flow.** These captures are of the extracted
  `win-unpacked` build, which is byte-for-byte what the installer places on a machine, but
  the installer's own UI (the "choose a directory" dialog, the SmartScreen warning) was
  not driven or captured here.
- **A long session.** These were taken minutes after launch, across a handful of tick
  counts in the tens. Nothing here demonstrates stability over hours.
- **Light scheme.** Every capture is the dark scheme, which is what the off-screen desktop
  resolved to.
- **Linux or macOS.** Only a Windows x64 build exists; see
  [`docs/RELEASE.md`](../docs/RELEASE.md).
