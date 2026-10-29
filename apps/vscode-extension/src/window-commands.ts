import type {
  WindowCommand,
  WindowCommandAck,
} from '@workspace-launcher/shared/vscode-window-commands';

/**
 * What this window does with a command from the desktop app (see
 * @workspace-launcher/shared/vscode-window-commands). Pure — the VS
 * Code API arrives as `env` — so it's testable without a running
 * editor.
 *
 * The command is claimed (deleted) before anything else, so a second
 * poll tick can never act on it twice. A window never closes itself
 * with unsaved changes, or with several folders open (it can't be the
 * one window a workspace step tracks); it says why instead.
 */
export interface WindowCommandEnv {
  folderCount: number;
  hasUnsavedChanges: () => boolean;
  closeWindow: () => Promise<void>;
  claim: (id: string) => Promise<void>;
  answer: (
    id: string,
    status: WindowCommandAck['status'],
    reason?: WindowCommandAck['reason'],
  ) => Promise<void>;
}

export async function handleWindowCommand(
  command: WindowCommand,
  env: WindowCommandEnv,
): Promise<void> {
  await env.claim(command.id);
  if (env.folderCount !== 1) {
    await env.answer(command.id, 'refused', 'multi-root');
    return;
  }
  if (env.hasUnsavedChanges()) {
    await env.answer(command.id, 'refused', 'unsaved');
    return;
  }
  // Answered before closing: once the window closes, this extension
  // host is gone and can't answer anything.
  await env.answer(command.id, 'ok');
  await env.closeWindow();
}
