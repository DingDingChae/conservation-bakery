/**
 * Preload bridge.
 *
 * The renderer runs sandboxed, context-isolated, with no Node integration. This is the
 * only surface it can reach the rest of the application through, and it exposes exactly
 * the four operations in the IPC contract — no generic channel, no `invoke` passthrough.
 * A renderer compromised by a malformed data file still cannot do anything the control
 * room itself could not do.
 *
 * This file is `.cts` on purpose: a sandboxed preload must be CommonJS, and `.cts` is
 * how TypeScript emits a `.cjs` alongside an otherwise ESM package. The CommonJS import
 * form below is required by `verbatimModuleSyntax`.
 */

import electron = require('electron');

import type {
  Command,
  CommandResult,
  ProvenanceNode,
  RendererApi,
  WorldSnapshot,
} from '../shared/ipc.js';

// Duplicated rather than imported: pulling the constant across would make this CommonJS
// file depend on an ESM module at runtime. The contract test in ipc.spec.ts asserts
// these strings still match the source of truth, so the duplication cannot drift.
const CHANNELS = {
  snapshotRequest: 'sim:snapshot:request',
  snapshotPush: 'sim:snapshot:push',
  command: 'sim:command',
  provenance: 'sim:provenance',
} as const;

const api: RendererApi = {
  getSnapshot: () =>
    electron.ipcRenderer.invoke(CHANNELS.snapshotRequest) as Promise<WorldSnapshot>,

  onSnapshot: (listener: (snapshot: WorldSnapshot) => void) => {
    const handler = (_event: unknown, snapshot: WorldSnapshot): void => listener(snapshot);
    electron.ipcRenderer.on(CHANNELS.snapshotPush, handler);
    return () => {
      electron.ipcRenderer.removeListener(CHANNELS.snapshotPush, handler);
    };
  },

  send: (command: Command) =>
    electron.ipcRenderer.invoke(CHANNELS.command, command) as Promise<CommandResult>,

  getProvenance: (lotId: string) =>
    electron.ipcRenderer.invoke(CHANNELS.provenance, lotId) as Promise<ProvenanceNode>,
};

electron.contextBridge.exposeInMainWorld('bakery', api);
