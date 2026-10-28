import { getWlHelperPath } from './wl-helper-path';
import { WlHelperClient } from './wl-helper-client';

let client: WlHelperClient | null = null;

/**
 * The app's one persistent wl-helper (see wl-helper-client.ts).
 * Created on first use — the helper process itself only starts with
 * the first request — and shared by every caller, because the window
 * references it holds live only in that one process.
 */
export function getWlHelper(): WlHelperClient {
  client ??= new WlHelperClient({ command: getWlHelperPath(), args: ['serve'] });
  return client;
}

/** Closes the helper's stdin so it exits; safe when it was never started. */
export function disposeWlHelper(): void {
  client?.dispose();
  client = null;
}
