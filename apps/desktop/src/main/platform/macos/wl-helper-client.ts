import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * Client for the persistent native helper (native/wl-helper — see
 * WCs/WC__window-tracking.md's Stage 2 plan, section 1). One child
 * process, JSON-lines RPC over its stdin/stdout, requests matched to
 * responses by id.
 *
 * Never throws and never rejects: every call resolves to a
 * discriminated HelperResponse, the same contract as shell-exec.ts's
 * runCommand, so a helper failure can't escape as an unhandled
 * exception mid-restore. Client-side failure codes:
 *
 * - 'timeout': no answer within the request's timeout. The helper may
 *   still finish the work afterwards — its late answer is logged and
 *   dropped, never delivered to a newer request.
 * - 'crashed': the helper exited while this request was in flight. It
 *   is NOT retried — a half-finished close or quit must not run twice.
 * - 'unavailable': the binary is missing, speaks a different protocol
 *   version, or the client was disposed. No restart can fix these.
 *
 * Everything else ('not-trusted', 'not-found', 'ambiguous',
 * 'ax-timeout', …) is the helper's own error code, passed through.
 *
 * One request at a time: the helper handles requests serially, so the
 * next one is written only once the one in flight is answered (or has
 * timed out), and a request's timeout runs from when it's written. A
 * request queued behind a long one (a window capture waits up to 10s)
 * is never failed for that wait, nor counted towards presuming the
 * helper hung.
 *
 * Lifecycle: spawned on the first request, not at app start. After a
 * crash it's restarted with exponential backoff (requests made
 * meanwhile wait, each bounded by its own timeout); the backoff resets
 * once a helper has stayed up for `stableAfterMs`. A helper that
 * swallows several requests in a row without writing anything is
 * treated as hung and restarted. Disposing closes its stdin — the
 * helper exits on EOF.
 */

export interface HelperWindow {
  windowId: number;
  pid: number;
  title: string;
  minimized: boolean;
  /** AXStandardWindow — false for panels and invisible helper windows. */
  standard: boolean;
}

/** Method → params/result, mirroring Server.swift's dispatch table. */
export interface HelperMethods {
  listWindows: { params: { bundleId: string }; result: HelperWindow[] };
  captureNewWindow: {
    params: { bundleId: string; before: number[]; titleContains?: string; timeoutMs?: number };
    result: HelperWindow;
  };
  processStartTime: { params: { pid: number }; result: { startedAt: number | null } };
  activateApp: {
    params: { pid: number };
    result: { activated: true; via: 'activate' | 'launch-services' } | { activated: false };
  };
  windowState: {
    params: { pid: number; windowId: number };
    result: { state: 'alive' | 'gone' | 'blocked'; reachable: boolean };
  };
  closeWindow: {
    params: { pid: number; windowId: number; waitMs?: number };
    result: { outcome: 'closed' | 'already-gone' | 'blocked' | 'still-open' };
  };
  focusWindow: {
    params: { pid: number; windowId: number };
    result: { activated: true; via: 'activate' | 'launch-services' } | { activated: false };
  };
  isRunning: {
    params: { bundleId: string };
    result: {
      running: boolean;
      pids: number[];
      /** Kernel process start time (ms since epoch) per instance; null if unreadable. */
      apps: { pid: number; startedAt: number | null }[];
    };
  };
  quitApp: {
    params: { pid: number; waitMs?: number };
    result: { outcome: 'quit' | 'not-running' | 'still-running' };
  };
}

export type HelperMethod = keyof HelperMethods;

export interface HelperError {
  code: string;
  message: string;
}

export type HelperResponse<T> = { ok: true; result: T } | { ok: false; error: HelperError };

export interface WlHelperClientOptions {
  command: string;
  args: string[];
  /** Must match native/wl-helper's protocolVersion. */
  protocolVersion?: number;
  /** Per-request timeout when the caller doesn't pass one. */
  defaultTimeoutMs?: number;
  /** How long a freshly spawned helper gets to announce `ready`. */
  startTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  stableAfterMs?: number;
  /** Consecutive timeouts with no output at all before the helper is presumed hung. */
  hungAfterTimeouts?: number;
  log?: (message: string) => void;
  /** How the helper process is spawned — a seam for tests. */
  spawnProcess?: typeof spawn;
}

