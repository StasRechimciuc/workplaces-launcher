import { z } from 'zod';
import {
  listWindowHeartbeats,
  type WindowHeartbeat,
} from '@workspace-launcher/shared/vscode-restore';
import {
  deleteWindowCommand,
  deleteWindowCommandAck,
  readWindowCommandAck,
  writeWindowCommand,
} from '@workspace-launcher/shared/vscode-window-commands';
import { pollUntil } from '../../lib/poll-until';
import { runCommand } from '../../lib/shell-exec';
import type { CloseOutcome, HandleState, ResourceHandle, ResourceKindPlugin } from '../types';
import { normalizeDirectory } from './compose-spec';
import { VSCODE_WINDOW_KIND } from './vscode-window-spec';

/**
 * One VS Code window as a resource (WCs/WC__window-tracking.md, slice
 * 6). Everything per-window goes through the companion extension: its
 * heartbeat says which window has which folder open, and closing goes
 * through its command channel (it refuses with unsaved changes).
 *
 * Without the extension nothing can be told apart, so such a window is
 * never closed — Close leaves VS Code open and says why, instead of
 * quitting the app and every other window in it (founder decision).
 *
 * Binding is lazy so a restore never waits for VS Code and its
 * extension to start: the handle starts with no sessionId, and the
 * first check that sees this folder's window — one whose extension
 * started after the open was recorded — binds it.
 */

const IdentitySchema = z.object({ bundleId: z.string().min(1), folder: z.string().min(1) });

const HandleSchema = z.object({
  bundleId: z.string().min(1),
  folder: z.string().min(1),
  /** The window's vscode.env.sessionId, once bound; null before. */
  sessionId: z.string().nullable(),
  /** When this app recorded the open (ms) — what decides which window it was. */
  openedAt: z.number(),
});

type WindowHandle = z.infer<typeof HandleSchema>;
type TrackableBeat = Extract<WindowHeartbeat, { version: 2 }>;

export interface VscodeWindowDeps {
  listHeartbeats: () => Promise<WindowHeartbeat[]>;
  /** The bundle id of the app a heartbeat's appRoot belongs to; null if unreadable. */
  bundleIdOfAppRoot: (appRoot: string) => Promise<string | null>;
  /** Whether any instance of the app is running (helper isRunning). null = couldn't tell. */
  isAppRunning: (bundleId: string) => Promise<boolean | null>;
  sendClose: (sessionId: string) => Promise<string>;
  /**
   * Opens `folder` in the app — for an already-open window, VS Code
   * brings that window up (how it's focused: no window id is tracked).
   * Resolves to why it couldn't, or null.
   */
  openFolder: (bundleId: string, folder: string) => Promise<string | null>;
  readAck: typeof readWindowCommandAck;
  /** Takes back an unanswered command; false if the window had already claimed it. */
  withdraw: (commandId: string) => Promise<boolean>;
  cleanUp: (commandId: string) => Promise<void>;
}

export const defaultCommandDeps: Pick<
  VscodeWindowDeps,
  'listHeartbeats' | 'sendClose' | 'readAck' | 'withdraw' | 'cleanUp' | 'openFolder'
> = {
  listHeartbeats: listWindowHeartbeats,
  openFolder: async (bundleId, folder) => {
    const result = await runCommand('open', ['-b', bundleId, folder]);
    return result.success ? null : result.message;
  },
  sendClose: (sessionId) => writeWindowCommand(sessionId, 'close'),
  readAck: readWindowCommandAck,
  withdraw: deleteWindowCommand,
  cleanUp: async (id) => {
    await deleteWindowCommand(id);
    await deleteWindowCommandAck(id);
  },
};

const NEEDS_EXTENSION =
  'needs the Workspace Launcher VS Code extension to close just this window — VS Code was left open';

// A window's extension usually starts within a couple of seconds of the
// window; allows for that delay when deciding a window predates the open.
const ACTIVATION_SLACK_MS = 2_000;

