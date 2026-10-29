import { z } from 'zod';
import type { WlHelperClient } from '../../platform/macos/wl-helper-client';
import {
  readTerminalSessionInfo,
  readTerminalSessionState,
  removeTerminalSessionFiles,
  requestTerminalRerun,
  type TerminalSessionState,
} from '../../platform/macos/terminal-session';
import { runCommand } from '../../lib/shell-exec';
import { pollUntil } from '../../lib/poll-until';
import type { CloseOutcome, HandleState, ResourceHandle, ResourceKindPlugin } from '../types';
import { TERMINAL_BUNDLE_ID, TERMINAL_WINDOW_KIND, markerOf } from './terminal-spec';

/**
 * One terminal window opened by a Terminal step (WCs/WC__window-tracking.md,
 * phase 3a/3b). Found by the marker its script put in the window
 * title; its processes by the shell pid + start time + tty the script
 * recorded — never "everything on that tty" (ttys are recycled).
 *
 * Closing stops its processes first, then presses the window's close
 * button: closing a window with a command still running only brings
 * up Terminal's "terminate running processes?" dialog (finding D1),
 * and killing first closes cleanly (D2). A dialog anyway is never
 * confirmed on the user's behalf.
 *
 * A window the user took over (pressed a key once its commands
 * finished) is theirs from then on: it's reported as drifted, so the
 * workspace lets go of it without closing it, and the next restore
 * opens a fresh terminal.
 */

const HandleSchema = z.object({
  marker: z.string().min(1),
  /** Terminal.app's pid and the window's id. */
  pid: z.number().int().positive(),
  windowId: z.number().int().positive(),
  shellPid: z.number().int().positive(),
  shellStartedAt: z.number(),
  tty: z.string().min(1),
});

type TerminalHandle = z.infer<typeof HandleSchema>;

export interface TerminalKindDeps {
  helper: Pick<WlHelperClient, 'request'>;
  readInfo: typeof readTerminalSessionInfo;
  readState: typeof readTerminalSessionState;
  requestRerun: typeof requestTerminalRerun;
  removeFiles: typeof removeTerminalSessionFiles;
  /** Every descendant of `pid`, deepest first; null if the process table couldn't be read. */
  descendantsOf: (pid: number) => Promise<number[] | null>;
  signal: (pid: number, signal: NodeJS.Signals) => void;
  isAlive: (pid: number) => boolean;
}

export const defaultTerminalDeps: Omit<TerminalKindDeps, 'helper'> = {
  readInfo: readTerminalSessionInfo,
  readState: readTerminalSessionState,
  requestRerun: requestTerminalRerun,
  removeFiles: removeTerminalSessionFiles,
  descendantsOf,
  signal: (pid, signal) => {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone, which is what was wanted.
    }
  },
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

// What a window close sends a shell; leftovers get SIGKILL after this.
const HANGUP_GRACE_MS = 1_500;

