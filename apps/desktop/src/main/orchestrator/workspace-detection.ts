import type { DetectWorkspaceDraftResult, DetectedStepDraft, UnmatchedRunningApp } from '@workspace-launcher/shared';
import { appDisplayName } from '@workspace-launcher/shared';
import { listOpenWindowFolders } from '@workspace-launcher/shared/vscode-restore';
import { listForegroundApps, type RunningApp } from '../platform/macos/app-enumeration';
import { getLastUsedChromeProfileFolder } from '../platform/chrome-profiles';
import { inspectTerminalAppWindows, type TerminalAppKind } from '../platform/macos/terminal-inspection';
import { findTypeForBundlePath } from './detection-registry';
import { isOrchestratorBusy } from './orchestrator-busy';

/**
 * "Save my current workspace" detection (see
 * WCs/WC__save-current-workspace.md) — the core orchestration tying
 * together app-enumeration.ts, detection-registry.ts,
 * terminal-inspection.ts, chrome-profiles.ts, and the VS Code
 * companion extension's reverse handoff (vscode-restore.ts). Builds a
 * DRAFT only — nothing is saved here; the caller (ipc/handlers.ts) is
 * what eventually hands a user-reviewed, user-edited version of this
 * to the existing createWorkspace flow, unchanged.
 */

function classifyTerminalApp(bundlePath: string): TerminalAppKind | undefined {
  const name = appDisplayName(bundlePath).toLowerCase();
  if (name === 'terminal') return 'Terminal';
  if (name.includes('iterm')) return 'iTerm2';
  return undefined;
}

async function detectTerminalSteps(
  runningApps: RunningApp[],
): Promise<{ steps: DetectedStepDraft[]; issues: string[] }> {
  const presentKinds = new Set<TerminalAppKind>();
  for (const app of runningApps) {
    if (!app.bundlePath) continue;
    const kind = classifyTerminalApp(app.bundlePath);
    if (kind) presentKinds.add(kind);
  }

  const steps: DetectedStepDraft[] = [];
  const issues: string[] = [];

  for (const kind of presentKinds) {
    const windows = await inspectTerminalAppWindows(kind);
    if (windows.length === 0) {
      // The app IS running (we only got here because lsappinfo saw it),
      // but nothing came back — almost always a missing Automation
      // permission for this specific app, not "it has no windows." A
      // real, user-actionable gap, named explicitly rather than making
      // this terminal app silently vanish from the draft.
      issues.push(
        `${kind} is open, but Workspace Launcher couldn't read its windows — check that Automation access for ${kind} is allowed in System Settings > Privacy & Security.`,
      );
      continue;
    }
    let droppedCount = 0;
    for (const window of windows) {
      if (!window.cwd) {
        // ps/lsof itself failed for this one window (distinct from an
        // idle shell, which still has a real cwd). Not folded into the
        // empty-windows issue above (that's a systemic, whole-app
        // signal) — counted and reported separately below instead of
        // silently dropped, so a workspace missing a window the user
        // expected isn't a silent gap.
        droppedCount += 1;
        continue;
      }
      steps.push({
        type: 'terminal',
        params: { terminals: [{ cwd: window.cwd, commands: window.command ? [window.command] : [] }] },
        label: window.command ? `${window.cwd} — ${window.command}` : window.cwd,
        // exactOptionalPropertyTypes forbids an explicit `caveat: undefined`
        // — conditionally spread instead of a ternary onto the key itself.
        ...(window.command
          ? {}
          : { caveat: 'No running command detected for this terminal — only its folder was captured.' }),
      });
    }
    if (droppedCount > 0) {
      issues.push(
        `${kind}: ${droppedCount} of ${windows.length} window${windows.length === 1 ? '' : 's'} could not be read and ${droppedCount === 1 ? 'was' : 'were'} left out.`,
      );
    }
  }

  return { steps, issues };
}

/** A running app known to be VS Code, narrowed so `bundlePath` is a
 * real `string` here rather than `string | undefined` — eliminates the
 * need for a defensive-but-unreachable runtime re-check below, which
 * would otherwise be the one place in this file that could silently
 * drop VS Code from the draft entirely if a future refactor ever made
 * it reachable (every other fallback here is explicit, never silent). */
function isVscodeApp(app: RunningApp): app is RunningApp & { bundlePath: string } {
  return app.bundlePath !== undefined && findTypeForBundlePath(app.bundlePath) === 'vscode';
}

