import { z } from 'zod';
import type {
  ResourceSpec,
  RunContext,
  StepResult,
  TerminalEntryResult,
  ToolPlugin,
  ValidationResult,
} from '@workspace-launcher/shared';
import { ERROR_CODES, zodValidate } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';
import { isAcceptableToolPath } from '../lib/paths';
import { identityKeyFor } from '../resources/kind-registry';
import { markerOf, terminalWindowResource } from '../resources/kinds/terminal-spec';

/**
 * One terminal's config: a working directory (`cd`'d into first — most
 * real usage needs this before running anything) plus an ordered list
 * of commands to run after. Unlike vscode-tool.ts's own `terminals`
 * field, this `cwd` is required per-entry — a standalone Terminal step
 * has no parent project folder to inherit a working directory from.
 */
const TerminalEntrySchema = z.object({
  cwd: z
    .string()
    .min(1, 'cwd must be a non-empty string')
    .refine(
      isAcceptableToolPath,
      'cwd must be an absolute path (or start with ~) — a relative path silently breaks terminal restore and may open the wrong folder',
    ),
  // .trim() both validates and normalizes — incidental leading/trailing
  // whitespace on a pasted command is low-risk to strip, unlike an
  // embedded newline (rejected below, not stripped): that would turn
  // one typed command into two distinct lines in the generated script.
  commands: z
    .array(
      z
        .string()
        .trim()
        .min(1, 'each command must be a non-empty string')
        .refine((c) => !c.includes('\n'), 'each command must be a single line'),
    )
    .default([]),
});

/**
 * Params schema for a "terminal" step: open one or more real terminal
 * windows, each at its own directory, each running its own ordered
 * command list (docs/build-shell.md, "Terminal — open pane(s), run
 * command(s) as its own standalone step type"). `.max(8)` is a sane
 * defensive cap against a corrupted/hand-edited config opening an
 * unreasonable number of windows, not a real product limit.
 */
const TerminalStepParamsSchema = z.object({
  terminals: z.array(TerminalEntrySchema).max(8).default([]),
});

export type TerminalStepParams = z.infer<typeof TerminalStepParamsSchema>;

function readEntries(params: Record<string, unknown>): { cwd: string; commands: string[] }[] {
  const terminals = Array.isArray(params['terminals']) ? params['terminals'] : [];
  return terminals
    .filter(
      (t): t is Record<string, unknown> => typeof t === 'object' && t !== null && !Array.isArray(t),
    )
    .map((t) => ({
      cwd: typeof t['cwd'] === 'string' ? t['cwd'] : '',
      commands: Array.isArray(t['commands'])
        ? t['commands'].filter((c): c is string => typeof c === 'string')
        : [],
    }));
}

