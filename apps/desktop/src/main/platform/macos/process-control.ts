import { runCommand } from '../../lib/shell-exec';

/**
 * Workspace activity tracking's two macOS-only primitives (see
 * WCs/WC__workspace-activity.md) — deliberately outside the
 * PlatformLauncher interface, same scope-cut precedent as the generic
 * 'app' step type (app-tool.ts): there's no Windows equivalent, and
 * forcing a stub onto that interface for a feature that never runs
 * there would be worse than keeping it a separate, directly-called
 * module.
 *
 * Both go through `osascript`, by app NAME, never a PID — PID tracking
 * was researched and ruled out: macOS's `open -a` is a broker that
 * exits immediately and never hands back the launched app's real PID,
 * and polling for one is racy (see the tracker file's research notes).
 *
 * `appName` is NEVER interpolated into the AppleScript source text —
 * it's passed as a real `argv` entry to an `on run argv` handler
 * instead. Interpolating it (the original version of this file did)
 * is a real AppleScript-injection vulnerability, not just a
 * theoretical one: a crafted name like
 * `X" & (do shell script "...") & "` breaks out of the string literal
 * and runs arbitrary shell commands with this app's own privileges —
 * confirmed by actually triggering it in a security review of this
 * feature. `appName` ultimately comes from a workspace config's step
 * params (`tool-identity.ts`'s `getMacAppName`, for the generic 'app'
 * type `appDisplayName(params.path)`), which is NOT trustworthy input:
 * a hand-edited, imported, or synced config file can set it to
 * anything, and `listWorkspaces()` calls `isAppRunning` for every
 * config's app names on every app launch, not just ones the user
 * actively restores. Passing it as an argv value makes it impossible
 * to break out of the script regardless of its contents.
 */

const OSASCRIPT_TIMEOUT_MS = 5000;

/**
 * Whether an app with this exact name is currently running — app-level
 * only, not per-window. Two steps that both map to the same app name
 * (e.g. two VS Code projects) are indistinguishable here; this is the
 * known, documented v1 limitation for VS Code (WCs/WC__workspace-activity.md),
 * not a bug.
 */
export async function isAppRunning(appName: string): Promise<boolean> {
  const result = await runCommand(
    'osascript',
    ['-e', 'on run argv', '-e', 'return application (item 1 of argv) is running', '-e', 'end run', appName],
    { timeoutMs: OSASCRIPT_TIMEOUT_MS },
  );
  return result.success && result.stdout.trim() === 'true';
}

/**
 * Asks an app to quit gracefully, by name — never a force-kill. This
 * respects the app's own unsaved-changes prompts (e.g. VS Code), which
 * is a safety property, not a drawback: a workspace switch should
 * never silently discard unsaved work.
 */
export async function quitApp(appName: string): Promise<{ success: boolean; message: string }> {
  const result = await runCommand(
    'osascript',
    ['-e', 'on run argv', '-e', 'tell application (item 1 of argv) to quit', '-e', 'end run', appName],
    { timeoutMs: OSASCRIPT_TIMEOUT_MS },
  );
  return result.success
    ? { success: true, message: `Quit ${appName}.` }
    : { success: false, message: `Could not quit ${appName}: ${result.message}` };
}

/** How often waitForAppRunning re-checks isAppRunning while polling. */
export const APP_LAUNCH_POLL_INTERVAL_MS = 200;

/**
 * Hard cap on how long waitForAppRunning will poll before giving up.
 * Generous (2 minutes) because this is never on the restore's critical
 * path — it runs detached, after the step has already succeeded and
 * its result already returned, purely to improve a future *display*
 * measurement (see orchestrator.ts's runStep). There's no user-facing
 * cost to waiting longer, only the cost of an orphaned timer if an
 * app's name never matches (e.g. the generic 'app' step type's known
 * name-derivation limitation) — this cap exists for that, not to
 * protect restore speed.
 */
export const APP_LAUNCH_POLL_TIMEOUT_MS = 120_000;

/**
 * Polls isAppRunning(appName) until it reports true or the timeout
 * elapses. Never throws: a timeout means "we couldn't get a timing
 * sample," never a failure to report — the step this is measuring has
 * already succeeded by the time this runs.
 */
export async function waitForAppRunning(
  appName: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<{ detected: boolean; elapsedMs: number }> {
  const intervalMs = options.intervalMs ?? APP_LAUNCH_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? APP_LAUNCH_POLL_TIMEOUT_MS;
  const startedAt = Date.now();

  for (;;) {
    if (await isAppRunning(appName)) {
      return { detected: true, elapsedMs: Date.now() - startedAt };
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      return { detected: false, elapsedMs: elapsed };
    }
    await sleep(Math.min(intervalMs, timeoutMs - elapsed));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
