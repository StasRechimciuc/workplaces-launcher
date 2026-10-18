import { createServer } from 'node:http';

/** Covers the approved edge case of the user abandoning the browser tab
 * without finishing (denying, closing it, or just never getting back to
 * it) — without this the server would listen forever. */
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Fixed loopback callback port, registered verbatim as this app's
 * Spotify redirect URI (http://127.0.0.1:61823/callback — see auth.ts's
 * getClientId() error message). Spotify's own docs describe registering
 * a loopback redirect URI *without* a port so a dynamically-assigned one
 * can match at auth time (RFC 8252's native-app pattern) — but in
 * practice the Spotify Developer Dashboard's own "Add redirect URI" form
 * rejects a portless loopback URI outright ("This redirect URI is not
 * secure", blocks saving), while an explicit port saves and works fine.
 * A fixed port is therefore the only registration the dashboard actually
 * accepts today, documented workaround or not. Arbitrary, unprivileged,
 * in IANA's private/dynamic range (49152-65535); picked to avoid this
 * app's own other reserved port (electron.vite.config.ts's renderer dev
 * server, 58217).
 */
export const OAUTH_CALLBACK_PORT = 61823;

const CLOSE_TAB_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Workspace Launcher</title></head>
<body style="font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #444;">
  <p>Connected. You can close this tab and go back to Workspace Launcher.</p>
</body></html>`;

/**
 * Starts a one-shot loopback HTTP server on OAUTH_CALLBACK_PORT to
 * receive Spotify's OAuth redirect, and resolves with the authorization
 * code once it arrives.
 *
 * Binds 127.0.0.1 explicitly (not just the host embedded in the
 * resulting redirect URI) — binding the port alone (no host) defaults to
 * all interfaces, which would briefly expose this callback endpoint to
 * the local network, not just this machine.
 *
 * `port` defaults to the real fixed OAUTH_CALLBACK_PORT and is only ever
 * overridden by this module's own tests (passing 0 for an OS-assigned
 * ephemeral port keeps parallel/sequential test runs from colliding on
 * the one fixed port real usage always binds).
 */
export function runLoopbackAuth(
  expectedState: string,
  bindPort: number = OAUTH_CALLBACK_PORT,
): {
  port: Promise<number>;
  result: Promise<{ code: string }>;
  /** Stops listening and immediately settles both `port` (if it hasn't
   * resolved yet) and `result`, instead of leaving the server bound for
   * the full timeout. Callers must call this on any early-exit failure
   * path reached after calling runLoopbackAuth (e.g. shell.openExternal
   * rejecting) — otherwise the server lingers for AUTH_TIMEOUT_MS doing
   * nothing. A no-op if the exchange already finished on its own. */
  cancel: () => void;
} {
  let settled = false;
  let resolvePort!: (port: number) => void;
  let rejectPort!: (err: Error) => void;
  let resolveResult!: (value: { code: string }) => void;
  let rejectResult!: (err: Error) => void;

  const port = new Promise<number>((resolve, reject) => {
    resolvePort = resolve;
    rejectPort = reject;
  });
  const result = new Promise<{ code: string }>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Always marked handled from the moment it's created, independent of
  // whether a caller's own code path ever reaches `await result` — a
  // caller that bails out between creating this and consuming `result`
  // (e.g. shell.openExternal rejecting) would otherwise leave this
  // promise's eventual settle (even via cancel() below) an unhandled
  // rejection. This no-op catch doesn't affect what a real `await
  // result` elsewhere observes.
  result.catch(() => {});

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' }).end(CLOSE_TAB_HTML);

    const error = url.searchParams.get('error');
    if (error) {
      finish(() => rejectResult(new Error(`Spotify authorization was denied (${error}).`)));
      return;
    }

    const state = url.searchParams.get('state');
    if (state !== expectedState) {
      finish(() => rejectResult(new Error('Spotify authorization callback had a mismatched state parameter.')));
      return;
    }

    const code = url.searchParams.get('code');
    if (!code) {
      finish(() => rejectResult(new Error('Spotify authorization callback was missing its code parameter.')));
      return;
    }

    finish(() => resolveResult({ code }));
  });

  // Settles both `port` and `result` exactly once, whichever hasn't
  // already settled on its own — a bind/listen error or an explicit
  // cancel() can happen before `port` ever resolves, and without
  // rejecting `port` too, `await port` in auth.ts would hang forever.
  function finish(settleResult: () => void): void {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    server.close();
    rejectPort(new Error('The Spotify authorization server stopped before it finished starting.'));
    settleResult();
  }

  const timeout = setTimeout(() => {
    finish(() => rejectResult(new Error('Timed out waiting for Spotify authorization (5 minutes).')));
  }, AUTH_TIMEOUT_MS);

  server.on('error', (err) => {
    finish(() => rejectResult(err));
  });

  server.listen(bindPort, '127.0.0.1', () => {
    const address = server.address();
    // listen() always yields an AddressInfo (a numeric port), never a
    // string — the string form only occurs for a Unix socket path,
    // which this server never listens on.
    resolvePort((address as { port: number }).port);
  });

  return {
    port,
    result,
    cancel: () => finish(() => rejectResult(new Error('Spotify authorization was cancelled.'))),
  };
}
