// A scripted stand-in for native/wl-helper, spawned as a real child
// process by wl-helper-client.test.ts — the client is tested against
// real pipes, real process exits and real chunking, not a mocked
// ChildProcess.
//
//   node fake-wl-helper.mjs <scenario> [counterFile] [crashStarts]
//
// Scenarios:
//   normal       ready, then answers per method (see respond below)
//   bad-version  announces protocol version 99
//   never-ready  stays alive, never writes anything
//   flaky-start  exits 1 on its first <crashStarts> starts (counted in
//                <counterFile>), then behaves like `normal`
//
// `normal` methods: echo (result = params), pid (result = process.pid),
// fail (helper error 'not-found'), slow (answers after params.delayMs),
// block (holds the whole process for params.delayMs, then answers —
// like the real helper's serial main thread mid-capture),
// crash (exits 3 without answering), silent (never answers), garbage
// (a junk line, then the answer), split (the answer written in two
// chunks), batch (the answer and a stray unknown-id response in one
// chunk), malformed (a well-formed line that isn't a valid response),
// watchApp (answers, then pushes one app-changed event for that bundle).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [scenario, counterFile, crashStarts] = process.argv.slice(2);

function send(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`);
}

if (scenario === 'flaky-start') {
  const starts = existsSync(counterFile) ? Number(readFileSync(counterFile, 'utf8')) : 0;
  writeFileSync(counterFile, String(starts + 1));
  if (starts < Number(crashStarts)) {
    process.exit(1);
  }
}

if (scenario === 'never-ready') {
  setInterval(() => {}, 1000);
} else {
  send({ event: 'ready', protocolVersion: scenario === 'bad-version' ? 99 : 2, pid: process.pid });
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const request = JSON.parse(line);
  respond(request);
});
rl.on('close', () => process.exit(0));

function respond({ id, method, params }) {
  switch (method) {
    case 'echo':
      return send({ id, ok: true, result: params });
    case 'pid':
      return send({ id, ok: true, result: process.pid });
    case 'fail':
      return send({ id, ok: false, error: { code: 'not-found', message: 'no such window' } });
    case 'slow':
      return setTimeout(() => send({ id, ok: true, result: 'late' }), params.delayMs);
    case 'block': {
      const until = Date.now() + params.delayMs;
      while (Date.now() < until);
      return send({ id, ok: true, result: 'unblocked' });
    }
    case 'crash':
      return process.exit(3);
    case 'silent':
      return;
    case 'garbage':
      process.stdout.write('this is not json\n');
      return send({ id, ok: true, result: 'after-garbage' });
    case 'split': {
      const text = `${JSON.stringify({ id, ok: true, result: 'joined' })}\n`;
      process.stdout.write(text.slice(0, 7));
      return setTimeout(() => process.stdout.write(text.slice(7)), 50);
    }
    case 'batch':
      return process.stdout.write(
        `${JSON.stringify({ id: 99999, ok: true, result: 'stray' })}\n${JSON.stringify({ id, ok: true, result: 'batched' })}\n`,
      );
    case 'malformed':
      return send({ id, ok: 'yes' });
    case 'watchApp':
      send({ id, ok: true, result: { watching: true, pids: [4242] } });
      return send({ event: 'app-changed', bundleId: params.bundleId, pid: 4242 });
    default:
      return send({ id, ok: false, error: { code: 'unknown-method', message: method } });
  }
}
