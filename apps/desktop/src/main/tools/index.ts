import { registerTool } from './registry';
import { vscodeTool } from './vscode-tool';

/**
 * Registers every built tool plugin into the registry. Call once at
 * startup (main/index.ts), before anything that might run a workspace
 * — the orchestrator looks tools up by type and fails loudly if one
 * isn't registered yet (no silent no-op).
 */
export function registerBuiltInTools(): void {
  registerTool(vscodeTool);
}