async function detectVscodeSteps(runningApps: RunningApp[]): Promise<DetectedStepDraft[]> {
  const vscodeApp = runningApps.find(isVscodeApp);
  if (!vscodeApp) {
    return [];
  }

  const openFolders = await listOpenWindowFolders();
  if (openFolders.length > 0) {
    // One step per open folder — real multi-window support, since the
    // companion extension's own heartbeat is per-window by construction
    // (VS Code can't open the same folder in two windows at once).
    return openFolders.map((folder) => ({ type: 'vscode', params: { path: folder }, label: folder }));
  }

  // VS Code is running, but no window reported an open folder — either
  // the companion extension isn't installed, or hasn't had a chance to
  // report yet. Falls back to a generic 'app' step (reopens VS Code
  // cold) rather than dropping it from the draft entirely.
  return [
    {
      type: 'app',
      params: { path: vscodeApp.bundlePath },
      label: appDisplayName(vscodeApp.bundlePath),
      caveat:
        "Could not detect which project folder was open — install the Workspace Launcher VS Code extension for full detection.",
    },
  ];
}

async function detectChromeStep(): Promise<DetectedStepDraft> {
  // Best-effort, single guess — Local State's `last_used` field has no
  // way to represent "two profiles open in two separate windows right
  // now" (a real limitation, not an oversight): if that's the case,
  // only one of them is captured, and it's flagged as a guess either way.
  const profile = await getLastUsedChromeProfileFolder();
  return {
    type: 'chrome',
    params: profile ? { profile } : {},
    label: profile ? `Chrome (${profile})` : 'Chrome',
    caveat: profile
      ? "Profile is a best guess based on Chrome's own last-used record — confirm it's the right one."
      : "Could not determine which Chrome profile was open.",
  };
}

export async function detectCurrentWorkspaceDraft(): Promise<DetectWorkspaceDraftResult> {
  // Checked once, up front — detection never even starts while a
  // Restore/Switch/Close is in progress elsewhere (see
  // orchestrator-busy.ts's own doc comment for why a single check at
  // the start, not held for the whole scan, is still correct here: the
  // caller re-resolves this before presenting the draft for save, same
  // pattern as every other read-then-confirm flow in this app).
  if (isOrchestratorBusy()) {
    return { status: 'blocked' };
  }

  const enumeration = await listForegroundApps();
  const runningApps = enumeration.apps;
  const issues: string[] = [];
  if (!enumeration.success) {
    // Distinct from "lsappinfo ran fine and found nothing" — a total
    // enumeration failure must never look identical to a genuinely
    // empty, successful scan on the review screen.
    issues.push("Couldn't scan which apps are currently running — detection may be incomplete.");
  }

  const chromeApp = runningApps.find(
    (app) => app.bundlePath !== undefined && findTypeForBundlePath(app.bundlePath) === 'chrome',
  );

  // Terminal/VS Code/Chrome detection are each their own independent
  // shell-out chains (osascript+ps+lsof, a file directory read, a
  // Local State read) — none depends on another's result, so running
  // them concurrently bounds this interactive, hotkey-triggered pass by
  // the slowest of the three instead of their sum.
  const [terminalResult, vscodeSteps, chromeStep] = await Promise.all([
    detectTerminalSteps(runningApps),
    detectVscodeSteps(runningApps),
    chromeApp ? detectChromeStep() : Promise.resolve(undefined),
  ]);

  const steps: DetectedStepDraft[] = [...terminalResult.steps, ...vscodeSteps];
  issues.push(...terminalResult.issues);
  if (chromeStep) steps.push(chromeStep);

  const unmatched: UnmatchedRunningApp[] = [];

  for (const app of runningApps) {
    if (!app.bundlePath) {
      unmatched.push({ name: app.name });
      continue;
    }

    // Terminal, VS Code, and Chrome are already fully handled by the
    // parallel passes above — never also processed by the generic loop
    // below, which would double-report them.
    if (classifyTerminalApp(app.bundlePath)) continue;

    const type = findTypeForBundlePath(app.bundlePath);
    if (type === 'vscode' || type === 'chrome') continue;

    if (type === 'spotify' || type === 'clockify') {
      steps.push({ type, params: {}, label: appDisplayName(app.bundlePath) });
      continue;
    }

    // No dedicated plugin for this app — the SAME generic 'app' step
    // this codebase already supports for manual config, included by
    // default like every other matched row. Never relegated to the
    // "unmatched" bucket just because there's no rich plugin for it
    // yet — see WCs/WC__save-current-workspace.md's "no plugin-per-app
    // commitment" decision.
    steps.push({ type: 'app', params: { path: app.bundlePath }, label: appDisplayName(app.bundlePath) });
  }

  return { status: 'ready', steps, unmatched, issues };
}
