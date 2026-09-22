import { z } from 'zod';
import type {
  StepResult,
  StepDisplayRow,
  ToolPlugin,
  ValidationResult,
} from '@workspace-launcher/shared';
import { zodValidate } from '@workspace-launcher/shared';
import {
  deletePendingVscodeRestore,
  writePendingVscodeRestore,
} from '@workspace-launcher/shared/vscode-restore';
import { getPlatformLauncher } from '../platform';
import { expandHome, isAcceptableToolPath } from '../lib/paths';

/**
 * One terminal's config — `commands` only, matching docs/build-shell.md's
 * literal Tier 1 scope. No `cwd` field: every restored terminal's cwd
 * is always the workspace folder itself (the extension passes it
 * explicitly, since it already has that context) — adding a
 * per-terminal override would be scope not on the approved list.
 */
const VSCodeTerminalParamsSchema = z.object({
  commands: z.array(z.string().min(1, 'each command must be a non-empty string')),
});

/**
 * Params schema for a "vscode" step: open a folder path in VS Code
 * (docs/build-shell.md, "VS Code — open folder path"), optionally
 * staging terminal(s)/command(s) for the companion extension
 * (apps/vscode-extension) to recreate on restore. Lives alongside this
 * tool module, not in packages/shared — the shared package only defines
 * the generic step envelope (docs/architecture.md #2).
 *
 * `terminals` defaults to [] rather than being required — mirrors
 * ChromeStepParamsSchema's `urls` exactly, including the same
 * defensive-guard requirement in run() below: validate()'s default is
 * pass/fail-only, it never rewrites what a config saved before this
 * field existed (or one where the terminals textarea was never
 * touched) actually hands to run().
 */
const VSCodeStepParamsSchema = z.object({
  path: z
    .string()
    .min(1, 'path must be a non-empty string')
    .refine(
      isAcceptableToolPath,
      'path must be an absolute path (or start with ~) — a relative path silently breaks terminal restore and may open the wrong folder',
    ),
  terminals: z.array(VSCodeTerminalParamsSchema).default([]),
});

export type VSCodeStepParams = z.infer<typeof VSCodeStepParamsSchema>;

const VSCODE_APP_NAME = 'Visual Studio Code';

export const vscodeTool: ToolPlugin<VSCodeStepParams> = {
  type: 'vscode',

  validate(params: unknown): ValidationResult<VSCodeStepParams> {
    return zodValidate(VSCodeStepParamsSchema, params);
  },

  async run(params: VSCodeStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    const folderPath = expandHome(params.path);
    // orchestrator.ts now passes validate()'s already-defaulted `data`
    // here, so `params.terminals` is guaranteed an array on that path —
    // this guard is redundant-in-practice for it. Kept anyway: `run()`
    // is a public ToolPlugin method, and nothing enforces every caller
    // (tests, any future path) routes through a zod parse first.
    const terminals = Array.isArray(params.terminals) ? params.terminals : [];

    if (terminals.length > 0) {
      try {
        // Written BEFORE openInApp, not after — the extension only
        // ever checks for this file on its own activation/focus, it
        // never waits for one to appear after the fact.
        await writePendingVscodeRestore(folderPath, { terminals });
      } catch (err) {
        // Fail loudly rather than open VS Code anyway and quietly
        // never restore any terminal — that would look identical to
        // success.
        return {
          success: false,
          message: `Could not stage terminal restore data for ${folderPath}: ${
            err instanceof Error ? err.message : String(err)
          }. VS Code was not opened.`,
          durationMs: Date.now() - startedAt,
        };
      }
    }

    const result = await getPlatformLauncher().openInApp(VSCODE_APP_NAME, folderPath);

    if (!result.success && terminals.length > 0) {
      // openInApp failed after the restore file was already staged —
      // don't leave stale terminal commands armed for this folder. If
      // left in place, a later successful manual "open this folder in
      // VS Code" within the TTL window would silently run them despite
      // this step having reported failure. Best-effort: a cleanup
      // failure here shouldn't mask the real (openInApp) failure being
      // returned below.
      await deletePendingVscodeRestore(folderPath).catch(() => {});
    }

    // Covers the one gap the extension's automatic activation triggers
    // can't (see extension.ts's activate()): a window already open AND
    // already focused at the moment this ran, so it never loses+regains
    // focus and onStartupFinished already ran long ago.
    const message =
      result.success && terminals.length > 0
        ? `${result.message} If VS Code was already open for this folder, run "Workspace Launcher: Restore Terminals" from its Command Palette to apply the terminal restore.`
        : result.message;

    return { success: result.success, message, durationMs: Date.now() - startedAt };
  },

  async teardown(): Promise<StepResult> {
    // Tier 2 (docs/build-shell.md) — no-op for now.
    return { success: true, message: 'No teardown for VS Code steps yet.', durationMs: 0 };
  },

  // Raw-params contract (ToolPlugin.detail/expand's own doc comment) —
  // relocated verbatim from config/workspace-display.ts's old
  // detailForStep/expandForStep 'vscode' branches, not new logic.
  detail(params) {
    const path = typeof params['path'] === 'string' ? params['path'] : undefined;
    return path ? `Opens ${path}` : 'Opens the configured folder path.';
  },

  expand(params): StepDisplayRow[] | undefined {
    const path = typeof params['path'] === 'string' ? params['path'] : undefined;
    return path ? [{ i: 'folder', label: 'Path', mono: path }] : undefined;
  },
};