export function createTerminalKind(
  deps: TerminalKindDeps,
  options: { captureTimeoutMs?: number; graceMs?: number } = {},
): ResourceKindPlugin {
  const captureTimeoutMs = options.captureTimeoutMs ?? 8_000;
  const graceMs = options.graceMs ?? HANGUP_GRACE_MS;

  async function terminalPid(): Promise<number | null> {
    const running = await deps.helper.request('isRunning', { bundleId: TERMINAL_BUNDLE_ID });
    return running.ok ? (running.result.pids[0] ?? null) : null;
  }

  async function startTime(pid: number): Promise<number | null | undefined> {
    const response = await deps.helper.request('processStartTime', { pid });
    // undefined = couldn't ask (helper down); null = no such process.
    return response.ok ? response.result.startedAt : undefined;
  }

  /** Captures `marker`'s window among those not in `before`, plus its shell. */
  async function captureMarked(
    marker: string,
    before: number[],
  ): Promise<{ found: true; handle: TerminalHandle } | { found: false; reason: string }> {
    const window = await deps.helper.request(
      'captureNewWindow',
      { bundleId: TERMINAL_BUNDLE_ID, before, titleContains: marker, timeoutMs: captureTimeoutMs },
      { timeoutMs: captureTimeoutMs + 2_000 },
    );
    if (!window.ok) {
      return {
        found: false,
        // Terminal set to open new windows as tabs: there's no new
        // window to find (a known limitation — only the active tab is
        // visible to Accessibility).
        reason: `no new Terminal window for this terminal (${window.error.message})`,
      };
    }
    const { value: info } = await pollUntil(
      () => deps.readInfo(marker).then((i) => i ?? undefined),
      {
        intervalMs: 100,
        timeoutMs: 3_000,
      },
    );
    if (!info) return { found: false, reason: "its script didn't report its shell" };
    const shellStartedAt = await startTime(info.shellPid);
    if (typeof shellStartedAt !== 'number') {
      return { found: false, reason: "couldn't read its shell's start time" };
    }
    return {
      found: true,
      handle: {
        marker,
        pid: window.result.pid,
        windowId: window.result.windowId,
        shellPid: info.shellPid,
        shellStartedAt,
        tty: info.tty,
      },
    };
  }

  async function checkHandle(
    raw: ResourceHandle,
  ): Promise<HandleState & { session?: TerminalSessionState }> {
    const parsed = HandleSchema.safeParse(raw);
    if (!parsed.success) return { state: 'gone' };
    const handle = parsed.data;
    const window = await deps.helper.request('windowState', {
      pid: handle.pid,
      windowId: handle.windowId,
    });
    if (!window.ok) return { state: 'unknown', reason: window.error.message };
    if (window.result.state === 'gone') return { state: 'gone' };
    // pid + start time together: the same pid with another start time
    // is a different process, and is never touched.
    const startedAt = await startTime(handle.shellPid);
    if (startedAt === undefined) return { state: 'unknown', reason: 'helper unavailable' };
    if (startedAt !== handle.shellStartedAt) return { state: 'gone' };
    const session = await deps.readState(handle.marker);
    if (session === 'shell') return { state: 'drifted' };
    return { state: 'alive', ...(session ? { session } : {}) };
  }

  async function stopProcesses(handle: TerminalHandle): Promise<void> {
    const descendants = (await deps.descendantsOf(handle.shellPid)) ?? [];
    const targets = [...descendants, handle.shellPid];
    for (const pid of targets) deps.signal(pid, 'SIGHUP');
    const { value: allGone } = await pollUntil(
      async () => (targets.every((pid) => !deps.isAlive(pid)) ? true : undefined),
      { intervalMs: 100, timeoutMs: graceMs },
    );
    if (allGone) return;
    for (const pid of targets) if (deps.isAlive(pid)) deps.signal(pid, 'SIGKILL');
  }

  return {
    kind: TERMINAL_WINDOW_KIND,
    // Opening the step again would open a second window running the
    // same commands — so an open terminal is reused (re-running its
    // commands in place if they've finished) and Retry closes it first.
    openIsIdempotent: false,
    closesWholeApp: false,

    async snapshot() {
      const listing = await deps.helper.request('listWindows', { bundleId: TERMINAL_BUNDLE_ID });
      return listing.ok ? listing.result.map((w) => w.windowId) : [];
    },

    async capture(identity, snapshot) {
      const marker = markerOf(identity);
      const before = Array.isArray(snapshot) ? (snapshot as number[]) : [];
      const result = await captureMarked(marker, before);
      return result.found ? { found: true, handle: result.handle, preexisting: false } : result;
    },

    async reconcileOpening(identity) {
      // A crash between opening and capturing: the marker in its title
      // still says which window it was.
      const marker = markerOf(identity);
      const result = await captureMarked(marker, []);
      return result.found ? { found: true, handle: result.handle, preexisting: false } : result;
    },

    async findLive() {
      // Never adopted by identity alone: a terminal's processes are only
      // ever trusted from the handle this app recorded when it opened it.
      return null;
    },

    async check(handle) {
      const { session: _session, ...state } = await checkHandle(handle);
      return state;
    },

    async revive(handle) {
      const state = await checkHandle(handle);
      if (state.state !== 'alive' || state.session !== 'done') return false;
      await deps.requestRerun((handle as TerminalHandle).marker);
      return true;
    },

    async close(raw): Promise<CloseOutcome> {
      const state = await checkHandle(raw);
      if (state.state === 'gone') return { outcome: 'already-gone' };
      if (state.state === 'unknown') return { outcome: 'failed', detail: state.reason };
      if (state.state === 'drifted') {
        return { outcome: 'kept-running', detail: "you've used it since — left open for you" };
      }
      const handle = raw as TerminalHandle;
      await stopProcesses(handle);
      const pid = (await terminalPid()) ?? handle.pid;
      const close = await deps.helper.request('closeWindow', { pid, windowId: handle.windowId });
      if (!close.ok) {
        return close.error.code === 'not-trusted'
          ? { outcome: 'needs-permission', detail: close.error.message }
          : { outcome: 'failed', detail: close.error.message };
      }
      switch (close.result.outcome) {
        case 'closed':
        case 'already-gone':
          await deps.removeFiles(handle.marker);
          return { outcome: 'closed' };
        case 'blocked':
          return { outcome: 'refused', detail: 'Terminal is asking before closing it' };
        case 'still-open':
          return { outcome: 'failed', detail: 'the window stayed open' };
      }
    },
  };
}

/** Every descendant of `rootPid` from the process table, deepest first. */
async function descendantsOf(rootPid: number): Promise<number[] | null> {
  const result = await runCommand('ps', ['-A', '-o', 'pid=,ppid='], { timeoutMs: 5_000 });
  if (!result.success) return null;
  const children = new Map<number, number[]>();
  for (const line of result.stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || ppid === undefined || Number.isNaN(ppid)) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const ordered: number[] = [];
  const visit = (pid: number): void => {
    for (const child of children.get(pid) ?? []) {
      visit(child);
      ordered.push(child);
    }
  };
  visit(rootPid);
  return ordered;
}
