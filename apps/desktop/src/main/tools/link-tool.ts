import { stat } from 'node:fs/promises';
import { z } from 'zod';
import type { StepResult, StepDisplayRow, ToolPlugin, ValidationResult } from '@workspace-launcher/shared';
import { appDisplayName, ERROR_CODES, zodValidate } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';
import type { PlatformResult } from '../platform/types';
import { expandHome, isAcceptableToolPath } from '../lib/paths';

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * True when `protocol` looks like a Windows drive letter ("c:", "d:",
 * ...) rather than a real URL scheme. `new URL("C:\\Users\\...")`
 * parses SUCCESSFULLY in Node's WHATWG URL implementation, with
 * `protocol` set to `"c:"` — without this check, a Windows-style
 * absolute path would be wrongly classified as an invalid link instead
 * of a file path. Pure string logic, not Windows platform code (see
 * platform/windows/launcher.ts's stubbed openFileDefault/openUrlDefault
 * — the actual OPENING mechanism stays unbuilt there, per claude.md's
 * one-OS-at-a-time rule; this is just making the classifier itself
 * correct everywhere, since a mac user could still paste/type a
 * Windows-style path out of habit).
 */
function looksLikeWindowsDriveLetter(protocol: string): boolean {
  return /^[a-z]:$/i.test(protocol);
}

type ClassifiedTarget = { kind: 'url'; url: string } | { kind: 'file'; path: string };

/**
 * Classifies a "File or Link" step's one `target` field — no upfront
 * "is this a file or a link?" choice from the user (see
 * WCs/WC__file-or-link.md for the UX reasoning: this mirrors Raycast's
 * Quicklinks pattern, found to be the most comfortable of several real
 * tools researched). `new URL()` parsing is the actual classification
 * mechanism: it throws for anything that isn't shaped like a URL
 * (relative paths, absolute POSIX paths), so a throw means "treat as a
 * file path." Restricted to http/https specifically — not a blocklist
 * of dangerous schemes — because real users copy-paste plain `https://`
 * links from apps like Notion/Figma, never custom `app://` schemes
 * (confirmed: those apps don't even surface a scheme link to copy), so
 * there's no real use case an allowlist loses, and it matches
 * Electron's own documented security guidance for `shell.openExternal`
 * directly instead of reasoning around it.
 *
 * Returns `undefined` for a string that's neither a usable file path
 * nor an allowed URL — callers that need a user-facing rejection
 * message (the zod schema below) compute their own; this function's
 * callers that can ASSUME already-validated input (`run()`) never see
 * `undefined` in practice, since the schema rejects it before `run()`
 * is ever reached.
 */
function classifyTarget(target: string): ClassifiedTarget | undefined {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { kind: 'file', path: target };
  }
  if (looksLikeWindowsDriveLetter(parsed.protocol)) {
    return { kind: 'file', path: target };
  }
  if (ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    return { kind: 'url', url: target };
  }
  return undefined;
}

const LinkStepParamsSchema = z.object({
  target: z
    .string()
    .min(1, 'A file or link must be chosen.')
    .refine(
      (value) => classifyTarget(value) !== undefined,
      'Links must start with http:// or https:// — other link schemes (and anything else that isn\u2019t a usable file path) aren\u2019t supported.',
    )
    .refine((value) => {
      const classified = classifyTarget(value);
      return classified?.kind !== 'file' || isAcceptableToolPath(classified.path);
    }, 'A file path must be absolute (or start with ~) — a relative path resolves unpredictably and may open the wrong file.'),
  // Optional: opens `target` with this specific app instead of the
  // OS/browser default — reuses the SAME existing app-picker dialog
  // the "App" step type already has (dialog:selectApp), and the SAME
  // existing `openInApp` platform primitive, unchanged, for both a
  // file path and a URL string as its target (macOS's `open -a` takes
  // either identically — confirmed by reading its current
  // implementation, not assumed).
  appPath: z.string().min(1).optional(),
});

export type LinkStepParams = z.infer<typeof LinkStepParamsSchema>;

function toStepResult(result: PlatformResult, startedAt: number): StepResult {
  return {
    success: result.success,
    message: result.message,
    durationMs: Date.now() - startedAt,
    ...(result.success ? {} : { code: ERROR_CODES.LINK_OPEN_FAILED.code }),
  };
}

/**
 * The "File or Link" step type — opens a specific document or a web
 * link cold, optionally with a chosen app instead of the OS/browser
 * default. See WCs/WC__file-or-link.md for the full design (why one
 * field instead of two step types, the http/https-only scope
 * narrowing, and why Windows stays stubbed here).
 */
export const linkTool: ToolPlugin<LinkStepParams> = {
  type: 'link',

  validate(params: unknown): ValidationResult<LinkStepParams> {
    return zodValidate(LinkStepParamsSchema, params);
  },

  async run(params: LinkStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    // Schema validation already guarantees `target` classifies cleanly
    // (an allowed URL, or an absolute/~ file path) — this can't be
    // undefined in practice, only if some other `validate()` call site
    // bypassed the schema (it doesn't).
    const classified = classifyTarget(params.target)!;

    if (classified.kind === 'url') {
      const result = params.appPath
        ? await getPlatformLauncher().openInApp(params.appPath, classified.url)
        : await getPlatformLauncher().openUrlDefault(classified.url);
      return toStepResult(result, startedAt);
    }

    const resolvedPath = expandHome(classified.path);
    try {
      await stat(resolvedPath);
    } catch {
      return {
        success: false,
        message: `Can't open: "${classified.path}" no longer exists at this location.`,
        durationMs: Date.now() - startedAt,
        code: ERROR_CODES.LINK_TARGET_NOT_FOUND.code,
      };
    }

    const result = params.appPath
      ? await getPlatformLauncher().openInApp(params.appPath, resolvedPath)
      : await getPlatformLauncher().openFileDefault(resolvedPath);
    return toStepResult(result, startedAt);
  },

  async teardown(): Promise<StepResult> {
    // Tier 2 (docs/build-shell.md) — no-op for now.
    return { success: true, message: 'No teardown for File or Link steps yet.', durationMs: 0 };
  },

  detail(params: Record<string, unknown>): string {
    const target = params['target'];
    if (typeof target !== 'string' || target.length === 0) {
      return 'Opens a file or link.';
    }
    const appPath = params['appPath'];
    const withApp =
      typeof appPath === 'string' && appPath.length > 0 ? ` with ${appDisplayName(appPath)}` : '';
    return `Opens ${target}${withApp}.`;
  },

  expand(params: Record<string, unknown>): StepDisplayRow[] | undefined {
    const target = params['target'];
    if (typeof target !== 'string' || target.length === 0) {
      return undefined;
    }
    const rows: StepDisplayRow[] = [{ i: 'externalLink', label: 'Opens', mono: target }];
    const appPath = params['appPath'];
    if (typeof appPath === 'string' && appPath.length > 0) {
      rows.push({ i: 'appWindow', label: 'With', mono: appDisplayName(appPath) });
    }
    return rows;
  },
};
