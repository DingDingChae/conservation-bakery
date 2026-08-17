# Captures

Real screenshots of the real application, taken with Win32 `PrintWindow` against a live
Electron window running on an off-screen Windows desktop. Nothing here is a mock-up, a
design comp, or a rendering of markup outside the app.

Every capture below was taken from one continuous session of the built application
driven by real background mouse clicks. The simulation was running throughout — the tick
counter advances between shots, and the balance panel is reading live ledger state, not
placeholder data.

| Capture | What it shows |
| --- | --- |
| `01-control-room.png` | The control room on load. Header clock and tick counter, speed control, annunciator reading no active alarms, navigation rail, the settings surface, and the balance panel listing every conserved commodity at residual `0`. |
| `02-deck-oven-faceplate.png` | The deck oven faceplate reached by clicking the navigation rail. Commissioning state and run hours, two alarms with their priority and the tick they were raised, the mode selector, a setpoint-versus-process-value readout with engineering range and tolerance status, and a setpoint entry. |
| `03-kid-register.png` | The same running world in the Kid register. Identical simulation, identical state — "tick" becomes "step", the annunciator becomes "anything need checking?", and zero residual becomes "everything adds up — nothing left over, nothing missing". |
| `04-cantonese-kid-register.png` | The same world again in Cantonese, Kid register, switched live without a reload. |

## What these captures do not show

Being honest about the gaps is the point of keeping this file.

- **The command palette.** `Ctrl+Shift+F` could not be exercised in these runs. Chromium
  ignores synthetic key messages posted to an unfocused window, so background keyboard
  injection cannot reach it on an off-screen desktop. The palette's matching, ranking and
  regex behaviour are covered by unit tests, but no capture proves the dialog opens in the
  real application.
- **The provenance tree.** Not captured in this session.
- **Machine labels in Cantonese.** Visible in `04`: "Mixing bowl" and "Deck oven" remain
  English, because machine labels arrive as data on the world snapshot rather than as
  catalogue keys. That is a real gap, not a rendering artefact.
- **A long session.** These were taken minutes after launch. Nothing here demonstrates
  stability over hours.
- **Light scheme.** Every capture is the dark scheme, which is what the off-screen desktop
  resolved to.
