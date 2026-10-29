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

function basenameOf(command: string): string {
  const argv0 = command.split(/\s+/)[0] ?? '';
  return argv0.split('/').pop() ?? argv0;
}

function isShellCommand(command: string): boolean {
  return NON_COMMAND_BASENAMES.has(basenameOf(command));
}

/**
 * The ttys of an app's terminal sessions, read from the process table —
 * no AppleScript, so no Automation permission prompt (WCs/
 * WC__window-tracking.md, phase 3d). Each Terminal.app window (or tab)
 * is a `login` process that's a direct child of Terminal.app, holding
 * that window's tty (confirmed against this machine's real process
 * tree); iTerm2's sessions hang off its `iTermServer` process the same
 * way. Bare device names ("ttys004"), in tty order, one per session.
 */
async function listSessionTtys(app: TerminalAppKind): Promise<string[] | null> {
  const result = await runCommand('ps', ['-A', '-o', 'pid=,ppid=,tty=,command='], {
    timeoutMs: PS_TIMEOUT_MS,
  });
  if (!result.success) return null;
  const rows = result.stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, pid, ppid, tty, command]) => ({
      pid: pid!,
      ppid: ppid!,
      tty: tty!,
      command: command!,
    }));
  const isRoot =
    app === 'Terminal'
      ? (command: string) => command.includes('/Terminal.app/Contents/MacOS/Terminal')
      : (command: string) => command.includes('iTermServer');
  const roots = new Set(rows.filter((r) => isRoot(r.command)).map((r) => r.pid));
  const ttys = new Set(
    rows.filter((r) => roots.has(r.ppid) && r.tty.startsWith('ttys')).map((r) => r.tty),
  );
  return [...ttys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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
function selectForegroundRepresentative(
  rows: PsRow[],
): { pid: string; command: string | undefined } | undefined {
  const foregroundGroup = rows.filter((r) => r.stat.includes('+'));
  if (foregroundGroup.length === 0) {
    return undefined;
  }
  // `tee` is skipped in favour of any other candidate: a tracked
  // terminal's script pipes each command through `tee` into its output
  // log (launcher.ts's openTerminal), so in a pipeline it's never the
  // user's command — it was being saved as one.
  const candidates = foregroundGroup.filter((r) => !isShellCommand(r.command));
  const nonShell = candidates.find((r) => basenameOf(r.command) !== 'tee') ?? candidates[0];
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

async function inspectTty(tty: string): Promise<TerminalWindowState> {
  const psResult = await runCommand('ps', ['-t', tty, '-o', 'pid=,stat=,command='], {
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
 * merged into one step either). An empty array means the app has no
 * sessions open; null means the process table itself couldn't be read
 * — a detection failure the caller should name, not "nothing open".
 */
export async function inspectTerminalAppWindows(
  app: TerminalAppKind,
): Promise<TerminalWindowState[] | null> {
  const ttys = await listSessionTtys(app);
  if (ttys === null) return null;
  const results: TerminalWindowState[] = [];
  for (const tty of ttys) {
    results.push(await inspectTty(tty));
  }
  return results;
}
