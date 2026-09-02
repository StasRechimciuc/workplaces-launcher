import { ipcMain } from 'electron';
import { MOCK_WORKSPACES } from './mock-workspaces';

/**
 * Registers every 'channel' the preload bridge is allowed to invoke.
 * This is the single place that decides what the renderer can ask the
 * main process to do — keep it a short, explicit list.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle('workspaces:list', async () => {
    return MOCK_WORKSPACES;
  });
}
