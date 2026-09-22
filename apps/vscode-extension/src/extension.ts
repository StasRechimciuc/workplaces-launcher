import * as vscode from 'vscode';
import {
  deletePendingVscodeRestore,
  readPendingVscodeRestore,
} from '@workspace-launcher/shared/vscode-restore';

/**
 * Re-entrancy guard — onDidChangeWindowState can fire in quick bursts
 * (rapid alt-tabbing); the read-create-delete sequence below must
 * never run twice concurrently for the same window, or an overlapping
 * second call could read the same not-yet-deleted file and create a
 * duplicate set of terminals before the first call's delete lands.
 */
let isConsuming = false;

/**
 * Waits for `terminal`'s shell to signal readiness via VS Code's own
 * documented shell-integration event, falling back to a bounded
 * timeout if it never fires (a shell without integration support, or
 * with it disabled in the user's settings) — sendText() immediately
 * after createTerminal() is a known, documented VS Code race where the
 * first command can be silently dropped. Mirrors this codebase's own
 * "never trust a bare await, always bound it" instinct
 * (orchestrator.ts's withTimeout on the desktop side).
 */
function waitForTerminalReady(terminal: vscode.Terminal, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      disposable.dispose();
      clearTimeout(timer);
      resolve();
    };
    const disposable = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal === terminal) {
        settle();
      }
    });
    const timer = setTimeout(settle, timeoutMs);
  });
}

/**
 * Checks for, and — if found — consumes (creates terminals for, then
 * deletes) a pending terminal restore staged by the desktop app for
 * whichever folder this window has open. A cheap fs check on the
 * overwhelmingly common path (no pending restore for this folder).
 *
 * Deliberately re-run on every trigger, never cached/one-shot-per-process:
 * a restore can be staged at any point after this window's own startup
 * (see activate()'s onDidChangeWindowState listener below) — remembering
 * "already checked, nothing there" would silently defeat that path.
 */
async function tryConsumePendingRestore(): Promise<void> {
  if (isConsuming) {
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return;
  }

  isConsuming = true;
  try {
    const folderPath = folder.uri.fsPath;
    const pending = await readPendingVscodeRestore(folderPath);

    if (pending.status === 'none' || pending.status === 'expired') {
      // Silent — the overwhelmingly common case (no pending restore for
      // this folder at all), or a stale attempt nobody needs to hear
      // about.
      return;
    }
    if (pending.status === 'unsupported-version') {
      // Never guess-execute an unknown shape. Left in place for a
      // future compatible extension version to consume within the TTL.
      console.warn(
        `Workspace Launcher: pending restore version ${String(pending.version)} not supported by this extension version — ignoring, file left in place.`,
      );
      return;
    }
    if (pending.status === 'corrupt') {
      void vscode.window.showWarningMessage(
        `Workspace Launcher: a pending terminal restore file for this folder could not be read (${pending.error}). It was left in place: ${pending.filePath}`,
      );
      return;
    }

    try {
      for (const terminalConfig of pending.entry.terminals) {
        const terminal = vscode.window.createTerminal({
          name: 'Workspace Launcher',
          location: vscode.TerminalLocation.Panel,
          cwd: folder.uri,
        });
        terminal.show(true); // preserveFocus — don't steal focus from the editor hot-exit already restored.
        await waitForTerminalReady(terminal);
        for (const command of terminalConfig.commands) {
          terminal.sendText(command, true);
        }
      }
    } catch (err) {
      // createTerminal is documented to throw ("when running in an
      // environment where a new process cannot be started" — a
      // sandboxed/restricted environment, resource exhaustion). Every
      // caller of tryConsumePendingRestore() invokes it as a bare
      // `void tryConsumePendingRestore()`, so an uncaught throw here
      // would surface as a silent unhandled rejection — violating this
      // project's own "fail loudly, never silently" rule, unlike the
      // 'corrupt'/'unsupported-version' branches above which already
      // warn. The pending file is left in place (the delete below is
      // never reached), so the next trigger retries from scratch
      // rather than the restore being silently lost.
      void vscode.window.showWarningMessage(
        `Workspace Launcher: could not restore terminals for this folder (${
          err instanceof Error ? err.message : String(err)
        }). It will be retried on the next focus.`,
      );
      return;
    }

    // Deleted only after every terminal is created and every command
    // sent — never before. createTerminal is documented to throw
    // ("when running in an environment where a new process cannot be
    // started"); a throw here leaves the file in place so the next
    // trigger (next focus-regain, or a manual "Restore Terminals" run)
    // retries from scratch, rather than the restore being silently lost.
    try {
      await deletePendingVscodeRestore(folderPath);
    } catch (err) {
      // The restore itself already succeeded (every terminal was
      // created, every command sent) — only cleanup failed, e.g. a
      // transient Windows file lock from AV scanning/indexing/a sync
      // client. Left silent, the file would still read back as
      // 'found' and the *next* trigger (refocus, another cold start)
      // would silently redo the entire restore — re-running every
      // configured command a second time with no explanation. Warn
      // instead, mirroring the 'corrupt' branch above.
      void vscode.window.showWarningMessage(
        `Workspace Launcher: terminals were restored, but the pending restore file could not be removed afterward (${
          err instanceof Error ? err.message : String(err)
        }). It may run again on the next focus: ${pending.filePath}`,
      );
    }
  } finally {
    isConsuming = false;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('workspaceLauncher.ping', () => {
      void vscode.window.showInformationMessage('Workspace Launcher extension is active.');
    }),
  );

  // Manual escape hatch: covers a window already open AND already
  // focused at the exact moment the desktop app staged a restore — it
  // never loses+regains focus in that case, so onDidChangeWindowState
  // never fires, and onStartupFinished already ran long ago.
  // vscode-tool.ts's own success message tells the founder to run this.
  context.subscriptions.push(
    vscode.commands.registerCommand('workspaceLauncher.restoreTerminals', () => {
      void tryConsumePendingRestore();
    }),
  );

  // Cold start / fresh window: fires once, shortly after VS Code's own
  // startup work (including this workspace's folder becoming available)
  // finishes.
  void tryConsumePendingRestore();

  // Already-open-window case: re-opening/refocusing an already-running
  // VS Code for a folder doesn't restart the extension host, so
  // onStartupFinished (fires once, at real process startup) never runs
  // again for it — refocus is what catches a restore staged while it
  // was already running. Only `focused` (not `active`, which also
  // toggles on ordinary typing/mouse activity) — real window-activation
  // events only.
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void tryConsumePendingRestore();
      }
    }),
  );
}

export function deactivate(): void {
  // Nothing beyond what context.subscriptions already disposes.
}
