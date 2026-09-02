import type { ToolPlugin } from '@workspace-launcher/shared';

/**
 * Plugin-style tool registry (docs/architecture.md #2). Empty for now —
 * individual tool modules (vscode-tool.ts, docker-tool.ts,
 * terminal-tool.ts, chrome-tool.ts, spotify-tool.ts, slack-tool.ts,
 * each implementing ToolPlugin and calling registerTool() once) are
 * Tier 1 feature work. This file only defines the registry mechanism
 * itself, so adding a new tool type later means adding a new module,
 * not editing a growing if/else in the orchestrator.
 */
const registry = new Map<string, ToolPlugin>();

export function registerTool(plugin: ToolPlugin): void {
  if (registry.has(plugin.type)) {
    throw new Error(`Tool type "${plugin.type}" is already registered.`);
  }
  registry.set(plugin.type, plugin);
}

export function getTool(type: string): ToolPlugin | undefined {
  return registry.get(type);
}

export function listRegisteredToolTypes(): string[] {
  return Array.from(registry.keys());
}
