import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolPlugin, WorkspaceConfig } from '@workspace-launcher/shared';
import { runWorkspace } from './orchestrator';

// step-timing-history.ts is backed by electron-store, which needs a
// real Electron `app` to resolve its storage path — unavailable under
// Vitest. Mocked out entirely; its own logic (averaging, the sample
// threshold, the buffer multiplier) is covered by
// step-timing-history.test.ts instead. Returns a short timeout so the
// "hangs past its timeout" test below doesn't have to wait long.
const getStepTimeoutMs = vi.fn((_toolType: string) => 50);
const recordSuccessfulStepDuration = vi.fn((_toolType: string, _durationMs: number) => {});
vi.mock('./step-timing-history', () => ({
  getStepTimeoutMs: (...args: [string]) => getStepTimeoutMs(...args),
  recordSuccessfulStepDuration: (...args: [string, number]) =>
    recordSuccessfulStepDuration(...args),
}));

// registry.ts holds module-level state — re-import fresh per test via
// vi.resetModules() so tests don't leak tool registrations into each
// other (mirrors tools/registry.test.ts's own pattern).
describe('runWorkspace', () => {
  beforeEach(() => {
    vi.resetModules();
    getStepTimeoutMs.mockClear();
    recordSuccessfulStepDuration.mockClear();
  });

  function baseConfig(steps: WorkspaceConfig['steps']): WorkspaceConfig {
    return { version: 1, id: 'ws-1', name: 'Test workspace', steps };
  }

  it('reports a failed step for an unregistered tool type, without throwing', async () => {
    const results = await runWorkspace(baseConfig([{ type: 'nonexistent', params: {} }]));
    expect(results).toEqual([
      { success: false, message: 'No registered tool for step type "nonexistent".', durationMs: 0 },
    ]);
  });

  it('reports a failed step for invalid params', async () => {
    const { registerTool: register } = await import('../tools/registry');
    const { runWorkspace: run } = await import('./orchestrator');
    const tool: ToolPlugin = {
      type: 'strict',
      validate: () => ({ valid: false, errors: ['missing field'] }),
      run: vi.fn(),
      teardown: vi.fn(),
    };
    register(tool);

    const results = await run(baseConfig([{ type: 'strict', params: {} }]));
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.message).toContain('missing field');
    expect(tool.run).not.toHaveBeenCalled();
  });

  it('continues to later steps, and preserves already-succeeded results, when one step throws', async () => {
    const { registerTool: register } = await import('../tools/registry');
    const { runWorkspace: run } = await import('./orchestrator');

    const goodTool: ToolPlugin = {
      type: 'good',
      validate: () => ({ valid: true, errors: [] }),
      run: async () => ({ success: true, message: 'ok', durationMs: 5 }),
      teardown: vi.fn(),
    };
    const throwingTool: ToolPlugin = {
      type: 'throws',
      validate: () => ({ valid: true, errors: [] }),
      run: async () => {
        throw new Error('boom');
      },
      teardown: vi.fn(),
    };
    register(goodTool);
    register(throwingTool);

    const results = await run(
      baseConfig([
        { type: 'good', params: {} },
        { type: 'throws', params: {} },
        { type: 'good', params: {} },
      ]),
    );

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ success: true, message: 'ok' });
    expect(results[1]?.success).toBe(false);
    expect(results[1]?.message).toContain('boom');
    expect(results[2]).toMatchObject({ success: true, message: 'ok' });
  });

  it('preserves a real 0ms durationMs from a tool instead of overwriting it', async () => {
    const { registerTool: register } = await import('../tools/registry');
    const { runWorkspace: run } = await import('./orchestrator');

    const instantTool: ToolPlugin = {
      type: 'instant',
      validate: () => ({ valid: true, errors: [] }),
      run: async () => ({ success: true, message: 'instant', durationMs: 0 }),
      teardown: vi.fn(),
    };
    register(instantTool);

    const results = await run(baseConfig([{ type: 'instant', params: {} }]));
    expect(results[0]?.durationMs).toBe(0);
  });

  it('reports a failed step, not a hang, when a tool never resolves', async () => {
    const { registerTool: register } = await import('../tools/registry');
    const { runWorkspace: run } = await import('./orchestrator');

    const hangingTool: ToolPlugin = {
      type: 'hangs',
      validate: () => ({ valid: true, errors: [] }),
      run: () => new Promise(() => {}), // never resolves
      teardown: vi.fn(),
    };
    register(hangingTool);

    const results = await run(baseConfig([{ type: 'hangs', params: {} }]));
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.message).toContain('timed out');
  });

  it('records a duration for a successful step, but not for a failed one', async () => {
    const { registerTool: register } = await import('../tools/registry');
    const { runWorkspace: run } = await import('./orchestrator');

    const goodTool: ToolPlugin = {
      type: 'good',
      validate: () => ({ valid: true, errors: [] }),
      run: async () => ({ success: true, message: 'ok', durationMs: 42 }),
      teardown: vi.fn(),
    };
    const failingTool: ToolPlugin = {
      type: 'fails',
      validate: () => ({ valid: true, errors: [] }),
      run: async () => ({ success: false, message: 'nope', durationMs: 7 }),
      teardown: vi.fn(),
    };
    register(goodTool);
    register(failingTool);

    await run(
      baseConfig([
        { type: 'good', params: {} },
        { type: 'fails', params: {} },
      ]),
    );

    expect(recordSuccessfulStepDuration).toHaveBeenCalledTimes(1);
    expect(recordSuccessfulStepDuration).toHaveBeenCalledWith('good', 42);
  });
});
