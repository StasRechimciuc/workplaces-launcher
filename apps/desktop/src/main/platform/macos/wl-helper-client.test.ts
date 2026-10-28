import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WlHelperClient, type WlHelperClientOptions } from './wl-helper-client';

// Every test drives a real spawned child (test-fixtures/fake-wl-helper.mjs)
// over real pipes — see that file for the scripted scenarios and the
// "methods" it answers. The fake's method names aren't part of the
// real HelperMethods table, hence the loosely typed `call` below.
const FAKE = join(__dirname, 'test-fixtures', 'fake-wl-helper.mjs');

const clients: WlHelperClient[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  clients.splice(0).forEach((c) => c.dispose());
  tempDirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function makeClient(
  scenarioArgs: string[],
  overrides: Partial<WlHelperClientOptions> = {},
): { client: WlHelperClient; logs: string[] } {
  const logs: string[] = [];
  const client = new WlHelperClient({
    command: process.execPath,
    args: [FAKE, ...scenarioArgs],
    initialBackoffMs: 20,
    maxBackoffMs: 100,
    log: (m) => logs.push(m),
    ...overrides,
  });
  clients.push(client);
  return { client, logs };
}

function call(
  client: WlHelperClient,
  method: string,
  params: object = {},
  timeoutMs?: number,
): ReturnType<WlHelperClient['request']> {
  return client.request(method as 'listWindows', params as { bundleId: string }, {
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('WlHelperClient', () => {
  it('spawns lazily and resolves a result matched by id', async () => {
    const { client } = makeClient(['normal']);
    await expect(call(client, 'echo', { bundleId: 'com.apple.finder' })).resolves.toEqual({
      ok: true,
      result: { bundleId: 'com.apple.finder' },
    });
  });

  it('matches concurrent requests to their own responses, whatever order they arrive in', async () => {
    const { client } = makeClient(['normal']);
    const slow = call(client, 'slow', { delayMs: 150 });
    const fast = call(client, 'echo', { n: 2 });
    await expect(fast).resolves.toEqual({ ok: true, result: { n: 2 } });
    await expect(slow).resolves.toEqual({ ok: true, result: 'late' });
  });

  it('passes helper-reported errors through unchanged', async () => {
    const { client, logs } = makeClient(['normal']);
    await expect(call(client, 'fail')).resolves.toEqual({
      ok: false,
      error: { code: 'not-found', message: 'no such window' },
    });
    expect(logs).toEqual([]);
  });

  it('reassembles a response split across chunks', async () => {
    const { client } = makeClient(['normal']);
    await expect(call(client, 'split')).resolves.toEqual({ ok: true, result: 'joined' });
  });

  it('handles several lines in one chunk and logs a response for no pending request', async () => {
    const { client, logs } = makeClient(['normal']);
    await expect(call(client, 'batch')).resolves.toEqual({ ok: true, result: 'batched' });
    expect(logs.some((l) => l.includes('id 99999'))).toBe(true);
  });

  it('logs unparseable output loudly but keeps serving', async () => {
    const { client, logs } = makeClient(['normal']);
    await expect(call(client, 'garbage')).resolves.toEqual({ ok: true, result: 'after-garbage' });
    expect(logs.some((l) => l.includes('this is not json'))).toBe(true);
  });

  it('turns a well-formed but invalid response into a protocol error', async () => {
    const { client } = makeClient(['normal']);
    const response = await call(client, 'malformed');
    expect(response.ok).toBe(false);
    expect(!response.ok && response.error.code).toBe('protocol');
  });

  it('times a request out and drops its late answer', async () => {
    const { client, logs } = makeClient(['normal']);
    const response = await call(client, 'slow', { delayMs: 300 }, 100);
    expect(response).toEqual({
      ok: false,
      error: { code: 'timeout', message: expect.stringContaining('within 100ms') },
    });
    // The helper is still usable, and the late answer never reaches anyone.
    await expect(call(client, 'echo', { n: 1 })).resolves.toEqual({ ok: true, result: { n: 1 } });
    await waitFor(() => logs.some((l) => l.includes('no pending request')));
  });

  it('gives helper-side waits their own time plus a margin before timing out', async () => {
    const { client } = makeClient(['normal'], { defaultTimeoutMs: 100 });
    // waitMs 300 → client timeout 2300ms, so a 250ms answer arrives in time.
    await expect(call(client, 'slow', { delayMs: 250, waitMs: 300 })).resolves.toEqual({
      ok: true,
      result: 'late',
    });
  });

  it('fails in-flight requests on a crash without retrying them, then restarts', async () => {
    const { client, logs } = makeClient(['normal']);
    const firstPid = await call(client, 'pid');
    const crashed = await call(client, 'crash');
    expect(crashed).toEqual({
      ok: false,
      error: { code: 'crashed', message: expect.stringContaining('code 3') },
    });
    const secondPid = await call(client, 'pid');
    expect(secondPid.ok && firstPid.ok && secondPid.result !== firstPid.result).toBe(true);
    expect(logs.some((l) => l.includes('restarting in'))).toBe(true);
  });

  it('keeps requests made during the restart backoff queued until the new helper is ready', async () => {
    const { client } = makeClient(['normal'], { initialBackoffMs: 200 });
    await call(client, 'crash');
    await expect(call(client, 'echo', { queued: true })).resolves.toEqual({
      ok: true,
      result: { queued: true },
    });
  });

  it('backs off exponentially across repeated start-up crashes, then recovers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wl-helper-test-'));
    tempDirs.push(dir);
    const counter = join(dir, 'starts');
    const { client, logs } = makeClient(['flaky-start', counter, '3']);
    await expect(call(client, 'echo', { ok: 1 }, 3000)).resolves.toEqual({
      ok: true,
      result: { ok: 1 },
    });
    expect(readFileSync(counter, 'utf8')).toBe('4');
    const delays = logs
      .map((l) => /restarting in (\d+)ms/.exec(l)?.[1])
      .filter((d): d is string => d !== undefined)
      .map(Number);
    expect(delays).toEqual([20, 40, 80]);
  });

  it('kills and restarts a helper that never reports ready', async () => {
    const { client, logs } = makeClient(['never-ready'], { startTimeoutMs: 100 });
    const response = await call(client, 'echo', {}, 400);
    expect(!response.ok && response.error.code).toBe('timeout');
    expect(logs.some((l) => l.includes('no ready signal'))).toBe(true);
  });

  it('restarts a helper that swallows several requests in a row', async () => {
    const { client, logs } = makeClient(['normal'], { hungAfterTimeouts: 2 });
    const firstPid = await call(client, 'pid');
    await Promise.all([call(client, 'silent', {}, 100), call(client, 'silent', {}, 100)]);
    await waitFor(() => logs.some((l) => l.includes('presuming it hung')));
    const secondPid = await call(client, 'pid');
    expect(secondPid.ok && firstPid.ok && secondPid.result !== firstPid.result).toBe(true);
  });

  it('refuses a helper speaking a different protocol version, permanently', async () => {
    const { client } = makeClient(['bad-version']);
    const first = await call(client, 'echo');
    expect(!first.ok && first.error).toEqual({
      code: 'unavailable',
      message: expect.stringContaining('protocol 99'),
    });
    const second = await call(client, 'echo');
    expect(!second.ok && second.error.code).toBe('unavailable');
  });

  it('reports a missing binary as unavailable instead of retrying forever', async () => {
    const { client, logs } = makeClient([], { command: '/nonexistent/wl-helper' });
    const response = await call(client, 'echo');
    expect(!response.ok && response.error).toEqual({
      code: 'unavailable',
      message: expect.stringContaining('ENOENT'),
    });
    expect(logs.some((l) => l.includes('restarting'))).toBe(false);
  });

  it('on dispose fails pending requests and the helper exits on stdin EOF', async () => {
    const { client } = makeClient(['normal']);
    const pid = await call(client, 'pid');
    if (!pid.ok) throw new Error('fake helper did not report its pid');
    const helperPid = pid.result as unknown as number;
    const pending = call(client, 'silent', {}, 5000);
    client.dispose();
    expect(await pending).toEqual({
      ok: false,
      error: { code: 'unavailable', message: expect.stringContaining('shut down') },
    });
    await waitFor(() => !isAlive(helperPid));
    const after = await call(client, 'echo');
    expect(!after.ok && after.error.code).toBe('unavailable');
  });
});
