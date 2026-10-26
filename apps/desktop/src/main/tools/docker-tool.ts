import { z } from 'zod';
import type {
  StepResult,
  StepDisplayRow,
  ToolPlugin,
  ValidationResult,
} from '@workspace-launcher/shared';
import { ERROR_CODES, zodValidate } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';
import { runCommand } from '../lib/shell-exec';
import { expandHome, isAcceptableToolPath } from '../lib/paths';
import { pollUntil } from '../lib/poll-until';

/**
 * Minimal, local-only tokenizer for the Up/Down command text fields —
 * splits on whitespace, honoring single/double-quoted segments. NOT a
 * security boundary (runCommand's execFile/shell:false already makes
 * injection impossible regardless of what characters end up in argv) —
 * this exists purely so e.g. `-f "my file.yml"` parses as one token.
 * Returns undefined for an unmatched quote.
 */
function tokenizeCommand(command: string): string[] | undefined {
  const tokens: string[] = [];
  let i = 0;
  while (i < command.length) {
    while (i < command.length && /\s/.test(command[i]!)) i++;
    if (i >= command.length) break;
    let token = '';
    let quote: '"' | "'" | null = null;
    while (i < command.length) {
      const ch = command[i]!;
      if (quote) {
        if (ch === quote) {
          quote = null;
          i++;
          continue;
        }
        token += ch;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        i++;
        continue;
      }
      if (/\s/.test(ch)) break;
      token += ch;
      i++;
    }
    if (quote) return undefined;
    tokens.push(token);
  }
  return tokens;
}

/**
 * One Docker step: a project directory plus the two literal, already-
 * fully-formed commands that run there — pre-filled at config time
 * (renderer side, outside this file) from whichever of compose.yaml/
 * docker-compose.yml/Tiltfile was found. `engine` is set once at
 * detection time and drives WHICH mechanism runs these commands
 * (silent background vs. a visible Terminal window) — it is never
 * re-derived by sniffing the (user-editable) command text, so editing
 * upCommand's flags can never silently flip the execution mechanism.
 */
const DockerStepParamsSchema = z
  .object({
    directory: z
      .string()
      .min(1, 'directory must be a non-empty string')
      .refine(
        isAcceptableToolPath,
        'directory must be an absolute path (or start with ~) — a relative path resolves unpredictably.',
      ),
    engine: z.enum(['compose', 'tilt']),
    upCommand: z
      .string()
      .trim()
      .min(1, 'Up command must be a non-empty string')
      .refine((c) => !c.includes('\n'), 'Up command must be a single line')
      .refine((c) => tokenizeCommand(c) !== undefined, 'Up command has an unmatched quote.'),
    // Empty means "use the engine's own default at teardown time"
    // (`docker compose down` / `tilt down`) — same default-via-empty
    // precedent as TerminalStepParamsSchema's `commands` array.
    downCommand: z
      .string()
      .trim()
      .refine((c) => !c.includes('\n'), 'Down command must be a single line')
      .default(''),
    // Opt-in, default OFF — containers can hold real, expensive-to-
    // rebuild state (a database, a long build cache), so this app never
    // stops them automatically unless the user explicitly asks it to.
    stopOnClose: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.downCommand.length === 0) return;
    const tokens = tokenizeCommand(data.downCommand);
    if (!tokens) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['downCommand'],
        message: 'Down command has an unmatched quote.',
      });
      return;
    }
    // Hard constraint, not just a default — never let a saved/edited
    // Down command silently delete volumes on teardown. Matches
    // `--volumes=true`/`-v=true` too, not just the bare flag — pflag
    // (Compose's flag parser) accepts `--flag=value` for a boolean
    // flag just as much as the bare form, so checking only the exact
    // tokens would let the same effect through under a different
    // spelling.
    const hasVolumesFlag = tokens.some(
      (t) => t === '-v' || t === '--volumes' || t.startsWith('-v=') || t.startsWith('--volumes='),
    );
    if (hasVolumesFlag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['downCommand'],
        message:
          'Down command must not include -v/--volumes — Workspace Launcher never deletes Docker volumes automatically.',
      });
    }
  });

