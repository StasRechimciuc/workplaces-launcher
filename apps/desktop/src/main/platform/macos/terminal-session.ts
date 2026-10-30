import { createHash } from 'node:crypto';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The small files a tracked terminal's generated script shares with the
 * app (launcher.ts's openTerminal writes the script; resources/kinds/
 * terminal-kind.ts reads them) — see WCs/WC__window-tracking.md,
 * phase 3a/3b. Keyed by the terminal's marker, the text the script
 * puts in its window title so the app can tell which new window is
 * whose.
 *
 * - `.info`  — written once at start: the shell's tty and pid.
 *
 * The marker comes from the terminal's identity, so a later window of
 * the same terminal reuses these names: openTerminal deletes them
 * before it opens one, and the time `.info` was written tells a fresh
 * one from a previous window's leftover.
 * - `.state` — `running` while its commands run, `done` once they've
 *   all finished (the script then waits for a re-run or a keypress),
 *   `shell` once the user pressed a key and took the window over.
 * - `.rerun` — created by the app to have a `done` terminal run its
 *   commands again in the same window; the script deletes it.
 */

/** Always this shape, so it's safe inside the script's single-quoted strings and file names. */
const MARKER = /^wl-[0-9a-f]{12}$/;

/** A terminal's marker, derived from its resource identity key — the same for the step and the kind. */
export function terminalMarker(identityKey: string): string {
  return `wl-${createHash('sha256').update(identityKey).digest('hex').slice(0, 12)}`;
}

export function isTerminalMarker(value: string): boolean {
  return MARKER.test(value);
}

export function terminalSessionPaths(marker: string): {
  info: string;
  state: string;
  rerun: string;
} {
  if (!isTerminalMarker(marker))
    throw new Error(`Not a terminal marker: ${JSON.stringify(marker)}`);
  const base = join(tmpdir(), `workspace-launcher-session-${marker}`);
  return { info: `${base}.info`, state: `${base}.state`, rerun: `${base}.rerun` };
}

export type TerminalSessionState = 'running' | 'done' | 'shell';

/**
 * The shell's tty and pid, once the script has written them, and when
 * it did (`writtenAt`, epoch ms); null before (or if unreadable).
 */
export async function readTerminalSessionInfo(
  marker: string,
): Promise<{ tty: string; shellPid: number; writtenAt: number } | null> {
  const path = terminalSessionPaths(marker).info;
  let raw: string;
  let writtenAt: number;
  try {
    [raw, writtenAt] = await Promise.all([
      readFile(path, 'utf-8'),
      stat(path).then((s) => s.mtimeMs),
    ]);
  } catch {
    return null;
  }
  const match = /^(\/dev\/ttys\d+) (\d+)\s*$/.exec(raw);
  return match ? { tty: match[1]!, shellPid: Number(match[2]), writtenAt } : null;
}

export async function readTerminalSessionState(
  marker: string,
): Promise<TerminalSessionState | null> {
  let raw: string;
  try {
    raw = (await readFile(terminalSessionPaths(marker).state, 'utf-8')).trim();
  } catch {
    return null;
  }
  return raw === 'running' || raw === 'done' || raw === 'shell' ? raw : null;
}

/** Asks a `done` terminal to run its commands again, in the same window. */
export async function requestTerminalRerun(marker: string): Promise<void> {
  await writeFile(terminalSessionPaths(marker).rerun, '');
}

/** Tidies a closed terminal's files away. Idempotent. */
export async function removeTerminalSessionFiles(marker: string): Promise<void> {
  const paths = terminalSessionPaths(marker);
  await Promise.all(Object.values(paths).map((path) => unlink(path).catch(() => {})));
}
