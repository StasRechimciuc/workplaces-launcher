import { z } from 'zod';
import type { StepResult, ToolPlugin, ValidationResult } from '@workspace-launcher/shared';
import { ERROR_CODES, zodValidate } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';
import { isAcceptableToolPath } from '../lib/paths';

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
      (t): t is Record<string, unknown> =>
        typeof t === 'object' && t !== null && !Array.isArray(t),
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

  async run(params: TerminalStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    // Defensive re-check, same precedent as vscode-tool.ts's own
    // terminals guard — validate()'s default isn't guaranteed to have
    // run on every path that reaches here.
    const terminals = Array.isArray(params.terminals) ? params.terminals : [];

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
    const results: { success: boolean; message: string }[] = [];
    for (const entry of terminals) {
      results.push(await getPlatformLauncher().openTerminal(entry.cwd, entry.commands));
    }

    const failed = results.filter((r) => !r.success);
    const success = failed.length === 0;
    const message = success
      ? `Opened ${results.length} terminal${results.length === 1 ? '' : 's'}.`
      : `Opened ${results.length - failed.length} of ${results.length} terminal(s); failed: ${failed
          .map((f) => f.message)
          .join('; ')}`;

    return {
      success,
      message,
      durationMs: Date.now() - startedAt,
      ...(success ? {} : { code: ERROR_CODES.TERMINAL_STEP_FAILED.code }),
    };
  },

  async teardown(): Promise<StepResult> {
    return { success: true, message: 'No teardown for Terminal steps yet.', durationMs: 0 };
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
      mono:
        entry.commands.length > 0 ? `${entry.cwd} — ${entry.commands.join(' && ')}` : entry.cwd,
    }));
  },
};
