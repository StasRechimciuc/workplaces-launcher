import { randomUUID } from 'node:crypto';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shell } from 'electron';
import type { PlatformLauncher, PlatformResult } from '../types';
import type { TerminalCommandResult, TerminalEntryResult } from '@workspace-launcher/shared';
import { runCommand } from '../../lib/shell-exec';
import { expandHome } from '../../lib/paths';
import { pollUntil } from '../../lib/poll-until';

/**
 * Safe to embed in a single-quoted shell string — the only quoting
 * context any dynamic text in openTerminal's generated script is ever
 * placed into (never re-embedded into a second, differently-quoted
 * context — that mismatch was a real bug here once, see openTerminal's
 * own comment on it).
 */
function singleQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** How often openTerminal re-checks the sentinel file for a command's
 * exit code while waiting to see if it failed near-instantly. */
export const TERMINAL_COMMAND_POLL_INTERVAL_MS = 250;

/**
 * How long openTerminal waits, after the terminal opens, for a near-
 * instant command failure (a typo, a missing config file, a port
 * already in use) before giving up and treating the step as
 * successful. Deliberately short: a genuinely long-running process
 * (a dev server, `tilt up`'s live-reload loop) is NEVER expected to
 * exit at all, so "nothing failed within this window" is already the
 * correct, expected signal for the common case — this window only
 * exists to catch the fast-failure case, not to wait out a slow boot.
 * 2.5s comfortably covers the near-instant failures this exists for
 * (argument-parsing/bind() failures are sub-second) while staying well
 * under the point this would feel like added restore latency.
 */
export const TERMINAL_COMMAND_POLL_TIMEOUT_MS = 2_500;

/**
 * How long openTerminal waits for the generated script to even START
 * running, before applying TERMINAL_COMMAND_POLL_TIMEOUT_MS's own
 * budget to watch for a near-instant command failure. This exists
 * because `open -a Terminal <script>` returning says nothing about
 * when Terminal.app actually gets around to opening a window and
 * starting the shell — measured directly (real `open -a Terminal`,
 * Terminal.app already running): ~2.1s of pure launch/window-creation
 * overhead before the script's first line even runs. That overhead
 * used to eat directly into TERMINAL_COMMAND_POLL_TIMEOUT_MS's budget
 * (both were counted from the same `open` return), which is exactly
 * why a real, sub-second `docker compose up` failure (no compose file
 * present) was sometimes reported as success: the 2.5s budget was
 * mostly already spent before the command had even started. 8s is
 * generous specifically to cover a COLD Terminal.app launch (slower
 * than the warm case measured above), not because this phase itself
 * is expected to take anywhere near that long.
 */
export const TERMINAL_SCRIPT_START_TIMEOUT_MS = 8_000;

const SENTINEL_LINE_RE = /^(cd|\d+):(-?\d+)$/;

/**
 * Splits sentinel/output-log content into only its COMPLETE lines — the
 * script is actively appending to these files while they're read, so a
 * read mid-`echo`/mid-`tee` can catch a trailing partial line; dropping
 * whatever follows the last `\n` is always safe, since a genuinely
 * complete line is never the one being dropped and an incomplete one
 * will simply be re-read whole (or appear complete) on the next poll.
 */
function completeLines(content: string): string[] {
  return content.split('\n').slice(0, -1);
}

/**
 * Finds the first FAILING (nonzero exit code) line already written to
 * the sentinel.
 */
function findFirstSentinelFailure(
  content: string,
): { label: string; exitCode: number } | undefined {
  for (const line of completeLines(content)) {
    const match = SENTINEL_LINE_RE.exec(line.trim());
    if (!match) continue;
    const exitCode = Number(match[2]);
    if (exitCode !== 0) {
      return { label: match[1]!, exitCode };
    }
  }
  return undefined;
}

/**
 * Parses every command's exit code out of the full sentinel content
 * (not just the first failure) — used once a failure has already been
 * decided, to build the complete per-command success/failed/not-run
 * breakdown for the UI (a command with no line at all never got its
 * turn — either an earlier command in the sequence failed first, or
 * the whole entry never started).
 */
function parseCommandExitCodes(sentinelContent: string): Map<number, number> {
  const codes = new Map<number, number>();
  for (const line of completeLines(sentinelContent)) {
    const match = /^(\d+):(-?\d+)$/.exec(line.trim());
    if (match) codes.set(Number(match[1]), Number(match[2]));
  }
  return codes;
}

