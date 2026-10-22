import { runCommand } from '../../lib/shell-exec';

/**
 * Best-effort per-window terminal state for "Save my current workspace"
 * detection (see WCs/WC__save-current-workspace.md). `command` is
 * undefined for an idle or already-finished shell — a valid, reportable
 * state, never an error (this codebase never scrapes scrollback/history
 * to guess a finished command; an idle prompt and a just-finished one
 * are indistinguishable from the outside, and guessing wrong is worse
 * than honestly reporting nothing).
 */
export interface TerminalWindowState {
  cwd: string | undefined;
  command: string | undefined;
}

export type TerminalAppKind = 'Terminal' | 'iTerm2';

const OSASCRIPT_TIMEOUT_MS = 5000;
const PS_TIMEOUT_MS = 5000;
const LSOF_TIMEOUT_MS = 5000;

/**
 * Shells, and the login/su wrapper processes a shell's own session can
 * sit behind, whose own process shouldn't be reported as "the command"
 * when it's the only thing in the terminal's foreground process group —
 * that means the shell is idle at a bare prompt, not running anything.
 * `login`/`su` matter here too: a terminal session's foreground-group
 * leader is occasionally reported as a wrapper like
 * `login -pf user /bin/zsh` rather than the shell itself, and without
 * excluding it too, that wrapper's own invocation would be wrongly
 * saved as "the running command" instead of being treated as idle.
 * Matched against just the command's own basename (argv[0]'s last path
 * segment), not the full command line.
 */
const NON_COMMAND_BASENAMES = new Set([
  'zsh',
  '-zsh',
  'bash',
  '-bash',
  'sh',
  '-sh',
  'fish',
  '-fish',
  'login',
  'su',
]);

function isShellCommand(command: string): boolean {
  const argv0 = command.split(/\s+/)[0] ?? '';
  const basename = argv0.split('/').pop() ?? argv0;
  return NON_COMMAND_BASENAMES.has(basename);
}

/**
 * AppleScript returns a list of strings as a single comma-space-joined
 * string (e.g. "/dev/ttys004, /dev/ttys007"), and a single-item result
 * (one window) as a plain string with no separator at all — this
 * handles both shapes identically.
 */
