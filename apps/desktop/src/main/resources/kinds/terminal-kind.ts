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
import { runEngineCommand } from '../../tools/docker-tool';
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
 * A terminal whose window opened on another desktop is still tracked
 * through its shell; closing it switches to that desktop (by bringing
 * Terminal forward) to find and close the window — the founder's call,
 * 2026-10-29.
 *
 * A window the user took over (pressed a key once its commands
 * finished) is theirs from then on: it's reported as drifted, so the
 * workspace lets go of it without closing it, and the next restore
 * opens a fresh terminal.
 */

const HandleSchema = z.object({
  marker: z.string().min(1),
  /**
   * Terminal.app's pid and the window's id — null when the window
   * opened on a desktop Accessibility couldn't see at the time (it only
   * sees the current one, finding S2); the terminal is still tracked by
   * its shell, and its window found by marker when it's closed.
   */
  pid: z.number().int().positive(),
  windowId: z.number().int().positive().nullable(),
  shellPid: z.number().int().positive(),
  shellStartedAt: z.number(),
  tty: z.string().min(1),
  /** Its directory — where a Tilt Down command runs. */
  cwd: z.string().min(1),
  /** A Docker step on the Tilt engine: how it's stopped (ResourceSpec.options). */
  tilt: z.object({ downCommand: z.string(), stopOnClose: z.boolean() }).optional(),
});

const TiltOptionsSchema = z.object({
  engine: z.literal('tilt'),
  downCommand: z.string(),
  stopOnClose: z.boolean(),
});

type TerminalHandle = z.infer<typeof HandleSchema>;

/** What snapshot() records before the open: when, and the windows already there. */
const SnapshotSchema = z.object({
  takenAt: z.number(),
  windowIds: z.array(z.number().int()),
});

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
  /** Runs a Tilt Down command in `directory` (docker-tool.ts's runEngineCommand). */
  runDown: (directory: string, command: string) => Promise<{ success: boolean; message: string }>;
}