/** Cap on how much of a failed command's captured output feeds into
 * its `reason` — keeps StepResult.details small; the FULL output is
 * still visible in the real (still-open) terminal window regardless,
 * this is only for the structured summary shown in the restore-results
 * UI without having to go find that window. */
const COMMAND_OUTPUT_TAIL_MAX_CHARS = 2000;

/**
 * Extracts one command's captured stdout+stderr out of the shared
 * output log (every command's output goes into the SAME file,
 * delimited by a `###OUT:<index>###` marker written right before each
 * command runs — append order is write order, so a marker's own
 * content is simply "everything up to the next marker, or EOF").
 */
function extractCommandOutput(outputLogContent: string, index: number): string | undefined {
  const marker = `###OUT:${index}###`;
  const start = outputLogContent.indexOf(marker);
  if (start === -1) return undefined;
  const afterMarker = start + marker.length;
  const nextMarkerIndex = outputLogContent.indexOf('###OUT:', afterMarker);
  const chunk = outputLogContent
    .slice(afterMarker, nextMarkerIndex === -1 ? undefined : nextMarkerIndex)
    .trim();
  if (chunk.length === 0) return undefined;
  return chunk.length > COMMAND_OUTPUT_TAIL_MAX_CHARS
    ? `…${chunk.slice(-COMMAND_OUTPUT_TAIL_MAX_CHARS)}`
    : chunk;
}

/**
 * Builds the full per-command breakdown once a real command failure
 * (not a cd/open failure) has already been decided — every configured
 * command gets a status: 'success' for an exit-0 line, 'failed' (with
 * exit code + captured-output reason) for the one that actually broke,
 * 'not-run' for one with no sentinel line at all (sequential execution
 * means that's always a command after the failure, never before it).
 */
function buildCommandResults(
  commands: string[],
  sentinelContent: string,
  outputLogContent: string | undefined,
): TerminalCommandResult[] {
  const exitCodes = parseCommandExitCodes(sentinelContent);
  return commands.map((command, index): TerminalCommandResult => {
    const exitCode = exitCodes.get(index);
    if (exitCode === undefined) {
      return { index, command, status: 'not-run' };
    }
    if (exitCode === 0) {
      return { index, command, status: 'success' };
    }
    const reason =
      (outputLogContent && extractCommandOutput(outputLogContent, index)) ||
      `Exited with code ${exitCode} (no output captured).`;
    return { index, command, status: 'failed', exitCode, reason };
  });
}

/** Every configured command marked 'not-run' — used for the "terminal
 * never got going at all" failure paths (the OS-level launch itself
 * failing, or the script's own `cd` fallback), where nothing in
 * `commands` ever had a chance to execute. */
function allNotRun(commands: string[]): TerminalCommandResult[] {
  return commands.map((command, index) => ({ index, command, status: 'not-run' as const }));
}

/**
 * `PlatformResult.detail` is deliberately typed `Record<string, unknown>`
 * (see its own doc comment) so every other platform method that never
 * sets it isn't forced to import a terminal-specific type — but a
 * concrete interface like TerminalEntryResult has no index signature,
 * so TypeScript won't structurally accept it there without a cast. Safe
 * here: `detail` is only ever read back by narrowing it against a
 * matching StepResult.code (same pattern as shared's own
 * asTerminalFailureDetail), never trusted as arbitrary unknown data.
 */
function toDetail(entry: TerminalEntryResult): Record<string, unknown> {
  return entry as unknown as Record<string, unknown>;
}

/**
 * How long openTerminal waits for a terminal with zero configured
 * commands — the `cd` into the configured directory is the only thing
 * that can still fail for one (a race between this file's own earlier
 * `stat()` check and the generated script actually running, or a
 * permissions change in between). A `cd` failure happens essentially
 * synchronously at script start, so this only needs to be long enough
 * to catch that — unlike TERMINAL_COMMAND_POLL_TIMEOUT_MS, which also
 * has to cover an arbitrary command's own startup time.
 */
export const TERMINAL_CD_ONLY_POLL_TIMEOUT_MS = 500;

