import { describe, expect, it } from 'vitest';
import { parseWorkspaceConfig } from './config-schema';

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
});