export const defaultTerminalDeps: Omit<TerminalKindDeps, 'helper'> = {
  runDown: (directory, command) => runEngineCommand(directory, command, TILT_DOWN_TIMEOUT_MS),
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
// How long `tilt up` gets to wind down after Ctrl+C before `tilt down`.
const TILT_INTERRUPT_GRACE_MS = 10_000;
// Same bound docker-tool.ts gives a Down command.
const TILT_DOWN_TIMEOUT_MS = 60_000;

export function createTerminalKind(
  deps: TerminalKindDeps,
  options: {
    captureTimeoutMs?: number;
    infoTimeoutMs?: number;
    graceMs?: number;
    tiltGraceMs?: number;
  } = {},
): ResourceKindPlugin {
  const captureTimeoutMs = options.captureTimeoutMs ?? 8_000;
  const infoTimeoutMs = options.infoTimeoutMs ?? 3_000;
  const graceMs = options.graceMs ?? HANGUP_GRACE_MS;
  const tiltGraceMs = options.tiltGraceMs ?? TILT_INTERRUPT_GRACE_MS;

  async function terminalPid(): Promise<number | null> {
    const running = await deps.helper.request('isRunning', { bundleId: TERMINAL_BUNDLE_ID });
    return running.ok ? (running.result.pids[0] ?? null) : null;
  }

  async function startTime(pid: number): Promise<number | null | undefined> {
    const response = await deps.helper.request('processStartTime', { pid });
    // undefined = couldn't ask (helper down); null = no such process.
    return response.ok ? response.result.startedAt : undefined;
  }

  /**
   * Captures `marker`'s window among those not in `before`, plus its
   * shell — from session info written at or after `since`, never a
   * previous window's leftover.
   */
  async function captureMarked(
    marker: string,
    before: number[],
    cwd: string,
    tilt: TerminalHandle['tilt'],
    since: number,
  ): Promise<{ found: true; handle: TerminalHandle } | { found: false; reason: string }> {
    const window = await deps.helper.request(
      'captureNewWindow',
      { bundleId: TERMINAL_BUNDLE_ID, before, titleContains: marker, timeoutMs: captureTimeoutMs },
      { timeoutMs: captureTimeoutMs + 2_000 },
    );
    // No window found: it opened on a desktop Accessibility can't see
    // right now (or as a tab, which only shows while it's the active
    // one). Still tracked through its shell — the window is looked for
    // again, by marker, when it's closed.
    const windowId = window.ok ? window.result.windowId : null;
    const appPid = window.ok ? window.result.pid : await terminalPid();
    if (appPid === null) return { found: false, reason: "Terminal isn't running" };
    const { value: info } = await pollUntil(
      () => deps.readInfo(marker).then((i) => (i !== null && i.writtenAt >= since ? i : undefined)),
      {
        intervalMs: 100,
        timeoutMs: infoTimeoutMs,
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
        pid: appPid,
        windowId,
        shellPid: info.shellPid,
        shellStartedAt,
        tty: info.tty,
        cwd,
        ...(tilt ? { tilt } : {}),
      },
    };
  }

  async function checkHandle(
    raw: ResourceHandle,
  ): Promise<HandleState & { session?: TerminalSessionState }> {
    const parsed = HandleSchema.safeParse(raw);
    if (!parsed.success) return { state: 'gone' };
    const handle = parsed.data;
    if (handle.windowId !== null) {
      const window = await deps.helper.request('windowState', {
        pid: handle.pid,
        windowId: handle.windowId,
      });
      if (!window.ok) return { state: 'unknown', reason: window.error.message };
      if (window.result.state === 'gone') return { state: 'gone' };
    }
    // pid + start time together: the same pid with another start time
    // is a different process, and is never touched.
    const startedAt = await startTime(handle.shellPid);
    if (startedAt === undefined) return { state: 'unknown', reason: 'helper unavailable' };
    if (startedAt !== handle.shellStartedAt) return { state: 'gone' };
    const session = await deps.readState(handle.marker);
    if (session === 'shell') return { state: 'drifted' };
    return { state: 'alive', ...(session ? { session } : {}) };
  }

  /**
   * The terminal's window, made reachable: one never found is looked
   * for by its marker once Terminal is brought forward — which switches
   * to the desktop it's on. Looked up BEFORE its processes are stopped,
   * while the marker is still in its title.
   */
  async function locateWindow(handle: TerminalHandle, pid: number): Promise<number | null> {
    if (handle.windowId !== null) return handle.windowId;
    await deps.helper.request('activateApp', { pid });
    const { value } = await pollUntil(
      async () => {
        const listing = await deps.helper.request('listWindows', { bundleId: TERMINAL_BUNDLE_ID });
        return listing.ok
          ? listing.result.find((w) => w.title.includes(handle.marker))?.windowId
          : undefined;
      },
      { intervalMs: 150, timeoutMs: 2_000 },
    );
    return value ?? null;
  }

  async function focus(raw: ResourceHandle): Promise<string | null> {
    const parsed = HandleSchema.safeParse(raw);
    if (!parsed.success) return 'unreadable record';
    const handle = parsed.data;
    const pid = (await terminalPid()) ?? handle.pid;
    const windowId = await locateWindow(handle, pid);
    if (windowId === null) return "couldn't find its window";
    const focused = await deps.helper.request('focusWindow', { pid, windowId });
    return focused.ok ? null : focused.error.message;
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
      const takenAt = Date.now();
      const listing = await deps.helper.request('listWindows', { bundleId: TERMINAL_BUNDLE_ID });
      return { takenAt, windowIds: listing.ok ? listing.result.map((w) => w.windowId) : [] };
    },

    async capture(identity, rawSnapshot, rawOptions) {
      const marker = markerOf(identity);
      const snapshot = SnapshotSchema.safeParse(rawSnapshot);
      const before = snapshot.success ? snapshot.data.windowIds : [];
      // Without a snapshot time, only what was written from now on counts.
      const since = snapshot.success ? snapshot.data.takenAt : Date.now();
      const tilt = TiltOptionsSchema.safeParse(rawOptions);
      const result = await captureMarked(
        marker,
        before,
        String(identity['cwd']),
        tilt.success
          ? { downCommand: tilt.data.downCommand, stopOnClose: tilt.data.stopOnClose }
          : undefined,
        since,
      );
      return result.found ? { found: true, handle: result.handle, preexisting: false } : result;
    },

    async reconcileOpening(identity, since) {
      // A crash between opening and capturing: the marker in its title
      // still says which window it was.
      // The Tilt options aren't recorded until capture: a reconciled Tilt
      // terminal closes like a plain one (its processes stopped).
      const marker = markerOf(identity);
      const result = await captureMarked(marker, [], String(identity['cwd']), undefined, since);
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

    focus,

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
      if (handle.tilt) {
        if (!handle.tilt.stopOnClose) {
          return { outcome: 'kept-running', detail: 'stop on close is off for this step' };
        }
        // Tilt's own shutdown first — Ctrl+C lets `tilt up` stop
        // cleanly, then Down removes what it started; only then is the
        // window closed like any other terminal.
        const descendants = (await deps.descendantsOf(handle.shellPid)) ?? [];
        for (const pid of descendants) deps.signal(pid, 'SIGINT');
        await pollUntil(
          async () => (descendants.every((pid) => !deps.isAlive(pid)) ? true : undefined),
          { intervalMs: 200, timeoutMs: tiltGraceMs },
        );
        const command = handle.tilt.downCommand.length > 0 ? handle.tilt.downCommand : 'tilt down';
        const down = await deps.runDown(handle.cwd, command);
        if (!down.success) return { outcome: 'failed', detail: down.message };
      }
      const pid = (await terminalPid()) ?? handle.pid;
      const windowId = await locateWindow(handle, pid);
      await stopProcesses(handle);
      if (windowId === null) {
        return {
          outcome: 'failed',
          detail: "stopped its processes, but couldn't find its window to close it",
        };
      }
      let close = await deps.helper.request('closeWindow', { pid, windowId });
      if (!close.ok && close.error.code === 'unreachable') {
        // On another desktop: bring Terminal (and that desktop) forward, then try again.
        await deps.helper.request('activateApp', { pid });
        close = await deps.helper.request('closeWindow', { pid, windowId });
      }
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