export type DockerStepParams = z.infer<typeof DockerStepParamsSchema>;

function readRawParams(params: Record<string, unknown>): {
  directory: string | undefined;
  engine: string | undefined;
  upCommand: string | undefined;
} {
  return {
    directory: typeof params['directory'] === 'string' ? params['directory'] : undefined,
    engine: typeof params['engine'] === 'string' ? params['engine'] : undefined,
    upCommand: typeof params['upCommand'] === 'string' ? params['upCommand'] : undefined,
  };
}

/**
 * Cheap pre-check before attempting any compose/tilt command — `docker
 * info` fails fast whether Docker isn't installed at all or is
 * installed but its daemon isn't running, and this tells those two
 * apart (an ENOENT-shaped failure vs. anything else) so the caller can
 * decide whether launching Docker Desktop is even worth attempting.
 * Deliberately doesn't editorialize about what to do next — that's
 * each caller's job (run() tries to launch it itself; teardown()
 * doesn't, so it tells the user to).
 */
type DockerDaemonStatus =
  | { status: 'up' }
  | { status: 'not-installed'; message: string }
  | { status: 'down'; message: string };

async function checkDockerDaemon(): Promise<DockerDaemonStatus> {
  const result = await runCommand('docker', ['info'], { timeoutMs: 8_000 });
  if (result.success) return { status: 'up' };
  if (/ENOENT|command not found/i.test(result.message)) {
    return {
      status: 'not-installed',
      message: "Docker isn't installed — install Docker Desktop and try again.",
    };
  }
  return {
    status: 'down',
    message: `Docker doesn't seem to be running (checked via "docker info"): ${result.stderr || result.message}.`,
  };
}

/** How often ensureDockerDaemonRunning re-checks the daemon while
 * waiting for a just-launched Docker Desktop to finish starting. */
export const DOCKER_LAUNCH_POLL_INTERVAL_MS = 2_000;

/**
 * Hard cap on how long ensureDockerDaemonRunning will wait for Docker
 * Desktop to finish starting — generous (90s) because a cold start
 * (especially right after a reboot) is genuinely slow, but this IS on
 * the restore's critical path (unlike process-control.ts's
 * waitForAppRunning, which runs detached after its step already
 * succeeded), so it can't be unbounded.
 */
export const DOCKER_LAUNCH_POLL_TIMEOUT_MS = 90_000;

/**
 * Closes the "no guidance when Docker/Tilt prerequisites are missing"
 * gap found during this session's own orchestration-testbed work
 * (WCs/WC__project-status.md, 2026-10-24) one step further: rather than
 * just telling the user Docker isn't running, actually launches Docker
 * Desktop (same `open -a` mechanism every other tool plugin already
 * uses to open its own app) and waits for its daemon to come up before
 * giving up — matching this app's own core pitch ("Docker's up ...
 * zero setup"), not something the user should have to do by hand every
 * single restore. Only used by run() — teardown() has nothing to wait
 * for if Docker was never running, so it still just reports the fact.
 */
