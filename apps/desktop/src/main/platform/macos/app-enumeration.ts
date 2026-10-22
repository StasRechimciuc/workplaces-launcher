import { runCommand } from '../../lib/shell-exec';

/**
 * One running, user-facing (foreground) app, as reported by `lsappinfo
 * list` — the "Save my current workspace" detection feature's starting
 * point (see WCs/WC__save-current-workspace.md). `bundlePath` is what
 * the rest of detection matches against (via `appDisplayName`, the same
 * matching this app already uses everywhere else — platform/
 * app-detection.ts, tool-identity.ts) and what a generic 'app' step
 * fallback needs as its `path` param.
 */
export interface RunningApp {
  /** lsappinfo's own process name — NOT always the product's display
   * name (VS Code's own process reports as "Code", not "Visual Studio
   * Code") — shown only as a last-resort label when bundlePath is
   * missing, never matched against. */
  name: string;
  bundleId: string | undefined;
  bundlePath: string | undefined;
}

const LSAPPINFO_TIMEOUT_MS = 5000;

/** Matches a record's header line, e.g. ` 59) "Code" ASN:0x0-0x6e36e30: (in front) `. */
const RECORD_HEADER = /^\s*\d+\)\s+"([^"]*)"\s+ASN:/;

/**
 * `success: false` means lsappinfo itself couldn't be run at all
 * (missing binary, timeout, denied) — distinct from `success: true,
 * apps: []`, which means lsappinfo ran fine and genuinely found nothing
 * foreground. Collapsing these into the same "empty list" shape would
 * make a total detection failure silently indistinguishable from "the
 * user has nothing open," with no caveat/issue ever surfaced — exactly
 * the silent-failure class this feature's own design otherwise goes out
 * of its way to avoid.
 */
export type ListForegroundAppsResult =
  | { success: true; apps: RunningApp[] }
  | { success: false; apps: [] };

/**
 * Every currently-running FOREGROUND app — confirmed empirically against
 * this project's own dev machine (`lsappinfo list`'s real output), not
 * assumed from documentation alone. `type="Foreground"` is what
 * distinguishes a real, user-facing app (VS Code, Chrome, Terminal) from
 * the dozens of background helpers/agents (`UIElement`, `BackgroundOnly`
 * — Control Center, WiFiAgent, XPC services, etc.) the same listing is
 * otherwise full of; without this filter the review screen's "not
 * included" bucket would be swamped with irrelevant system processes.
 *
 * Deliberately `lsappinfo`, not `osascript`/System Events (what
 * process-control.ts uses for single-named-app liveness) — System
 * Events' "get name of every process" triggers its own one-time
 * Automation permission prompt; lsappinfo needs none. A documented,
 * isolated exception to this codebase's osascript-first convention for
 * exactly this reason.
 *
 * Never throws: a failed or malformed lsappinfo call reports
 * `success: false` (see ListForegroundAppsResult above), never an
 * exception — detection degrades to a reported, visible failure, not a
 * crash and not a silent "found nothing."
 */
export async function listForegroundApps(): Promise<ListForegroundAppsResult> {
  const result = await runCommand('lsappinfo', ['list'], { timeoutMs: LSAPPINFO_TIMEOUT_MS });
  if (!result.success) {
    return { success: false, apps: [] };
  }
  return { success: true, apps: parseLsappinfoList(result.stdout) };
}

function parseLsappinfoList(stdout: string): RunningApp[] {
  const lines = stdout.split('\n');
  const apps: RunningApp[] = [];
  let currentName: string | null = null;
  let currentLines: string[] = [];

  function flush(): void {
    if (currentName === null) return;
    const app = toRunningApp(currentName, currentLines.join('\n'));
    if (app) apps.push(app);
  }

  for (const line of lines) {
    const header = RECORD_HEADER.exec(line);
    if (header) {
      flush();
      currentName = header[1] ?? '';
      currentLines = [];
    } else if (currentName !== null) {
      currentLines.push(line);
    }
  }
  flush();

  return apps;
}

/** Returns null for anything that isn't `type="Foreground"` — excluded
 * entirely, not just unmatched, so it never reaches detection at all. */
function toRunningApp(name: string, block: string): RunningApp | null {
  const typeMatch = /\btype="([^"]*)"/.exec(block);
  if (typeMatch?.[1] !== 'Foreground') {
    return null;
  }

  const bundleIdMatch = /\bbundleID="([^"]*)"/.exec(block);
  const bundlePathMatch = /\bbundle path="([^"]*)"/.exec(block);

  return {
    name,
    bundleId: bundleIdMatch?.[1],
    bundlePath: bundlePathMatch?.[1],
  };
}