export function createVscodeWindowKind(
  deps: VscodeWindowDeps,
  options: {
    ackTimeoutMs?: number;
    closeTimeoutMs?: number;
    claimedGraceMs?: number;
    pollMs?: number;
  } = {},
): ResourceKindPlugin {
  const ackTimeoutMs = options.ackTimeoutMs ?? 8_000;
  const closeTimeoutMs = options.closeTimeoutMs ?? 5_000;
  const claimedGraceMs = options.claimedGraceMs ?? 3_000;
  const pollMs = options.pollMs ?? 250;

  /** Live, trackable (v2, single-folder, same app) windows on this folder. */
  async function windowsFor(identity: {
    bundleId: string;
    folder: string;
  }): Promise<TrackableBeat[]> {
    const beats: TrackableBeat[] = [];
    for (const beat of await deps.listHeartbeats()) {
      if (beat.version !== 2 || beat.folderCount !== 1) continue;
      if (normalizeDirectory(beat.folderPath) !== identity.folder) continue;
      if ((await deps.bundleIdOfAppRoot(beat.appRoot)) !== identity.bundleId) continue;
      beats.push(beat);
    }
    return beats;
  }

  async function checkHandle(raw: ResourceHandle): Promise<HandleState> {
    const parsed = HandleSchema.safeParse(raw);
    if (!parsed.success) return { state: 'gone' };
    const handle = parsed.data;
    const windows = await windowsFor(handle);

    if (handle.sessionId !== null) {
      if (windows.some((w) => w.sessionId === handle.sessionId)) return { state: 'alive' };
      // A different window on the same folder means ours closed and the
      // folder was reopened (by the user) — no longer ours.
      return { state: 'gone' };
    }
    const ours = windows.find(
      (w) => new Date(w.activatedAt).getTime() >= handle.openedAt - ACTIVATION_SLACK_MS,
    );
    if (ours) return { state: 'alive', handle: { ...handle, sessionId: ours.sessionId } };
    if (windows.length > 0) return { state: 'alive' };
    // Nothing reported: VS Code closed, or open without the extension
    // (or it hasn't started yet) — only the first is a definite "gone".
    const running = await deps.isAppRunning(handle.bundleId);
    if (running === false) return { state: 'gone' };
    return { state: 'unknown', reason: 'no window report from the VS Code extension yet' };
  }

  return {
    kind: VSCODE_WINDOW_KIND,
    // Running the step again on an open window re-stages its terminals
    // into it (duplicates), so an open window is reused, not re-run.
    openIsIdempotent: false,
    closesWholeApp: false,

    async snapshot(identity) {
      const parsed = IdentitySchema.safeParse(identity);
      if (!parsed.success) return null;
      return { existing: (await windowsFor(parsed.data)).length, at: Date.now() };
    },

    async capture(identity, snapshot) {
      const parsed = IdentitySchema.safeParse(identity);
      const before = snapshot as { existing?: unknown; at?: unknown } | null;
      if (!parsed.success || !before || typeof before.at !== 'number') {
        return { found: false, reason: 'Not a VS Code window identity.' };
      }
      const handle: WindowHandle = { ...parsed.data, sessionId: null, openedAt: before.at };
      // A window already open on this folder before the step: VS Code
      // just focused it — the user's, not ours.
      return { found: true, handle, preexisting: before.existing !== 0 };
    },

    async findLive(identity) {
      const parsed = IdentitySchema.safeParse(identity);
      if (!parsed.success) return null;
      const [window] = await windowsFor(parsed.data);
      return window
        ? { ...parsed.data, sessionId: window.sessionId, openedAt: Date.parse(window.activatedAt) }
        : null;
    },

    check: (handle) => checkHandle(handle),

    async focus(raw) {
      // Only an open window: opening the folder of a closed one would
      // open a new window, and bringing forward never opens anything.
      const state = await checkHandle(raw);
      if (state.state !== 'alive') return `its window isn't open (${state.state})`;
      const handle = HandleSchema.safeParse(raw);
      if (!handle.success) return 'unreadable record';
      return deps.openFolder(handle.data.bundleId, handle.data.folder);
    },

    async close(raw): Promise<CloseOutcome> {
      const state = await checkHandle(raw);
      if (state.state === 'gone') return { outcome: 'already-gone' };
      const handle = (state.state === 'alive' && state.handle ? state.handle : raw) as WindowHandle;
      if (handle.sessionId === null) return { outcome: 'kept-running', detail: NEEDS_EXTENSION };

      const sessionId = handle.sessionId;
      const commandId = await deps.sendClose(sessionId);
      try {
        let { value: ack } = await pollUntil(() => deps.readAck(commandId), {
          intervalMs: pollMs,
          timeoutMs: ackTimeoutMs,
        });
        // No answer in time: withdrawn, so the window never acts on it
        // late — unless the window already claimed it, and is about to
        // answer.
        if (!ack && !(await deps.withdraw(commandId))) {
          ({ value: ack } = await pollUntil(() => deps.readAck(commandId), {
            intervalMs: pollMs,
            timeoutMs: claimedGraceMs,
          }));
        }
        if (!ack) {
          return {
            outcome: 'failed',
            detail: "the VS Code window didn't answer the close request",
          };
        }
        if (ack.status === 'refused') {
          return {
            outcome: 'refused',
            detail:
              ack.reason === 'unsaved' ? 'it has unsaved changes' : 'it has several folders open',
          };
        }
        const { value: closed } = await pollUntil(
          async () =>
            (await windowsFor(handle)).some((w) => w.sessionId === sessionId) ? undefined : true,
          { intervalMs: pollMs, timeoutMs: closeTimeoutMs },
        );
        return closed
          ? { outcome: 'closed' }
          : {
              outcome: 'failed',
              detail: 'VS Code accepted the close request but the window is still open',
            };
      } finally {
        await deps.cleanUp(commandId).catch(() => {});
      }
    },
  };
}

/** The bundle a VS Code-family appRoot belongs to: `…/Name.app/Contents/Resources/app` → `…/Name.app`. */
export function bundlePathOfAppRoot(appRoot: string): string | null {
  const index = appRoot.indexOf('.app/');
  return index === -1 ? null : appRoot.slice(0, index + 4);
}
