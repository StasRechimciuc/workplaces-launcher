import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';

/**
 * Expands a leading `~` (or `~/...`, or `~\...` on Windows) to the
 * user's home directory. Needed because lib/shell-exec.ts never runs
 * through a shell (shell:false, for command-injection safety — see
 * claude.md's Code Quality Standard), so nothing else expands `~` the
 * way an interactive shell normally would — `open ~/projects/x` typed
 * in Terminal works because the shell expands it before `open` ever
 * sees it; called via execFile directly, `open` receives the literal
 * three-character string "~" and treats it as a real path segment.
 *
 * `~\...` is gated to win32 specifically, not handled unconditionally,
 * because a literal `~\foo` is a legal (if unusual) POSIX filename and
 * shouldn't be reinterpreted on macOS/Linux.
 */
export function expandHome(inputPath: string): string {
  if (inputPath === '~') {
    return homedir();
  }
  if (inputPath.startsWith('~/') || (process.platform === 'win32' && inputPath.startsWith('~\\'))) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

/**
 * True when `inputPath` is either already an absolute path (per the
 * running platform's own rules) or a `~`-form expandHome() will turn
 * into one. Rejects everything else, most importantly a bare relative
 * path (e.g. "my-project").
 *
 * Uses `path.win32.isAbsolute`/`path.posix.isAbsolute` explicitly,
 * switched on `process.platform` at call time — not node:path's bare
 * `isAbsolute`, which is bound to the real OS once at module-load time
 * and does not respect a test's stubbed `process.platform` afterward
 * (same reasoning as vscode-restore.ts's own explicit platform checks).
 *
 * Why this matters: a relative `path` looks harmless (it's still "a
 * folder", VS Code will even open *something*), but it silently breaks
 * the terminal-restore handoff — vscode-restore.ts hashes whatever
 * string it's given, while the VS Code extension always hashes
 * `folder.uri.fsPath` (VS Code's own resolved absolute path). A
 * relative string hashes to a different file than the extension will
 * ever look for, so the restore is staged but never fires, silently.
 * Separately, a relative path passed to `open`/`Code.exe` resolves
 * against the Electron main process's own cwd — not anything the user
 * can see or predict — so the wrong folder (or nothing) may open too.
 * Better to reject it up front with a clear message than let either of
 * those happen invisibly.
 */
export function isAcceptableToolPath(inputPath: string): boolean {
  if (inputPath === '~' || inputPath.startsWith('~/')) {
    return true;
  }
  if (process.platform === 'win32' && inputPath.startsWith('~\\')) {
    return true;
  }
  return process.platform === 'win32' ? win32.isAbsolute(inputPath) : posix.isAbsolute(inputPath);
}
