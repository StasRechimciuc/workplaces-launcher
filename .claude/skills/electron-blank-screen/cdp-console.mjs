#!/usr/bin/env node
// Connects to a running Electron app's remote-debugging port, reloads
// its first page target, and prints every console message and uncaught
// exception for a few seconds — including ones that happen too early
// for a normal DevTools session to catch. Requires Node 20+ (native
// WebSocket). See SKILL.md in this folder for when/why to use this.
//
// Usage: node cdp-console.mjs [port] [captureMs]
//   port      remote-debugging-port to connect to (default 9223)
//   captureMs how long to listen after reloading (default 6000)

const port = Number(process.argv[2] ?? 9223);
const captureMs = Number(process.argv[3] ?? 6000);

const targets = await fetch(`http://localhost:${port}/json`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error(`No inspectable "page" target on port ${port}. Targets found:`, targets);
  process.exit(1);
}
console.error(`Attaching to: ${page.title} (${page.url})`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
const messages = [];

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  ws.send(JSON.stringify({ id: 2, method: 'Log.enable' }));
  ws.send(JSON.stringify({ id: 3, method: 'Page.enable' }));
  ws.send(JSON.stringify({ id: 4, method: 'Page.reload', params: { ignoreCache: true } }));
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    messages.push({ type: 'exception', detail: msg.params.exceptionDetails });
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    messages.push({
      type: 'console.' + msg.params.type,
      args: msg.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a)),
    });
  } else if (msg.method === 'Log.entryAdded') {
    messages.push({
      type: 'log.' + msg.params.entry.level,
      text: msg.params.entry.text,
      url: msg.params.entry.url,
    });
  }
});

setTimeout(() => {
  console.log(JSON.stringify(messages, null, 2));
  process.exit(0);
}, captureMs);
