import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

export interface ShellExecSuccess {
  success: true;
  stdout: string;
  stderr: string;
}

export interface ShellExecFailure {
  success: false;
  message: string;
  stdout: string;
  stderr: string;
  code: number | null;
}

export type ShellExecResult = ShellExecSuccess | ShellExecFailure;

/**
 * The one sanctioned way to shell out in this codebase. Always takes
 * the command and its arguments as a separate array — never a single
 * interpolated string — and never runs through a shell. This is what
 * makes it safe against command injection from workspace config data,
 * which is untrusted input (claude.md Code Quality Standard: "sanitize/
 * validate all input before shelling out"). eslint.config.mjs bans
 * `exec`/`execSync` directly so every shell-out in this app has to go
 * through here.
 *
 * Never throws — callers get back a discriminated result and decide how
 * to surface failure, per this app's no-silent-failure rule, without an
 * unhandled exception taking down an in-progress workspace restore.
 */
export async function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<ShellExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options?.cwd,
      timeout: options?.timeoutMs,
      shell: false,
    });
    return { success: true, stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      success: false,
      message: e.message,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: typeof e.code === 'number' ? e.code : null,
    };
  }
}
