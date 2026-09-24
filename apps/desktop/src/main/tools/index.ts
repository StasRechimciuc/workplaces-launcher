import { registerTool } from './registry';
import { vscodeTool } from './vscode-tool';
import { chromeTool } from './chrome-tool';
import { spotifyTool } from './spotify-tool';
import { clockifyTool } from './clockify-tool';

/**
 * Registers every built tool plugin into the registry. Call once at
 * startup (main/index.ts), before anything that might run a workspace
 * — the orchestrator looks tools up by type and fails loudly if one
 * isn't registered yet (no silent no-op).
 */
export function registerBuiltInTools(): void {
  registerTool(vscodeTool);
  registerTool(chromeTool);
  registerTool(spotifyTool);
  registerTool(clockifyTool);
}