export async function ensureDockerDaemonRunning(
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<{ success: true; wasAlreadyRunning: boolean } | { success: false; message: string }> {
  const initial = await checkDockerDaemon();
  if (initial.status === 'up') return { success: true, wasAlreadyRunning: true };
  if (initial.status === 'not-installed') {
    return { success: false, message: initial.message };
  }

  const launch = await getPlatformLauncher().launchApp('Docker');
  if (!launch.success) {
    return {
      success: false,
      message: `${initial.message} Tried to start Docker Desktop automatically but couldn't: ${launch.message}. Start it yourself and try again.`,
    };
  }

  const timeoutMs = options.timeoutMs ?? DOCKER_LAUNCH_POLL_TIMEOUT_MS;
  const { value } = await pollUntil(
    async () => {
      const check = await checkDockerDaemon();
      return check.status === 'up' ? true : undefined;
    },
    { intervalMs: options.intervalMs ?? DOCKER_LAUNCH_POLL_INTERVAL_MS, timeoutMs },
  );
  if (value) return { success: true, wasAlreadyRunning: false };
  return {
    success: false,
    message: `Started Docker Desktop, but its daemon didn't finish starting within ${Math.round(timeoutMs / 1000)}s. It may still be starting — try restoring again in a moment.`,
  };
}

async function runEngineCommand(
  directory: string,
  command: string,
  timeoutMs: number,
): Promise<StepResult & { durationMs: number }> {
  const startedAt = Date.now();
  const argv = tokenizeCommand(command);
  if (!argv || argv.length === 0) {
    return {
      success: false,
      message: `"${command}" couldn't be parsed — check for unmatched quotes.`,
      durationMs: Date.now() - startedAt,
      code: ERROR_CODES.DOCKER_STEP_FAILED.code,
    };
  }
  const [bin, ...args] = argv;
  const result = await runCommand(bin!, args, { cwd: directory, timeoutMs });
  if (result.success) {
    return { success: true, message: '', durationMs: Date.now() - startedAt };
  }
  return {
    success: false,
    message: `"${command}" failed: ${result.stderr || result.message}`,
    durationMs: Date.now() - startedAt,
    code: ERROR_CODES.DOCKER_STEP_FAILED.code,
  };
}

export const dockerTool: ToolPlugin<DockerStepParams> = {
  type: 'docker',

  validate(params: unknown): ValidationResult<DockerStepParams> {
    return zodValidate(DockerStepParamsSchema, params);
  },

  async run(params: DockerStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    const directory = expandHome(params.directory);

    const daemon = await ensureDockerDaemonRunning();
    if (!daemon.success) {
      return {
        success: false,
        message: daemon.message,
        durationMs: Date.now() - startedAt,
        code: ERROR_CODES.DOCKER_DAEMON_DOWN.code,
      };
    }
    // Only prefixed onto FAILURE messages below, not success ones — a
    // successful "Containers are up" already implies Docker itself was
    // fine, so saying so again would just be noise there. On a failure
    // it closes a real gap: the shared ER-TERM-01/02 headlines (reused
    // from the plain Terminal step, see their own catalog comments)
    // have no way to mention Docker specifically, so without this a
    // failed step never says whether Docker itself was ever the
    // problem — confirmed confusing in real use (a genuine compose-
    // file-not-found failure read as if Docker itself might be broken).
    const daemonNote = daemon.wasAlreadyRunning
      ? 'Docker Desktop was already running.'
      : 'Docker Desktop started successfully.';

    if (params.engine === 'tilt') {
      // Same mechanism/honesty-bar as the Terminal step — reuses
      // openTerminal unchanged, which now also catches a near-instant
      // command failure itself (see macos/launcher.ts's sentinel-file
      // exit-code detection) within a short grace window after the
      // terminal opens. Success here still doesn't mean "tilt up (or
      // whatever upCommand is) will keep running forever" — there's no
      // one-shot exit code to wait out for a genuinely long-running,
      // interactive process — but it now DOES mean "didn't die within
      // the first ~2.5s," catching the common case (a typo, a missing
      // compose/Tiltfile, a port already in use) that used to silently
      // report success just because a terminal window opened.
      const result = await getPlatformLauncher().openTerminal(directory, [params.upCommand]);
      if (result.success) {
        return {
          success: true,
          message: `Opened a terminal running "${params.upCommand}" in ${directory}.`,
          durationMs: Date.now() - startedAt,
        };
      }
      // Same two-code split as the Terminal step (ER-TERM-01/02) — this
      // branch reuses the exact same openTerminal mechanism, so it
      // reuses the exact same codes rather than minting a Docker-
      // specific pair that would just duplicate them (DOCKER_STEP_FAILED
      // stays reserved for the compose engine's own, genuinely different
      // direct-command-failure path below).
      const entryDetail = result.detail as
        { openFailed?: unknown; cwd: string; commands: unknown[] } | undefined;
      const code = entryDetail?.openFailed
        ? ERROR_CODES.TERMINAL_START_FAILED.code
        : ERROR_CODES.TERMINAL_COMMAND_FAILED.code;
      return {
        success: false,
        message: `${daemonNote} ${result.message}`,
        durationMs: Date.now() - startedAt,
        code,
        ...(entryDetail ? { details: { entries: [entryDetail] } } : {}),
      };
    }

    // engine === 'compose': silent background execFile. The default
    // pre-filled upCommand includes `--wait`, which makes Compose do
    // its own health-waiting and hand back a real, meaningful exit
    // code — no new readiness infrastructure needed on our side.
    const result = await runEngineCommand(directory, params.upCommand, 130_000);
    // Report run()'s own startedAt, not runEngineCommand's internal
    // timer — that one starts fresh after ensureDockerDaemonRunning's
    // (possibly 90s) wait, so using it would silently drop that wait
    // from the duration fed into the adaptive-timeout history
    // (step-timing-history.ts), same bug the tilt branch above never
    // had since it already measures from this function's own startedAt.
    const durationMs = Date.now() - startedAt;
    if (result.success) {
      return {
        success: true,
        message: `Containers are up in ${directory}.`,
        durationMs,
      };
    }
    return { ...result, message: `${daemonNote} ${result.message}`, durationMs };
  },

  async teardown(params: DockerStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    const directory = expandHome(params.directory);
    const downCommand =
      params.downCommand.length > 0
        ? params.downCommand
        : params.engine === 'tilt'
          ? 'tilt down'
          : 'docker compose down';

    const daemon = await checkDockerDaemon();
    if (daemon.status !== 'up') {
      // Unlike run(), teardown never launches Docker Desktop itself —
      // if it's not running, there's nothing left to tear down, so the
      // user (not this step) decides whether that's worth investigating.
      return {
        success: false,
        message:
          daemon.status === 'not-installed'
            ? daemon.message
            : `${daemon.message} Start Docker Desktop (or your daemon) and try again.`,
        durationMs: Date.now() - startedAt,
        code: ERROR_CODES.DOCKER_DAEMON_DOWN.code,
      };
    }

    // Both engines' teardown run via background execFile, even Tilt —
    // `tilt down` is one-shot (not long-running), so none of
    // openTerminal's "stays open afterward" value applies, every other
    // teardown path in this app (Switch/Close's own app-quit logic) is
    // invisible plumbing rather than a visible action, and execFile
    // gives a real exit code the retry/status UI can trust, which
    // openTerminal's "a window opened" success never does.
    // Report teardown()'s own startedAt, not runEngineCommand's internal
    // timer — same durationMs bug as run()'s compose branch once had
    // (see its own comment): runEngineCommand's timer starts fresh
    // after the daemon check above, silently dropping that wait (up to
    // 8s for `docker info`) from the duration fed into the adaptive-
    // timeout history.
    const result = await runEngineCommand(directory, downCommand, 60_000);
    const durationMs = Date.now() - startedAt;
    if (result.success) {
      return {
        success: true,
        message: `Containers are down in ${directory}.`,
        durationMs,
      };
    }
    return { ...result, durationMs };
  },

  detail(params: Record<string, unknown>): string {
    const { directory, engine } = readRawParams(params);
    if (!directory) return 'Starts the configured Docker environment.';
    const engineLabel = engine === 'tilt' ? 'Tilt' : 'Docker Compose';
    return `Starts ${engineLabel} in ${directory}.`;
  },

  expand(params: Record<string, unknown>): StepDisplayRow[] | undefined {
    const { directory, upCommand } = readRawParams(params);
    if (!directory) return undefined;
    const rows: StepDisplayRow[] = [{ i: 'folder', label: 'Directory', mono: directory }];
    if (upCommand) rows.push({ i: 'terminal', label: 'Up command', mono: upCommand });
    return rows;
  },
};