export const terminalTool: ToolPlugin<TerminalStepParams> = {
  type: 'terminal',

  validate(params: unknown): ValidationResult<TerminalStepParams> {
    return zodValidate(TerminalStepParamsSchema, params);
  },

  async run(params: TerminalStepParams, ctx: RunContext): Promise<StepResult> {
    const startedAt = Date.now();
    // Defensive re-check, same precedent as vscode-tool.ts's own
    // terminals guard — validate()'s default isn't guaranteed to have
    // run on every path that reaches here.
    const terminals = Array.isArray(params.terminals) ? params.terminals : [];
    const specs = terminalSpecs(terminals);

    if (terminals.length === 0) {
      return {
        success: true,
        message: 'No terminals configured for this step.',
        durationMs: Date.now() - startedAt,
      };
    }

    // Sequential, not Promise.all — same reasoning as chrome-tool.ts's
    // own multi-url handling: concurrent window creation gives no
    // guaranteed order, risking focus/z-order races.
    const results: { success: boolean; message: string; detail?: Record<string, unknown> }[] = [];
    for (const [i, entry] of terminals.entries()) {
      const spec = specs[i]!;
      // Already open and being reused (resources/tracking.ts) — never a
      // second window for the same terminal.
      if (ctx.liveResourceKeys?.has(identityKeyFor(spec))) {
        results.push({ success: true, message: `Reused the open terminal at ${entry.cwd}.` });
        continue;
      }
      results.push(
        await getPlatformLauncher().openTerminal(entry.cwd, entry.commands, {
          marker: markerOf(spec.identity),
        }),
      );
    }

    const failed = results.filter((r) => !r.success);
    const success = failed.length === 0;
    const message = success
      ? `Opened ${results.length} terminal${results.length === 1 ? '' : 's'}.`
      : `Opened ${results.length - failed.length} of ${results.length} terminal(s); failed: ${failed
          .map((f) => f.message)
          .join('; ')}`;

    if (success) {
      return { success, message, durationMs: Date.now() - startedAt };
    }

    // One entry per configured terminal, success or failure alike — the
    // restore-results UI needs "entry A fully succeeded, entry B's
    // second command failed" together, not just the failing entries.
    // A successful openTerminal call never sets `detail` (nothing to
    // report), so a trivial all-succeeded entry is synthesized here for
    // those, from the step's own already-known params.
    const entries: TerminalEntryResult[] = results.map((r, i) => {
      if (r.detail) return r.detail as unknown as TerminalEntryResult;
      const entry = terminals[i]!;
      return {
        cwd: entry.cwd,
        commands: entry.commands.map((command, index) => ({
          index,
          command,
          status: 'success' as const,
        })),
      };
    });

    // Scans every failed entry, not just the first — a multi-entry step
    // can fail for two different reasons at once (one entry's directory
    // no longer exists, another's command actually ran and failed), and
    // picking from only entries[0] would mislabel the whole step with
    // the wrong code's headline/fixSteps whenever it isn't the one that
    // happened to fail first. A real command failure anywhere wins —
    // it's the more specific, more actionable case.
    const anyCommandFailed = failed.some((r) => {
      const detail = r.detail as TerminalEntryResult | undefined;
      return detail && !detail.openFailed;
    });
    const code = anyCommandFailed
      ? ERROR_CODES.TERMINAL_COMMAND_FAILED.code
      : ERROR_CODES.TERMINAL_START_FAILED.code;

    return {
      success,
      message,
      durationMs: Date.now() - startedAt,
      code,
      details: { entries },
    };
  },

  async teardown(): Promise<StepResult> {
    return { success: true, message: 'No teardown for Terminal steps yet.', durationMs: 0 };
  },

  // One tracked window per terminal (resources/kinds/terminal-kind.ts):
  // Close stops its processes and closes just that window; Retry
  // replaces it instead of opening a second one next to it.
  async resources(params) {
    return terminalSpecs(Array.isArray(params.terminals) ? params.terminals : []);
  },

  detail(params: Record<string, unknown>): string {
    const entries = readEntries(params);
    return entries.length === 0
      ? 'No terminals configured.'
      : `Opens ${entries.length} terminal${entries.length === 1 ? '' : 's'}.`;
  },

  expand(params: Record<string, unknown>) {
    const entries = readEntries(params);
    if (entries.length === 0) {
      return undefined;
    }
    return entries.map((entry, i) => ({
      i: 'terminal',
      label: `Terminal ${i + 1}`,
      mono: entry.commands.length > 0 ? `${entry.cwd} — ${entry.commands.join(' && ')}` : entry.cwd,
    }));
  },
};

/**
 * Each terminal's resource spec, in order — `occurrence` counts
 * identical earlier entries, so two terminals with the same directory
 * and commands are still two resources (and two windows).
 */
function terminalSpecs(terminals: readonly { cwd: string; commands: string[] }[]): ResourceSpec[] {
  const seen = new Map<string, number>();
  return terminals.map((entry) => {
    const key = JSON.stringify([entry.cwd, entry.commands]);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return terminalWindowResource(entry.cwd, entry.commands, occurrence);
  });
}