/**
 * Waits for the sentinel file openTerminal's generated script writes
 * to, to see whether the `cd` into the configured directory, or any
 * configured command, died near-instantly — a shorter window
 * (TERMINAL_CD_ONLY_POLL_TIMEOUT_MS) for a terminal with zero commands
 * configured, since only the `cd` can fail for one; the full
 * TERMINAL_COMMAND_POLL_TIMEOUT_MS otherwise. Does NOT delete the
 * sentinel itself (unlike an earlier version of this function) —
 * openTerminal needs to read it a second time after this resolves, to
 * build the full per-command breakdown, so cleanup is now its job,
 * after that second read.
 */
async function readSentinelSafely(sentinelPath: string): Promise<string> {
  try {
    return await readFile(sentinelPath, 'utf-8');
  } catch (err) {
    // ENOENT (not written yet, the expected/common case while a
    // command is still running) means "keep waiting" — anything else
    // (EACCES, EMFILE, a flaky disk) is a real I/O problem that must
    // not be silently treated as "no failure observed yet," which
    // this function's callers would otherwise read as a plain,
    // unqualified success.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw err;
  }
}

async function waitForEarlyCommandFailure(
  sentinelPath: string,
  commandCount: number,
  pollOptions: { intervalMs?: number; timeoutMs?: number; startTimeoutMs?: number } = {},
): Promise<{ label: string; exitCode: number } | undefined> {
  const intervalMs = pollOptions.intervalMs ?? TERMINAL_COMMAND_POLL_INTERVAL_MS;

  // Phase 1: wait for the script to write ANYTHING at all. Its very
  // first line ("started," written before `cd`/any command — see the
  // script template below) is the only reliable signal that
  // Terminal.app has actually gotten around to running it — see
  // TERMINAL_SCRIPT_START_TIMEOUT_MS's own doc comment for why this
  // can't just be folded into phase 2's budget below.
  const { value: hasStarted } = await pollUntil(
    async () => ((await readSentinelSafely(sentinelPath)).length > 0 ? true : undefined),
    { intervalMs, timeoutMs: pollOptions.startTimeoutMs ?? TERMINAL_SCRIPT_START_TIMEOUT_MS },
  );
  if (!hasStarted) return undefined; // never even started — nothing to report as a failure

  // Phase 2: the script is confirmed alive — NOW the short, real
  // budget for "did the configured command fail near-instantly" is
  // measured from an honest starting point. If a failure is already
  // in the file (likely, since reading it is what proved phase 1
  // done), this resolves on its very first check below, no added
  // delay.
  const defaultTimeoutMs =
    commandCount === 0 ? TERMINAL_CD_ONLY_POLL_TIMEOUT_MS : TERMINAL_COMMAND_POLL_TIMEOUT_MS;
  const { value } = await pollUntil(
    async () => findFirstSentinelFailure(await readSentinelSafely(sentinelPath)) ?? undefined,
    { intervalMs, timeoutMs: pollOptions.timeoutMs ?? defaultTimeoutMs },
  );
  return value;
}

/**
 * macOS implementation of PlatformLauncher, via `open -a`
 * (docs/architecture.md #1). All methods shell out through
 * lib/shell-exec.ts's runCommand — argv arrays only, shell:false — so
 * an app name or path coming from workspace config data can never be
 * interpreted as shell syntax, no matter what it contains.
 */
