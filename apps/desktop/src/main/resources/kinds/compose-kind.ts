import { dirname } from 'node:path';
import { z } from 'zod';
import type { ResourceSpec } from '@workspace-launcher/shared';
import { runCommand } from '../../lib/shell-exec';
import { pollUntil } from '../../lib/poll-until';
import { checkDockerDaemon, runEngineCommand } from '../../tools/docker-tool';
import type { CloseOutcome, HandleState, ResourceHandle, ResourceKindPlugin } from '../types';
import { COMPOSE_KIND, normalizeDirectory } from './compose-spec';

/**
 * A Docker Compose stack as a resource (WCs/WC__window-tracking.md,
 * "Per kind": Compose). Windowless: closing it means stopping it, and
 * only when its step opted in (stop-on-close) — containers can hold
 * real, expensive-to-rebuild state, so it's never automatic otherwise.
 *
 * Identity is the step's directory, lexically normalized (not
 * realpath'd), rather than the Compose project name: the real name can
 * come from `-p`/`-f` in the Up command or COMPOSE_PROJECT_NAME and is
 * only knowable reliably after `up`. The handle records that real
 * project, from `docker compose ls`, once it's running.
 */

const IdentitySchema = z.object({ directory: z.string().min(1) });

const OptionsSchema = z.object({
  downCommand: z.string(),
  stopOnClose: z.boolean(),
});

const HandleSchema = z.object({
  directory: z.string().min(1),
  project: z.string().min(1),
  downCommand: z.string(),
  stopOnClose: z.boolean(),
});

type ComposeHandle = z.infer<typeof HandleSchema>;

/** One row of `docker compose ls --format json`. */
const LsRowSchema = z.object({
  Name: z.string(),
  Status: z.string(),
  ConfigFiles: z.string(),
});

// `docker compose ls` reads from the daemon; a healthy one answers in
// well under a second.
const LS_TIMEOUT_MS = 10_000;
// Same bound docker-tool.ts's own teardown uses for a Down command.
const DOWN_TIMEOUT_MS = 60_000;

type Listing = { ok: true; running: Map<string, string[]> } | { ok: false; reason: string };

/**
 * Running Compose projects → the directories their config files are in.
 * A daemon that isn't running (or Docker not installed) is a definite
 * answer — nothing can be running — not an error: a restore usually
 * starts with Docker Desktop still closed, and treating that as
 * "unknown" would make every stack it then starts look not-ours.
 */
async function listRunning(): Promise<Listing> {
  const daemon = await checkDockerDaemon();
  if (daemon.status !== 'up') return { ok: true, running: new Map() };
  const result = await runCommand('docker', ['compose', 'ls', '--all', '--format', 'json'], {
    timeoutMs: LS_TIMEOUT_MS,
  });
  if (!result.success) {
    return { ok: false, reason: `"docker compose ls" failed: ${result.stderr || result.message}` };
  }
  let rows: unknown;
  try {
    rows = JSON.parse(result.stdout || '[]');
  } catch {
    return { ok: false, reason: '"docker compose ls" returned unreadable output.' };
  }
  const parsed = z.array(LsRowSchema).safeParse(rows);
  if (!parsed.success) {
    return { ok: false, reason: '"docker compose ls" returned an unexpected shape.' };
  }
  const running = new Map<string, string[]>();
  for (const row of parsed.data) {
    if (!row.Status.startsWith('running')) continue;
    const dirs = row.ConfigFiles.split(',')
      .map((file) => file.trim())
      .filter((file) => file.length > 0)
      .map((file) => normalizeDirectory(dirname(file)));
    running.set(row.Name, dirs);
  }
  return { ok: true, running };
}

function projectsIn(listing: Extract<Listing, { ok: true }>, directory: string): string[] {
  return [...listing.running].filter(([, dirs]) => dirs.includes(directory)).map(([name]) => name);
}

export function createComposeKind(
  options: { captureTimeoutMs?: number; captureIntervalMs?: number } = {},
): ResourceKindPlugin {
  const captureTimeoutMs = options.captureTimeoutMs ?? 5_000;
  const captureIntervalMs = options.captureIntervalMs ?? 500;

  async function checkHandle(handle: ResourceHandle): Promise<HandleState> {
    const parsed = HandleSchema.safeParse(handle);
    if (!parsed.success) return { state: 'gone' };
    const listing = await listRunning();
    if (!listing.ok) return { state: 'unknown', reason: listing.reason };
    return listing.running.has(parsed.data.project) ? { state: 'alive' } : { state: 'gone' };
  }

  return {
    kind: COMPOSE_KIND,
    // `up` on a running stack only reconciles it with its config —
    // never a second copy — so the step always runs.
    openIsIdempotent: true,
    closesWholeApp: false,

    async snapshot(identity) {
      const directory = directoryOf(identity);
      if (!directory) return null;
      const listing = await listRunning();
      return listing.ok ? projectsIn(listing, directory) : null;
    },

    async capture(identity, snapshot, rawOptions) {
      const directory = directoryOf(identity);
      const stepOptions = OptionsSchema.safeParse(rawOptions);
      if (!directory || !stepOptions.success) {
        return { found: false, reason: 'Not a Compose identity (no directory or options).' };
      }
      let lastError = '';
      const { value: project } = await pollUntil(
        async () => {
          const listing = await listRunning();
          if (!listing.ok) {
            lastError = listing.reason;
            return undefined;
          }
          return projectsIn(listing, directory)[0];
        },
        { intervalMs: captureIntervalMs, timeoutMs: captureTimeoutMs },
      );
      if (!project) {
        return {
          found: false,
          reason: lastError || `No running Compose project in ${directory} after its step.`,
        };
      }
      const before = Array.isArray(snapshot) ? (snapshot as string[]) : null;
      const handle: ComposeHandle = { directory, project, ...stepOptions.data };
      // Already running before the step (or unknown — the snapshot
      // failed): not provably this app's, so never stopped by it.
      return { found: true, handle, preexisting: before === null || before.includes(project) };
    },

    async findLive(identity) {
      const directory = directoryOf(identity);
      if (!directory) return null;
      const listing = await listRunning();
      const project = listing.ok ? projectsIn(listing, directory)[0] : undefined;
      // Found, not opened: no step options apply, so it's never stopped.
      return project ? { directory, project, downCommand: '', stopOnClose: false } : null;
    },

    check: (handle) => checkHandle(handle),

    async close(handle): Promise<CloseOutcome> {
      const state = await checkHandle(handle);
      if (state.state === 'gone') return { outcome: 'already-gone' };
      if (state.state === 'unknown') return { outcome: 'failed', detail: state.reason };
      // checkHandle only reports 'alive' for a handle that parsed.
      const stack = handle as ComposeHandle;
      if (!stack.stopOnClose) {
        return { outcome: 'kept-running', detail: 'stop on close is off for this step' };
      }
      const command = stack.downCommand.length > 0 ? stack.downCommand : 'docker compose down';
      const result = await runEngineCommand(stack.directory, command, DOWN_TIMEOUT_MS);
      return result.success ? { outcome: 'closed' } : { outcome: 'failed', detail: result.message };
    },
  };
}

function directoryOf(identity: ResourceSpec['identity']): string | null {
  const parsed = IdentitySchema.safeParse(identity);
  return parsed.success ? parsed.data.directory : null;
}