/** Matches native/wl-helper/Sources/Protocol.swift's protocolVersion. */
export const WL_HELPER_PROTOCOL_VERSION = 1;

// Methods that wait helper-side for up to their own timeoutMs/waitMs
// get that much extra on top of this margin, so the client never gives
// up on a request the helper is still legitimately waiting inside.
const HELPER_WAIT_MARGIN_MS = 2000;

const CLIENT_FAILURE_CODES = new Set(['timeout', 'crashed', 'unavailable', 'protocol']);

interface PendingRequest {
  id: number;
  line: string;
  method: string;
  written: boolean;
  timeoutMs: number;
  /** null while queued behind the request in flight — armed again once written. */
  timer: NodeJS.Timeout | null;
  resolve: (response: HelperResponse<unknown>) => void;
}

type State = 'idle' | 'starting' | 'ready' | 'backoff' | 'unavailable';

export class WlHelperClient {
  private readonly options: Required<WlHelperClientOptions>;
  private state: State = 'idle';
  private unavailableReason = '';
  private child: ChildProcess | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stdoutBuffer = '';
  private restartAttempts = 0;
  private consecutiveTimeouts = 0;
  private startTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private backoffTimer: NodeJS.Timeout | null = null;

  constructor(options: WlHelperClientOptions) {
    this.options = {
      protocolVersion: WL_HELPER_PROTOCOL_VERSION,
      defaultTimeoutMs: 5000,
      startTimeoutMs: 5000,
      initialBackoffMs: 250,
      maxBackoffMs: 30_000,
      stableAfterMs: 10_000,
      hungAfterTimeouts: 3,
      log: (message) => console.error(`[wl-helper] ${message}`),
      spawnProcess: spawn,
      ...options,
    };
  }

  request<M extends HelperMethod>(
    method: M,
    params: HelperMethods[M]['params'],
    options?: { timeoutMs?: number },
  ): Promise<HelperResponse<HelperMethods[M]['result']>> {
    if (this.state === 'unavailable') {
      return Promise.resolve(failure('unavailable', this.unavailableReason));
    }

    const timeoutMs = options?.timeoutMs ?? this.timeoutFor(params);
    const id = this.nextId++;
    const line = `${JSON.stringify({ id, method, params })}\n`;

    return new Promise((resolve) => {
      const request: PendingRequest = {
        id,
        line,
        method,
        written: false,
        timeoutMs,
        timer: null,
        resolve: resolve as (response: HelperResponse<unknown>) => void,
      };
      this.pending.set(id, request);
      this.arm(request);
      if (this.state === 'ready') {
        this.flush();
      } else if (this.state === 'idle') {
        this.start();
      }
      // 'starting' / 'backoff': flushed once the helper reports ready.
    });
  }

  /** Fails everything outstanding and lets the helper exit on stdin EOF. */
  dispose(): void {
    this.markUnavailable('The window helper was shut down.');
  }

  private timeoutFor(params: object): number {
    const p = params as { timeoutMs?: unknown; waitMs?: unknown };
    const helperWait =
      typeof p.timeoutMs === 'number' ? p.timeoutMs : typeof p.waitMs === 'number' ? p.waitMs : 0;
    return Math.max(this.options.defaultTimeoutMs, helperWait + HELPER_WAIT_MARGIN_MS);
  }

