import { describe, expect, it } from 'vitest';
import { CURRENT_WORKSPACE_CONFIG_VERSION, parseWorkspaceConfig } from './config-schema';

describe('parseWorkspaceConfig', () => {
  it('rejects a config missing version', () => {
    const result = parseWorkspaceConfig({ id: 'ws-1', name: 'My Workspace', steps: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a non-object input', () => {
    const result = parseWorkspaceConfig('not a config');
    expect(result.success).toBe(false);
  });

  it('accepts a minimal valid config', () => {
    const result = parseWorkspaceConfig({
      version: 1,
      id: 'ws-1',
      name: 'My Workspace',
      steps: [{ type: 'docker', params: { command: 'compose up' } }],
    });
    expect(result.success).toBe(true);
  });

  it('exposes the current config version as a named constant, not a scattered literal', () => {
    expect(CURRENT_WORKSPACE_CONFIG_VERSION).toBe(1);
  });

  it('rejects a version other than the current one', () => {
    const result = parseWorkspaceConfig({ version: 2, id: 'ws-1', name: 'X', steps: [] });
    expect(result.success).toBe(false);
  });

  it('accepts a real randomUUID()-shaped id', () => {
    const result = parseWorkspaceConfig({
      version: 1,
      id: 'a1b2c3d4-e5f6-4789-a012-b3c4d5e6f789',
      name: 'X',
      steps: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an id containing path-traversal or path-separator characters', () => {
    // config/loader.ts uses `id` directly as `<id>.json` on disk —
    // this must never be allowed to escape the workspaces directory.
    for (const id of ['../../etc/evil', '..\\..\\evil', 'a/b', 'a\\b']) {
      const result = parseWorkspaceConfig({ version: 1, id, name: 'X', steps: [] });
      expect(result.success).toBe(false);
    }
  });
});
