/**
 * Generic "poll a check function until it reports a real value or a
 * timeout elapses" loop — extracted after the third near-identical
 * hand-rolled version of this exact shape showed up in this codebase
 * (process-control.ts's waitForAppRunning, docker-tool.ts's
 * ensureDockerDaemonRunning, and the terminal-command exit-code
 * detection in macos/launcher.ts's openTerminal) — past the point
 * where sharing one implementation is reuse, not premature
 * abstraction. `check` returns `undefined` to mean "not ready yet,
 * keep polling" — any other value (including falsy ones like `false`
 * or `0`) ends the loop immediately, so a caller whose real "found it"
 * value could itself be falsy should wrap it (e.g. `{ found: true }`)
 * rather than relying on truthiness.
 */
export async function pollUntil<T>(
  check: () => Promise<T | undefined>,
  options: { intervalMs: number; timeoutMs: number },
): Promise<{ value: T | undefined; elapsedMs: number }> {
  const startedAt = Date.now();

  for (;;) {
    const value = await check();
    if (value !== undefined) {
      return { value, elapsedMs: Date.now() - startedAt };
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= options.timeoutMs) {
      return { value: undefined, elapsedMs: elapsed };
    }
    await sleep(Math.min(options.intervalMs, options.timeoutMs - elapsed));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