  private start(): void {
    this.state = 'starting';
    this.stdoutBuffer = '';

    let spawned: ChildProcess;
    try {
      spawned = this.options.spawnProcess(this.options.command, this.options.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      this.markUnavailable(`Couldn't start the window helper: ${errorMessage(err)}`);
      return;
    }
    this.child = spawned;

    spawned.on('error', (err: NodeJS.ErrnoException) => {
      // A binary that isn't there (or isn't executable) won't appear by
      // restarting — fail fast instead of backing off forever.
      if (err.code === 'ENOENT' || err.code === 'EACCES') {
        this.markUnavailable(
          `The window helper at ${this.options.command} can't be run (${err.code}).`,
        );
        return;
      }
      this.options.log(`process error: ${err.message}`);
      // A process that never started (EMFILE, EAGAIN, …) emits no
      // 'exit': handled as a crash here instead, so it's retried with
      // backoff rather than left 'starting' forever.
      if (spawned.pid === undefined) {
        this.onExit(spawned, null, null, `failed to start: ${err.code ?? err.message}`);
      }
    });
    // Out of file descriptors, a spawn comes back without its pipes
    // (its 'error' says why) — nothing to talk to, so it's a crash too.
    if (!spawned.stdin || !spawned.stdout || !spawned.stderr) {
      queueMicrotask(() => this.onExit(spawned, null, null, 'started without its pipes'));
      return;
    }
    const child = spawned as ChildProcessWithoutNullStreams;

    child.stdin.on('error', (err) => {
      // EPIPE when the helper died mid-write — 'exit' handles recovery.
      this.options.log(`stdin error: ${err.message}`);
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(child, chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter((l) => l.trim() !== '')) {
        this.options.log(`stderr: ${line}`);
      }
    });
    child.on('exit', (code, signal) => this.onExit(child, code, signal));

    this.startTimer = setTimeout(() => {
      this.options.log(`no ready signal within ${this.options.startTimeoutMs}ms — killing it`);
      child.kill('SIGKILL');
    }, this.options.startTimeoutMs);
  }

  private onStdout(child: ChildProcessWithoutNullStreams, chunk: string): void {
    if (child !== this.child) return;
    this.consecutiveTimeouts = 0;
    this.stdoutBuffer += chunk;
    let newline: number;
    while ((newline = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.trim() !== '') this.onLine(child, line);
    }
  }

  private onLine(child: ChildProcessWithoutNullStreams, line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.options.log(`unparseable output: ${line.slice(0, 200)}`);
      return;
    }
    if (typeof message !== 'object' || message === null) {
      this.options.log(`unexpected output: ${line.slice(0, 200)}`);
      return;
    }
    const m = message as Record<string, unknown>;

    if (m.event === 'ready') {
      this.onReady(child, m.protocolVersion);
      return;
    }
    if (m.event === 'protocol-error') {
      this.options.log(`helper rejected a request: ${String(m.message)}`);
      return;
    }

    const request = typeof m.id === 'number' ? this.pending.get(m.id) : undefined;
    if (!request) {
      // Normal after a timeout: the helper finished late.
      this.options.log(`dropping a response for no pending request (id ${String(m.id)})`);
      return;
    }
    if (m.ok === true && 'result' in m) {
      this.settle(request, { ok: true, result: m.result });
    } else if (m.ok === false && isHelperError(m.error)) {
      this.settle(request, { ok: false, error: m.error });
    } else {
      this.settle(
        request,
        failure('protocol', `Malformed response to ${request.method}: ${line.slice(0, 200)}`),
      );
    }
    this.flush();
  }

  private onReady(child: ChildProcessWithoutNullStreams, version: unknown): void {
    this.clearStartTimer();
    if (version !== this.options.protocolVersion) {
      this.markUnavailable(
        `The window helper speaks protocol ${String(version)}, this app expects ${this.options.protocolVersion} — the helper binary is from a different build.`,
      );
      child.kill('SIGKILL');
      return;
    }
    this.state = 'ready';
    this.stableTimer = setTimeout(() => {
      this.restartAttempts = 0;
    }, this.options.stableAfterMs);
    this.flush();
  }