export const macosLauncher: PlatformLauncher = {
  async launchApp(appName): Promise<PlatformResult> {
    const result = await runCommand('open', ['-a', appName]);
    if (result.success) {
      return { success: true, message: `Launched ${appName}.` };
    }
    return { success: false, message: `Failed to launch ${appName}: ${result.message}` };
  },

  async openInApp(appName, targetPath): Promise<PlatformResult> {
    const result = await runCommand('open', ['-a', appName, targetPath]);
    if (result.success) {
      return { success: true, message: `Opened ${targetPath} in ${appName}.` };
    }
    return {
      success: false,
      message: `Failed to open ${targetPath} in ${appName}: ${result.message}`,
    };
  },

  async openUrlInBrowserProfile(browser, profile, url): Promise<PlatformResult> {
    // `--args` hands everything after it to the launched app itself,
    // not to `open`. `--profile-directory` is Chrome's (and other
    // Chromium-based browsers') flag for selecting a profile by its
    // on-disk directory name (e.g. "Default", "Profile 1") — NOT the
    // human-readable name shown in the browser's UI (e.g. "Work").
    // Resolving a friendly name to its directory (reading the
    // browser's `Local State` file) isn't implemented yet — callers
    // must pass the actual directory name for now.
    //
    // `url` is optional: a profile-only launch (no specific tab to
    // open) still needs --profile-directory so the right profile's
    // window opens, but there's nothing else to hand off after it.
    //
    // `-n` is required, not optional flourish: macOS's `open -a` only
    // delivers `--args` argv to the app at the moment it actually
    // spawns a new process. If the browser is already running (the
    // common case — most people leave Chrome open), `open -a` just
    // activates the existing process and both --profile-directory and
    // the URL are silently dropped, never reaching Chrome at all —
    // confirmed live (`open -a` alone did nothing with Chrome already
    // running; adding `-n` opened the URL correctly). `-n` forces a
    // genuinely new process every time, which is how Chrome is
    // designed to be driven per-profile from the CLI regardless of
    // whether it's already open; on a cold start (nothing running yet)
    // it behaves identically to a plain launch.
    const args = ['-n', '-a', browser, '--args', `--profile-directory=${profile}`];
    if (url !== undefined) {
      args.push(url);
    }
    const result = await runCommand('open', args);

    if (url === undefined) {
      if (result.success) {
        return { success: true, message: `Opened ${browser} (profile: ${profile}).` };
      }
      return {
        success: false,
        message: `Failed to open ${browser} (profile: ${profile}): ${result.message}`,
      };
    }

    if (result.success) {
      return { success: true, message: `Opened ${url} in ${browser} (profile: ${profile}).` };
    }
    return {
      success: false,
      message: `Failed to open ${url} in ${browser}: ${result.message}`,
    };
  },

  // The third parameter isn't part of the PlatformLauncher interface —
  // it's a test-only seam (same precedent as docker-tool.ts's
  // ensureDockerDaemonRunning) letting tests override the exit-code
  // poll's interval/timeout instead of waiting out the real ~2.5s
  // window; every real caller goes through the interface type, which
  // never exposes this parameter, so it's always omitted in production.
  async openTerminal(
    cwd,
    commands,
    commandPollOptions?: { intervalMs?: number; timeoutMs?: number; startTimeoutMs?: number },
  ): Promise<PlatformResult> {
    const expandedCwd = expandHome(cwd);
    // Every early-return below this point represents "nothing
    // configured for this entry ever got a chance to run" — same
    // meaning as the script's own `cd` fallback further down, just
    // caught one layer earlier (by this file's own pre-checks, or by
    // `open -a Terminal`/writeFile itself). All of them get the same
    // `openFailed: { stage: 'open', ... }` detail shape, distinguishing
    // only in the human `reason` text, not in how the UI treats them.
    const notStarted = (stage: 'open' | 'cd', reason: string): Record<string, unknown> =>
      toDetail({
        cwd: expandedCwd,
        openFailed: { stage, reason },
        commands: allNotRun(commands),
      });

    try {
      const dirStat = await stat(expandedCwd);
      if (!dirStat.isDirectory()) {
        // A directory problem, not a Terminal.app problem — 'cd', even
        // though no window ever actually opened (we return before
        // `open -a Terminal` is ever called): the UI's fix advice for
        // this should point at the path, not at reinstalling Terminal.
        const message = `"${cwd}" is not a directory.`;
        return { success: false, message, detail: notStarted('cd', message) };
      }
    } catch {
      const message = `"${cwd}" doesn't exist.`;
      return { success: false, message, detail: notStarted('cd', message) };
    }

    // Deliberately NOT AppleScript (`do script`) — embedding dynamic
    // content into an AppleScript string is a real, two-layer escaping
    // problem (AppleScript-string escaping, then shell-interpretation
    // of whatever ends up typed into the terminal), confirmed during
    // this feature's own planning to be a genuine, non-theoretical risk
    // class. Instead: a plain Node fs.writeFile writes an executable
    // `.command` script — inert bytes, no interpretation at all — and
    // `open -a Terminal` (the same `open`-based, argv-only mechanism
    // every other method here already uses) hands it to Terminal the
    // same way a double-click would. This also means no macOS
    // Automation/TCC permission prompt is ever triggered (`open` is a
    // Launch Services request, not an Apple Event).
    //
    // `-a Terminal` is explicit, not left to Launch Services' default
    // `.command` handler — matching every other call in this file's own
    // explicit `-a <app>` convention, and avoiding a real silent-wrong-
    // outcome risk: a user who has ever rebound `.command`/`.sh` files
    // to open in a text editor instead of running them would otherwise
    // get an `open` call that exits 0 ("success") while doing something
    // entirely different from what this step promises.
    const safeCwd = singleQuote(expandedCwd);
    const id = randomUUID();
    const scriptPath = join(tmpdir(), `workspace-launcher-terminal-${id}.command`);
    // Same uuid as the script, different extension — ties the two
    // together for anyone finding one in the temp dir, and reuses this
    // file's own established `workspace-launcher-<purpose>-<uuid>.<ext>`
    // temp-file naming convention (also used by app-icon.ts).
    const sentinelPath = join(tmpdir(), `workspace-launcher-terminal-${id}.status`);
    const safeSentinel = singleQuote(sentinelPath);
    // A SHARED log, not one file per command — every command's output
    // goes into this same file, each preceded by its own `###OUT:<i>###`
    // marker line; append order is write order, so one command's chunk
    // is simply "everything after its marker, up to the next marker or
    // EOF" (see extractCommandOutput). One file keeps temp-file count
    // bounded regardless of how many commands a terminal entry has.
    const outputLogPath = join(tmpdir(), `workspace-launcher-terminal-${id}.out`);
    const safeOutputLog = singleQuote(outputLogPath);
    const lines = [
      '#!/bin/zsh -l',
      // Self-deletes immediately — the interpreter already has the
      // file open by the time this runs, so unlinking it doesn't
      // disturb execution. Required, not optional: without it, every
      // restore leaves a new script behind in the temp dir forever.
      'rm -f -- "$0"',
      // The ONLY reliable "the script is actually running now" signal
      // — written before anything else (even `clear`), so it's always
      // the sentinel's first line whenever the script gets this far at
      // all. See waitForEarlyCommandFailure's phase 1 / this file's own
      // TERMINAL_SCRIPT_START_TIMEOUT_MS doc comment for why this
      // exists as its own marker rather than inferring "started" from
      // the `cd`/command lines' own sentinel writes.
      `echo "started" >> ${safeSentinel}`,
      // Terminal.app's own behavior when it opens a .command file (via
      // `open -a Terminal`, same as a double-click) — not anything this
      // script controls — is to visibly "type" the script's full path
      // plus a trailing `; exit` into a fresh shell before running it.
      // Wiping that noisy preamble here is purely cosmetic (the window
      // stays open and interactive regardless, since `exec "$SHELL" -l`
      // below replaces the process before that trailing `exit` could
      // ever act on it) — it just means the user sees a clean prompt
      // instead of their own temp file's path first.
      'clear',
      // A failed `cd` is as real a failure as any command dying — it
      // now writes its own sentinel line (label "cd") instead of only
      // being visible as text in a terminal window nothing is reading.
      `cd ${safeCwd} || { echo "cd into the configured directory failed."; echo "cd:1" >> ${safeSentinel}; exec "$SHELL" -l; }`,
      // Each command is echoed as its own, separately-escaped
      // `echo '$ <command>'` line before it actually runs — a plain
      // shell script never echoes its own commands by default, so
      // without this there'd be no visible indication of what's
      // running before its output starts. The echoed text is embedded
      // into its OWN single-quoted string via the same singleQuote()
      // helper as cwd above — never the same escaped string reused for
      // two different quoting contexts, which is exactly the mixed-
      // context bug a prior version of this file had elsewhere. The
      // command's own execution line stays completely verbatim and
      // unescaped — it's meant to run exactly as the user typed it, in
      // their own real shell. It's wrapped in a `{ ...; }` GROUP (not a
      // subshell — still the same shell, `$?` still means what it
      // normally would), with the sentinel write happening INSIDE that
      // group, immediately after the command, before the group's own
      // combined output is piped through `tee -a` so a copy also lands
      // in the shared output log (tee duplicates the stream to the live
      // terminal window too, it doesn't redirect it away). This is
      // deliberately NOT `command 2>&1 | tee -a log; echo "$?"` reading
      // `$pipestatus[1]` — that only correctly names the real command's
      // own exit code when `command` itself contains no pipe of its
      // own; the moment a configured command is itself e.g. `npm run
      // build | tee build.log`, the outer tee wrapping turns it into a
      // multi-stage pipeline and `pipestatus[1]` stops meaning what this
      // comment used to claim it does (a real bug, caught in review).
      // Capturing `$?` INSIDE the group, right after the command,
      // sidesteps this entirely — it reflects the user's own command's
      // real exit code exactly as `echo $?` typed by hand would,
      // regardless of what shell syntax the user's own command contains.
      // A command that never returns (a dev server, `tilt up`'s live-
      // reload loop — the expected, common case) simply never reaches
      // its own sentinel line, which is exactly the signal openTerminal
      // below treats as "still running, not a failure" — its output
      // keeps flowing into the log in the background regardless, which
      // is harmless (an orphaned, slowly-growing file for that
      // session's lifetime, same category of leftover this script's
      // sentinel already accepts elsewhere in this file).
      ...commands.flatMap((command, i) => [
        `echo ${singleQuote(`$ ${command}`)}`,
        `echo "###OUT:${i}###" >> ${safeOutputLog}`,
        `{ ${command}; echo "${i}:$?" >> ${safeSentinel}; } 2>&1 | tee -a ${safeOutputLog}`,
      ]),
      'exec "$SHELL" -l',
    ];

    try {
      await writeFile(scriptPath, `${lines.join('\n')}\n`, { mode: 0o755 });
    } catch (err) {
      const message = `Couldn't create the terminal script: ${(err as Error).message}`;
      return { success: false, message, detail: notStarted('open', message) };
    }

    const result = await runCommand('open', ['-a', 'Terminal', scriptPath]);
    if (!result.success) {
      const message = `Failed to open a terminal at ${cwd}: ${result.message}`;
      return { success: false, message, detail: notStarted('open', message) };
    }

    const failure = await waitForEarlyCommandFailure(
      sentinelPath,
      commands.length,
      commandPollOptions,
    );

    let detail: Record<string, unknown> | undefined;
    if (failure?.label === 'cd') {
      detail = notStarted('cd', 'Changing into the configured directory failed.');
    } else if (failure) {
      // A real command failure — read both files ONE more time (the
      // poll loop above already confirmed a failure exists; this read
      // is only to get the FULL content, for every command's status,
      // not just the one that failed) before cleaning them up.
      const [sentinelContent, outputLogContent] = await Promise.all([
        readFile(sentinelPath, 'utf-8').catch(() => ''),
        readFile(outputLogPath, 'utf-8').catch(() => undefined),
      ]);
      detail = toDetail({
        cwd: expandedCwd,
        commands: buildCommandResults(commands, sentinelContent, outputLogContent),
      });
    }
    await Promise.all([
      unlink(sentinelPath).catch(() => {}),
      unlink(outputLogPath).catch(() => {}),
    ]);

    if (failure) {
      const what =
        failure.label === 'cd'
          ? `changing into "${cwd}"`
          : `"${commands[Number(failure.label)] ?? 'a command'}"`;
      return {
        success: false,
        message: `${what} failed with exit code ${failure.exitCode} shortly after the terminal at ${cwd} opened.`,
        ...(detail ? { detail } : {}),
      };
    }
    return { success: true, message: `Opened a terminal at ${cwd}.` };
  },

  async openFileDefault(path): Promise<PlatformResult> {
    // shell.openPath's documented contract: it does NOT throw for a
    // normal "couldn't open" failure (no handler app, permissions,
    // etc.) — it resolves with '' on success, or a non-empty
    // human-readable error string on failure. Checking only for a
    // thrown exception here would silently treat every such failure as
    // success — confirmed as a real risk during this feature's own
    // planning, not a hypothetical.
    try {
      const errorMessage = await shell.openPath(path);
      if (errorMessage === '') {
        return { success: true, message: `Opened ${path}.` };
      }
      return { success: false, message: `Failed to open ${path}: ${errorMessage}` };
    } catch (err) {
      return {
        success: false,
        message: `Failed to open ${path}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async openUrlDefault(url): Promise<PlatformResult> {
    try {
      await shell.openExternal(url);
      return { success: true, message: `Opened ${url}.` };
    } catch (err) {
      return {
        success: false,
        message: `Failed to open ${url}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
