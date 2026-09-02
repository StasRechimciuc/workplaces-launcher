import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolPlugin } from '@workspace-launcher/shared';

// registry.ts holds module-level state (the Map), so re-import fresh per
// test via vi.resetModules() to keep tests isolated from each other.
describe('tool registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function makeStubTool(type: string): ToolPlugin {
    return {
      type,
      validate: () => ({ valid: true, errors: [] }),
      run: async () => ({ success: true, message: 'ok', durationMs: 0 }),
      teardown: async () => ({ success: true, message: 'ok', durationMs: 0 }),
    };
  }

  it('registers and retrieves a tool by type', async () => {
    const { registerTool, getTool } = await import('./registry');
    const tool = makeStubTool('docker');
    registerTool(tool);
    expect(getTool('docker')).toBe(tool);
  });

  it('returns undefined for an unregistered type', async () => {
    const { getTool } = await import('./registry');
    expect(getTool('nonexistent')).toBeUndefined();
  });

  it('throws when the same type is registered twice', async () => {
    const { registerTool } = await import('./registry');
    registerTool(makeStubTool('docker'));
    expect(() => registerTool(makeStubTool('docker'))).toThrow(/already registered/);
  });
});
