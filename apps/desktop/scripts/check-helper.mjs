// Manual macOS check for the native wl-helper (WCs/WC__window-tracking.md,
// Stage 2 plan section 9) — the Swift side has no automated tests, so
// this drives the real binary against real apps on a real Mac:
//
//   npm run build:helper -w apps/desktop
//   node apps/desktop/scripts/check-helper.mjs
//
// Read-only checks first (trust, Finder's windows), then one full
// round trip on TextEdit with a throwaway document: capture the new
// window, read its state, focus it, close it, confirm it's gone, and
// quit TextEdit again — only if it wasn't already running, so nothing
// of the user's is touched. Run from a terminal that has Accessibility
// access: the helper inherits its parent's grant.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const helperPath = join(dirname(fileURLToPath(import.meta.url)), '../native/build/wl-helper');
const TEXTEDIT = 'com.apple.TextEdit';
let failures = 0;

function report(label, ok, detail) {
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`,
  );
}

const trust = JSON.parse(execFileSync(helperPath, ['trust'], { encoding: 'utf8' }));
report('trust mode answers', typeof trust.trusted === 'boolean', trust);
if (!trust.trusted) {
  console.log('This terminal has no Accessibility access — grant it, then rerun.');
  process.exit(1);
}

const helper = spawn(helperPath, ['serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: helper.stdout });
const waiting = new Map();
let nextId = 1;
let ready;
const readyPromise = new Promise((resolve) => (ready = resolve));
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.event === 'ready') return ready(message);
  waiting.get(message.id)?.(message);
  waiting.delete(message.id);
});

function call(method, params) {
  const id = nextId++;
  helper.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  return new Promise((resolve) => waiting.set(id, resolve));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readyEvent = await readyPromise;
report('serve announces ready with protocol 1', readyEvent.protocolVersion === 1, readyEvent);

const finder = await call('isRunning', { bundleId: 'com.apple.finder' });
report('isRunning finds Finder', finder.ok && finder.result.running, finder.result);

const finderWindows = await call('listWindows', { bundleId: 'com.apple.finder' });
report(
  'listWindows returns Finder windows with ids',
  finderWindows.ok && finderWindows.result.every((w) => w.windowId > 0),
  finderWindows.ok ? `${finderWindows.result.length} window(s)` : finderWindows.error,
);

const rejected = await call('listWindows', { bundleId: 'x"; rm -rf ~' });
report('rejects a malformed bundle id', !rejected.ok && rejected.error.code === 'invalid-params');

const textEditWasRunning = (await call('isRunning', { bundleId: TEXTEDIT })).result.running;
const before = await call('listWindows', { bundleId: TEXTEDIT });
const dir = mkdtempSync(join(tmpdir(), 'wl-helper-check-'));
const doc = join(dir, 'wl-helper-check.txt');
writeFileSync(doc, 'wl-helper check — safe to close.\n');
execFileSync('/usr/bin/open', ['-a', 'TextEdit', doc]);

const captured = await call('captureNewWindow', {
  bundleId: TEXTEDIT,
  before: before.result.map((w) => w.windowId),
  timeoutMs: 10000,
});
report(
  'captureNewWindow catches the new TextEdit window',
  captured.ok,
  captured.result ?? captured.error,
);

if (captured.ok) {
  const { pid, windowId } = captured.result;
  const state = await call('windowState', { pid, windowId });
  report('windowState: alive', state.ok && state.result.state === 'alive', state.result);

  const focus = await call('focusWindow', { pid, windowId });
  report(
    'focusWindow activates TextEdit',
    focus.ok && focus.result.activated,
    focus.result ?? focus.error,
  );

  const close = await call('closeWindow', { pid, windowId });
  report(
    'closeWindow closes it',
    close.ok && close.result.outcome === 'closed',
    close.result ?? close.error,
  );

  const after = await call('windowState', { pid, windowId });
  report('windowState: gone after close', after.ok && after.result.state === 'gone', after.result);

  const again = await call('closeWindow', { pid, windowId });
  report(
    'closing again reports already-gone',
    again.ok && again.result.outcome === 'already-gone',
    again.result,
  );

  if (!textEditWasRunning) {
    await sleep(300);
    const quit = await call('quitApp', { pid });
    report(
      'quitApp quits TextEdit',
      quit.ok && quit.result.outcome === 'quit',
      quit.result ?? quit.error,
    );
  } else {
    console.log('SKIP  quitApp — TextEdit was already running before this check');
  }
}

rmSync(dir, { recursive: true, force: true });
helper.stdin.end();
const exitCode = await new Promise((resolve) => helper.on('exit', resolve));
report('exits on stdin EOF', exitCode === 0, { exitCode });

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
