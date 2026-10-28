import { runCommand } from '../lib/shell-exec';

/**
 * This boot session's id (`kern.bootsessionuuid`): new on every boot,
 * so the ledger can tell its recorded window ids and pids — which the
 * system resets and reuses across a reboot or logout — apart from
 * current ones. null when it can't be read, which the ledger treats
 * as "different session" (see ledger.ts's applyBootSession).
 */
export async function readBootSessionUuid(): Promise<string | null> {
  const result = await runCommand('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {
    timeoutMs: 5000,
  });
  if (!result.success) {
    console.error(`Couldn't read kern.bootsessionuuid: ${result.message}`);
    return null;
  }
  const uuid = result.stdout.trim();
  return /^[0-9A-Fa-f-]{36}$/.test(uuid) ? uuid : null;
}
