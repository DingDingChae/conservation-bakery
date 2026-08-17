// Connects to a running Electron/Chromium instance over the Chrome DevTools
// Protocol and streams renderer console output (console.* calls, uncaught
// exceptions, and Log domain entries) to a file. This is test tooling only,
// scoped to captures/**, and does not modify any app source.
import fs from 'node:fs';

const CDP_PORT = process.argv[2] || '9333';
const OUT_PATH = process.argv[3] || 'console.log';

function fmtArg(a) {
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  if (a.description !== undefined) return a.description;
  return JSON.stringify(a);
}

async function main() {
  const out = fs.createWriteStream(OUT_PATH, { flags: 'a' });
  const write = (line) => out.write(`[${new Date().toISOString()}] ${line}\n`);

  let page;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const targets = await resp.json();
      page = targets.find((t) => t.type === 'page');
      if (page) break;
    } catch {
      // Electron may not have opened the debug port yet; retry.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!page) {
    write('CAPTURE-SCRIPT: no page target found after retries');
    process.exit(1);
  }
  write(`CAPTURE-SCRIPT: attaching to ${page.title} (${page.url})`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable' }));
    ws.send(JSON.stringify({ id: id++, method: 'Log.enable' }));
    write('CAPTURE-SCRIPT: Runtime and Log domains enabled');
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data.toString());
    } catch {
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = (msg.params.args || []).map(fmtArg).join(' ');
      write(`[console.${msg.params.type}] ${args}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      write(`[exception] ${d.text} ${d.exception ? fmtArg(d.exception) : ''} @${d.url}:${d.lineNumber}:${d.columnNumber}`);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      write(`[log.${e.level}] ${e.source}: ${e.text}`);
    }
  });
  ws.addEventListener('close', () => {
    write('CAPTURE-SCRIPT: websocket closed');
  });
  ws.addEventListener('error', (e) => {
    write(`CAPTURE-SCRIPT: websocket error ${e.message ?? e}`);
  });

  // Keep the process alive; the parent will kill it when done.
  process.stdin.resume();
}

main().catch((err) => {
  fs.appendFileSync(OUT_PATH, `CAPTURE-SCRIPT FATAL: ${err.stack || err}\n`);
  process.exit(1);
});
