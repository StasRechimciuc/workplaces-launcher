import { describe, expect, it, vi } from 'vitest';
import { get } from 'node:http';
import { OAUTH_CALLBACK_PORT, runLoopbackAuth } from './oauth-server';

function requestCallback(port: number, query: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${port}/callback${query}`, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on('error', reject);
  });
}

// Every test below passes 0 explicitly — an OS-assigned ephemeral port
// — rather than relying on the default OAUTH_CALLBACK_PORT. Real usage
// always binds that one fixed port (required by the Spotify dashboard's
// own redirect-URI form — see oauth-server.ts's doc comment), but
// hardcoding it here would make these tests collide with each other
// (and with a real `npm run dev` instance) if the OS hasn't released the
// port yet between runs.
describe('runLoopbackAuth', () => {
  it('resolves with the code once a matching-state callback arrives', async () => {
    const { port, result } = runLoopbackAuth('expected-state', 0);
    const assignedPort = await port;

    await requestCallback(assignedPort, '?code=auth-code-123&state=expected-state');

    await expect(result).resolves.toEqual({ code: 'auth-code-123' });
  });

  it('rejects on a mismatched state parameter (CSRF guard)', async () => {
    const { port, result } = runLoopbackAuth('expected-state', 0);
    // Attach the rejection assertion before the request is even sent —
    // the server rejects `result` synchronously while handling the
    // request, so attaching it only after `await requestCallback`
    // resolves leaves a window where Node flags the rejection as
    // unhandled before this test's own handler is in place.
    const assertion = expect(result).rejects.toThrow(/mismatched state/);
    const assignedPort = await port;

    await requestCallback(assignedPort, '?code=auth-code-123&state=wrong-state');

    await assertion;
  });

  it('rejects when Spotify reports the user denied consent', async () => {
    const { port, result } = runLoopbackAuth('expected-state', 0);
    const assertion = expect(result).rejects.toThrow(/denied/);
    const assignedPort = await port;

    await requestCallback(assignedPort, '?error=access_denied&state=expected-state');

    await assertion;
  });

  it('rejects after the 5-minute timeout if no callback ever arrives', async () => {
    vi.useFakeTimers();
    try {
      const { result } = runLoopbackAuth('expected-state', 0);
      const assertion = expect(result).rejects.toThrow(/Timed out/);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() called before the server finishes starting rejects both port and result, instead of leaving port pending forever', async () => {
    const { port, result, cancel } = runLoopbackAuth('expected-state', 0);
    // server.listen()'s 'listening' callback is always asynchronous, so
    // calling cancel() synchronously here reliably runs first — this is
    // exactly the bug this guards: port previously had no reject path
    // at all, so a pre-'listening' failure/cancel left `await port`
    // hanging forever.
    cancel();

    await expect(port).rejects.toThrow();
    await expect(result).rejects.toThrow(/cancelled/);
  });

  it('cancel() after a successful exchange is a harmless no-op', async () => {
    const { port, result, cancel } = runLoopbackAuth('expected-state', 0);
    const assignedPort = await port;

    await requestCallback(assignedPort, '?code=auth-code-123&state=expected-state');
    await expect(result).resolves.toEqual({ code: 'auth-code-123' });

    expect(() => cancel()).not.toThrow();
  });

  it('binds OAUTH_CALLBACK_PORT by default when no port override is given', async () => {
    const { port, cancel } = runLoopbackAuth('expected-state');
    try {
      await expect(port).resolves.toBe(OAUTH_CALLBACK_PORT);
    } finally {
      cancel();
    }
  });
});