function parseTtyList(stdout: string): string[] {
  return stdout
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function getTerminalAppTtys(): Promise<string[]> {
  const result = await runCommand(
    'osascript',
    ['-e', 'tell application "Terminal" to get tty of every window'],
    { timeoutMs: OSASCRIPT_TIMEOUT_MS },
  );
  return result.success ? parseTtyList(result.stdout) : [];
}

/**
 * iTerm2's own scripting dictionary exposes `tty` as a session property
 * (a real, documented part of its AppleScript support) — not
 * independently live-verified on this machine (iTerm2 isn't installed
 * here yet), unlike the Terminal.app path above and the `ps`/`lsof`
 * calls below, which were confirmed against this machine's actual
 * output. Worth a real check once iTerm2 is installed for comparison
 * (see WCs/WC__save-current-workspace.md).
 */
async function getITerm2Ttys(): Promise<string[]> {
  const result = await runCommand(
    'osascript',
    [
      '-e',
      'tell application "iTerm2"',
      '-e',
      'set ttyList to {}',
      '-e',
      'repeat with aWindow in windows',
      '-e',
      'repeat with aTab in tabs of aWindow',
      '-e',
      'repeat with aSession in sessions of aTab',
      '-e',
      'set end of ttyList to (tty of aSession)',
      '-e',
      'end repeat',
      '-e',
      'end repeat',
      '-e',
      'end repeat',
      '-e',
      'return ttyList',
      '-e',
      'end tell',
    ],
    { timeoutMs: OSASCRIPT_TIMEOUT_MS },
  );
  return result.success ? parseTtyList(result.stdout) : [];
}

interface PsRow {
  pid: string;
  stat: string;
  command: string;
}

/**
 * `-o pid=,stat=,command=` suppresses every column header (standard BSD
 * ps `=` suffix) so there's no header line to skip, and puts `command`
 * last so it can safely contain spaces — parsed by taking the first two
 * whitespace-delimited tokens (pid, stat) and the rest of the line
 * verbatim as the command.
 */
function parsePsOutput(stdout: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = /^(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    rows.push({ pid: match[1]!, stat: match[2]!, command: match[3]! });
  }
  return rows;
}

/**
 * `stat` containing `+` is BSD ps's own marker for "in the foreground
 * process group of its controlling terminal" — the standard, documented
 * way to distinguish an actively-running foreground job from a
 * background one on the same tty (e.g. `command &`). Several processes
 * can share it (a `foo | bar` pipeline) — the first non-shell one is
 * reported; if every foreground-group member IS the shell itself (an
 * idle prompt), the shell's own pid is used to still report a real cwd,
 * just no command.
 */
function selectForegroundRepresentative(rows: PsRow[]): { pid: string; command: string | undefined } | undefined {
  const foregroundGroup = rows.filter((r) => r.stat.includes('+'));
  if (foregroundGroup.length === 0) {
    return undefined;
  }
  const nonShell = foregroundGroup.find((r) => !isShellCommand(r.command));
  const representative = nonShell ?? foregroundGroup[0]!;
  return { pid: representative.pid, command: nonShell?.command };
}

/**
 * `-F n` (machine-readable, one field per line, `n`-prefixed for the
 * file name) avoids lsof's default whitespace-columnar output, which
 * breaks on any cwd containing a space — a real, common case ("~/Work/
 * Client Project"), not a theoretical one. Confirmed against this
 * machine's real lsof output.
 */
async function getProcessCwd(pid: string): Promise<string | undefined> {
  const result = await runCommand('lsof', ['-a', '-d', 'cwd', '-p', pid, '-F', 'n'], {
    timeoutMs: LSOF_TIMEOUT_MS,
  });
  if (!result.success) {
    return undefined;
  }
  const line = result.stdout.split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : undefined;
}

/**
 * ps -t wants the bare device name ("ttys004"), not the "/dev/ttys004"
 * form AppleScript's `tty of window`/`tty of session` reports.
 */
function stripDevPrefix(ttyPath: string): string {
  return ttyPath.replace(/^\/dev\//, '');
}

async function inspectTty(ttyPath: string): Promise<TerminalWindowState> {
  const psResult = await runCommand('ps', ['-t', stripDevPrefix(ttyPath), '-o', 'pid=,stat=,command='], {
    timeoutMs: PS_TIMEOUT_MS,
  });
  if (!psResult.success) {
    return { cwd: undefined, command: undefined };
  }

  const representative = selectForegroundRepresentative(parsePsOutput(psResult.stdout));
  if (!representative) {
    return { cwd: undefined, command: undefined };
  }

  const cwd = await getProcessCwd(representative.pid);
  return { cwd, command: representative.command };
}

/**
 * Every open window/session of the given terminal app, each with its
 * own best-effort cwd/command — one entry per window, never merged
 * (mirrors how a VS Code window with two different projects is never
 * merged into one step either). An app with no open windows (or whose
 * tty/ps/lsof chain fails entirely) returns an empty array, never a
 * throw — detection degrades to "nothing found for this app," not a
 * crash.
 */
export async function inspectTerminalAppWindows(app: TerminalAppKind): Promise<TerminalWindowState[]> {
  const ttys = app === 'Terminal' ? await getTerminalAppTtys() : await getITerm2Ttys();
  // Sequential, not Promise.all — same reasoning as terminal-tool.ts's
  // own run(): no correctness need for concurrency here (a handful of
  // windows at most), and it keeps each window's own ps/lsof pair from
  // interleaving with another window's.
  const results: TerminalWindowState[] = [];
  for (const tty of ttys) {
    results.push(await inspectTty(tty));
  }
  return results;
}