  private onExit(
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
    spawnFailure?: string,
  ): void {
    if (child !== this.child) return;
    this.child = null;
    this.clearStartTimer();
    this.clearStableTimer();
    if (this.state === 'unavailable') return;

    const how = spawnFailure ?? (signal ? `signal ${signal}` : `code ${String(code)}`);
    for (const request of [...this.pending.values()]) {
      if (request.written) {
        this.settle(
          request,
          failure('crashed', `The window helper exited (${how}) while handling ${request.method}.`),
        );
      }
    }
    // The rest wait for the restart — each bounded by its own timeout
    // again, with nothing in flight ahead of it.
    for (const request of this.pending.values()) this.arm(request);

    const delay = Math.min(
      this.options.initialBackoffMs * 2 ** this.restartAttempts,
      this.options.maxBackoffMs,
    );
    this.restartAttempts++;
    this.options.log(`exited unexpectedly (${how}) — restarting in ${delay}ms`);
    this.state = 'backoff';
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      if (this.state !== 'backoff') return;
      // Restart only when something is waiting; otherwise the next
      // request starts it.
      if (this.pending.size > 0) {
        this.start();
      } else {
        this.state = 'idle';
      }
    }, delay);
  }

  /** Starts a request's timeout, unless it's already running. */
  private arm(request: PendingRequest): void {
    if (request.timer) return;
    request.timer = setTimeout(() => this.onTimeout(request.id), request.timeoutMs);
  }

  private onTimeout(id: number): void {
    const request = this.pending.get(id);
    if (!request) return;
    request.timer = null;
    // Queued behind the request in flight on a running helper: its own
    // time hasn't started — the timeout starts over once it's written.
    if (!request.written && this.state === 'ready') return;
    this.settle(
      request,
      failure(
        'timeout',
        `The window helper didn't answer ${request.method} within ${request.timeoutMs}ms.`,
      ),
    );
    if (!request.written) return;

    this.consecutiveTimeouts++;
    if (this.consecutiveTimeouts >= this.options.hungAfterTimeouts && this.child) {
      this.options.log(
        `${this.consecutiveTimeouts} requests in a row timed out with no output — presuming it hung, restarting`,
      );
      this.consecutiveTimeouts = 0;
      // Out of 'ready' before the kill lands, so requests made until
      // its exit queue for the replacement instead of being written to
      // a process that's about to die.
      this.state = 'starting';
      this.child.kill('SIGKILL');
      return;
    }
    this.flush();
  }

  /**
   * Writes the next queued request once nothing is in flight — the
   * helper answers one at a time, so a request's timeout only runs
   * while the helper is actually on it.
   */
  private flush(): void {
    if (this.state !== 'ready' || !this.child?.stdin) return;
    const requests = [...this.pending.values()];
    if (requests.some((r) => r.written)) return;
    const next = requests[0];
    if (!next) return;
    next.written = true;
    if (next.timer) clearTimeout(next.timer);
    next.timer = null;
    this.arm(next);
    this.child.stdin.write(next.line);
  }

  private settle(request: PendingRequest, response: HelperResponse<unknown>): void {
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    this.pending.delete(request.id);
    // Helper-reported errors are routine results the caller handles;
    // only the client's own failures are logged here.
    if (!response.ok && CLIENT_FAILURE_CODES.has(response.error.code)) {
      this.options.log(`${request.method} failed: ${response.error.message}`);
    }
    request.resolve(response);
  }

  private markUnavailable(reason: string): void {
    if (this.state === 'unavailable') return;
    this.state = 'unavailable';
    this.unavailableReason = reason;
    this.clearStartTimer();
    this.clearStableTimer();
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
    this.backoffTimer = null;
    for (const request of [...this.pending.values()]) {
      this.settle(request, failure('unavailable', reason));
    }
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.stdin?.end();
      // EOF is the helper's cue to exit; this only covers one that doesn't.
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 2000).unref();
    }
  }

  private clearStartTimer(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private clearStableTimer(): void {
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = null;
  }
}

function failure(code: string, message: string): { ok: false; error: HelperError } {
  return { ok: false, error: { code, message } };
}

function isHelperError(value: unknown): value is HelperError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as HelperError).code === 'string' &&
    typeof (value as HelperError).message === 'string'
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
