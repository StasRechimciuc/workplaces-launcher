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
    // Down command silently delete volumes on teardown.
    if (tokens.includes('-v') || tokens.includes('--volumes')) {
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
 * apart (an ENOENT-shaped failure vs. anything else) so the step's
 * message points at the right fix instead of surfacing a raw
 * connection-refused error. Directly closes the "no guidance when
 * Docker/Tilt prerequisites are missing" gap found during this
 * session's own orchestration-testbed work (WCs/WC__project-status.md,
 * 2026-10-24).
 */
async function checkDockerDaemon(): Promise<
  { success: true } | { success: false; message: string }
> {
  const result = await runCommand('docker', ['info'], { timeoutMs: 8_000 });
  if (result.success) return { success: true };
  const notInstalled = /ENOENT|command not found/i.test(result.message);
  return {
    success: false,
    message: notInstalled
      ? "Docker isn't installed — install Docker Desktop and try again."
      : `Docker doesn't seem to be running (checked via "docker info"): ${result.stderr || result.message}. Start Docker Desktop (or your daemon) and try again.`,
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

    const daemon = await checkDockerDaemon();
    if (!daemon.success) {
      return {
        success: false,
        message: daemon.message,
        durationMs: Date.now() - startedAt,
        code: ERROR_CODES.DOCKER_DAEMON_DOWN.code,
      };
    }

    if (params.engine === 'tilt') {
      // Same mechanism/honesty-bar as the Terminal step — reuses
      // openTerminal unchanged. Success here means "the terminal
      // opened," NOT "tilt up finished successfully" — Tilt stays
      // running/interactive (live-reload), so there is no one-shot
      // exit code to check, identical to how the Terminal step already
      // works and is already accepted.
      const result = await getPlatformLauncher().openTerminal(directory, [params.upCommand]);
      return {
        success: result.success,
        message: result.success
          ? `Opened a terminal running "${params.upCommand}" in ${directory}.`
          : result.message,
        durationMs: Date.now() - startedAt,
        ...(result.success ? {} : { code: ERROR_CODES.DOCKER_STEP_FAILED.code }),
      };
    }

    // engine === 'compose': silent background execFile. The default
    // pre-filled upCommand includes `--wait`, which makes Compose do
    // its own health-waiting and hand back a real, meaningful exit
    // code — no new readiness infrastructure needed on our side.
    const result = await runEngineCommand(directory, params.upCommand, 130_000);
    if (result.success) {
      return {
        success: true,
        message: `Containers are up in ${directory}.`,
        durationMs: result.durationMs,
      };
    }
    return { ...result, message: result.message };
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
    if (!daemon.success) {
      return {
        success: false,
        message: daemon.message,
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
    const result = await runEngineCommand(directory, downCommand, 60_000);
    if (result.success) {
      return {
        success: true,
        message: `Containers are down in ${directory}.`,
        durationMs: result.durationMs,
      };
    }
    return { ...result, message: result.message };
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
