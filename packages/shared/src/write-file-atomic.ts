import { randomUUID } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Writes `contents` to `filePath` without ever leaving a truncated or
 * partially-written file at that path if the write is interrupted
 * (crash, disk full, power loss mid-write). Writes to a sibling temp
 * file in the same directory first, then does a single rename() into
 * place — rename() is atomic on both POSIX and Windows when source and
 * destination are on the same volume, which they always are here since
 * the temp file lives next to the real one, not in a system tmp dir
 * that could be on a different volume.
 *
 * Deliberately generic and OS-agnostic — no WorkspaceConfig import, no
 * JSON handling, no knowledge of what it's writing. Lives in the shared
 * package (not apps/desktop) because it has zero Electron dependency
 * and a second real caller (the VS Code extension's pending-restore
 * writes) needs the exact same guarantee. This is the one sanctioned
 * way to write a file that must never be left half-written, the same
 * way lib/shell-exec.ts is the one sanctioned way to shell out.
 *
 * Never leaves the temp file behind on failure: if the write or the
 * rename fails, the temp file is best-effort removed before the
 * original error is rethrown (never swallowed).
 */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tempPath = join(dirname(filePath), `.${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, contents, 'utf-8');
    await rename(tempPath, filePath);
  } catch (err) {
    await unlink(tempPath).catch(() => {
      // Best-effort cleanup only. If writeFile itself failed, the temp
      // file was never created and unlink rejects with ENOENT — not a
      // failure worth reporting. The original error below is what
      // actually matters and must not be swallowed.
    });
    throw err;
  }
}
