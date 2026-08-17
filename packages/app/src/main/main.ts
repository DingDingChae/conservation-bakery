/**
 * Main process.
 *
 * Responsibilities, and deliberately nothing else: own the window, own the simulation
 * worker, and broker the declared IPC contract between them. No simulation logic lives
 * here — the seam in CLAUDE.md says the renderer observes state and never owns it, and
 * the same discipline applies to this process.
 */

import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { IPC, type Command, type CommandResult, type FaultReport } from '../shared/ipc.js';
import { SimulationHost } from './simulationHost.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let window: BrowserWindow | null = null;
let host: SimulationHost | null = null;

/**
 * Only one instance may run. Two windows over one save file would each believe they
 * held canonical state, and the one that wrote last would silently win.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16130f' : '#f3ece1',
    title: 'Conservation Bakery',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // The renderer loads only local files and has no reason to reach the network.
      // Nothing in this product phones home.
      devTools: !app.isPackaged,
    },
  });

  // Show only once the first frame is painted, so the window never flashes an
  // unstyled control room at the player.
  created.once('ready-to-show', () => created.show());

  // Any attempt to open external content leaves the app entirely rather than
  // navigating the control room somewhere unexpected.
  created.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  created.webContents.on('will-navigate', (event) => event.preventDefault());

  void created.loadFile(path.join(here, '../renderer/index.html'));
  return created;
}

app.whenReady().then(() => {
  window = createWindow();

  host = new SimulationHost();
  host.on('snapshot', (snapshot) => {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC.snapshotPush, snapshot);
    }
  });
  // Forward real faults. Previously nothing did, so the renderer had to infer trouble
  // from snapshots going quiet — which meant a busy machine looked exactly like a
  // conservation failure. A fault is now told, never guessed.
  host.on('fault', (message) => {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC.faultPush, {
        kind: 'conservation',
        message,
        tick: host?.snapshot()?.tick ?? 0,
      } satisfies FaultReport);
    }
  });

  host.start();

  ipcMain.handle(IPC.snapshotRequest, () => host?.snapshot() ?? null);

  ipcMain.handle(IPC.command, async (_event, command: Command): Promise<CommandResult> => {
    if (!host) return { accepted: false, reason: 'The simulation is not running.' };
    return host.send(command);
  });

  ipcMain.handle(IPC.provenance, async (_event, lotId: string) => {
    if (!host) return null;
    return host.provenance(lotId);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) window = createWindow();
  });
});

app.on('window-all-closed', () => {
  host?.stop();
  host = null;
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  host?.stop();
  host = null;
});
