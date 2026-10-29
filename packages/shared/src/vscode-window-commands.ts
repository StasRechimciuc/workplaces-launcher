import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { getAppDataRootDir } from './vscode-restore';
import { writeFileAtomic } from './write-file-atomic';

/**
 * The desktop app → VS Code extension command channel (WCs/
 * WC__window-tracking.md, slice 6): the reverse of the heartbeat files.
 * The app writes `cmd-<id>.json` addressed to one window's sessionId;
 * that window's extension polls, claims it (deletes it), acts, and
 * answers with `ack-<id>.json`. Plain files because the extension and
 * the app are separate processes with no other shared transport, and
 * this keeps the same atomic-write, fail-soft shape as the existing
 * handoff files.
 *
 * Stale commands are never acted on: anything older than
 * WINDOW_COMMAND_TTL_MS, or written before the window's extension
 * started, is ignored — a "close" left over from before a restart must
 * never close a window the user has since opened.
 */

export const CURRENT_WINDOW_COMMAND_VERSION = 1 as const;
export const WINDOW_COMMAND_TTL_MS = 10_000;
/** How often the extension looks for commands addressed to it. */
export const WINDOW_COMMAND_POLL_MS = 1_500;

const CommandIdSchema = z.string().regex(/^[0-9a-f-]{36}$/);

const WindowCommandSchema = z.object({
  version: z.literal(CURRENT_WINDOW_COMMAND_VERSION),
  id: CommandIdSchema,
  sessionId: z.string().min(1),
  action: z.literal('close'),
  createdAt: z.string(),
});

export type WindowCommand = z.infer<typeof WindowCommandSchema>;

const WindowCommandAckSchema = z.object({
  version: z.literal(CURRENT_WINDOW_COMMAND_VERSION),
  id: CommandIdSchema,
  status: z.enum(['ok', 'refused']),
  /** 'refused' only: why — 'unsaved' (dirty documents) or 'multi-root'. */
  reason: z.enum(['unsaved', 'multi-root']).optional(),
});

export type WindowCommandAck = z.infer<typeof WindowCommandAckSchema>;

export function getWindowCommandsDir(): string {
  return join(getAppDataRootDir(), 'vscode-commands');
}

function commandPath(id: string): string {
  return join(getWindowCommandsDir(), `cmd-${id}.json`);
}

function ackPath(id: string): string {
  return join(getWindowCommandsDir(), `ack-${id}.json`);
}

/** App side: addresses a command to one window. Returns its id. */
export async function writeWindowCommand(
  sessionId: string,
  action: WindowCommand['action'],
): Promise<string> {
  await mkdir(getWindowCommandsDir(), { recursive: true });
  const command: WindowCommand = {
    version: CURRENT_WINDOW_COMMAND_VERSION,
    id: randomUUID(),
    sessionId,
    action,
    createdAt: new Date().toISOString(),
  };
  await writeFileAtomic(commandPath(command.id), JSON.stringify(command));
  return command.id;
}

/**
 * Extension side: commands for this window that are still valid — for
 * `sessionId`, written no earlier than `notBefore` (the extension's own
 * activation) and not older than the TTL. Unreadable or foreign files
 * are skipped, never thrown.
 */
export async function readWindowCommands(
  sessionId: string,
  notBefore: Date,
  now: Date = new Date(),
): Promise<WindowCommand[]> {
  let files: string[];
  try {
    files = await readdir(getWindowCommandsDir());
  } catch {
    return [];
  }
  const commands: WindowCommand[] = [];
  for (const file of files) {
    if (!file.startsWith('cmd-') || !file.endsWith('.json')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(getWindowCommandsDir(), file), 'utf-8'));
    } catch {
      continue;
    }
    const result = WindowCommandSchema.safeParse(parsed);
    if (!result.success || result.data.sessionId !== sessionId) continue;
    const createdAt = new Date(result.data.createdAt).getTime();
    if (!Number.isFinite(createdAt)) continue;
    if (createdAt < notBefore.getTime() || now.getTime() - createdAt > WINDOW_COMMAND_TTL_MS) {
      continue;
    }
    commands.push(result.data);
  }
  return commands;
}

/** Either side: removes a command (the extension claiming it, or the app giving up). Idempotent. */
export async function deleteWindowCommand(id: string): Promise<void> {
  await unlinkIfPresent(commandPath(id));
}

/** Extension side: answers a command it claimed. */
export async function writeWindowCommandAck(
  id: string,
  status: WindowCommandAck['status'],
  reason?: WindowCommandAck['reason'],
): Promise<void> {
  await mkdir(getWindowCommandsDir(), { recursive: true });
  const ack: WindowCommandAck = {
    version: CURRENT_WINDOW_COMMAND_VERSION,
    id,
    status,
    ...(reason ? { reason } : {}),
  };
  await writeFileAtomic(ackPath(id), JSON.stringify(ack));
}

/** App side: the answer to a command, once there is one; undefined until then. */
export async function readWindowCommandAck(id: string): Promise<WindowCommandAck | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(ackPath(id), 'utf-8'));
  } catch {
    return undefined;
  }
  const result = WindowCommandAckSchema.safeParse(parsed);
  return result.success && result.data.id === id ? result.data : undefined;
}

/** App side: cleans up an answer it has read. Idempotent. */
export async function deleteWindowCommandAck(id: string): Promise<void> {
  await unlinkIfPresent(ackPath(id));
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
