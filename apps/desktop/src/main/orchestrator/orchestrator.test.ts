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
      validate: () => ({ valid: true, data: {} }),
      run: async () => ({ success: true, message: 'ok', durationMs: 5 }),
      teardown: vi.fn(),
    };
    const throwingTool: ToolPlugin = {
      type: 'throws',
      validate: () => ({ valid: true, data: {} }),
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
      validate: () => ({ valid: true, data: {} }),
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
      validate: () => ({ valid: true, data: {} }),
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
      validate: () => ({ valid: true, data: {} }),
      run: async () => ({ success: true, message: 'ok', durationMs: 42 }),
      teardown: vi.fn(),
    };
    const failingTool: ToolPlugin = {
      type: 'fails',
      validate: () => ({ valid: true, data: {} }),
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

  it('still reports the step as successful when recording its timing throws', async () => {
    const { registerTool: register } = await import('../tools/registry');
    const { runWorkspace: run } = await import('./orchestrator');

    const goodTool: ToolPlugin = {
      type: 'good',
      validate: () => ({ valid: true, data: {} }),
      run: async () => ({ success: true, message: 'ok', durationMs: 42 }),
      teardown: vi.fn(),
    };
    register(goodTool);
    recordSuccessfulStepDuration.mockImplementationOnce(() => {
      throw new Error('store write failed');
    });

    const results = await run(baseConfig([{ type: 'good', params: {} }]));

    expect(results[0]).toMatchObject({ success: true, message: 'ok', durationMs: 42 });
  });

  it('calls onStepProgress with a running then a final event per step, in order', async () => {
    const { registerTool: register } = await import('../tools/registry');
    const { runWorkspace: run } = await import('./orchestrator');

    const goodTool: ToolPlugin = {
      type: 'good',
      validate: () => ({ valid: true, data: {} }),
      run: async () => ({ success: true, message: 'ok', durationMs: 5 }),
      teardown: vi.fn(),
    };
    const failingTool: ToolPlugin = {
      type: 'fails',
      validate: () => ({ valid: true, data: {} }),
      run: async () => ({ success: false, message: 'nope', durationMs: 5 }),
      teardown: vi.fn(),
    };
    register(goodTool);
    register(failingTool);

    const onStepProgress = vi.fn();
    await run(
      baseConfig([
        { type: 'good', params: {} },
        { type: 'fails', params: {} },
      ]),
      { onStepProgress },
    );

    expect(onStepProgress.mock.calls.map((call) => call[0])).toEqual([
      { workspaceId: 'ws-1', stepIndex: 0, total: 2, status: 'running' },
      { workspaceId: 'ws-1', stepIndex: 0, total: 2, status: 'success', message: 'ok' },
      { workspaceId: 'ws-1', stepIndex: 1, total: 2, status: 'running' },
      { workspaceId: 'ws-1', stepIndex: 1, total: 2, status: 'failure', message: 'nope' },
    ]);
  });

  it('never calls onStepProgress when it is omitted, and behaves exactly as before', async () => {
    const { registerTool: register } = await import('../tools/registry');
    const { runWorkspace: run } = await import('./orchestrator');

    const goodTool: ToolPlugin = {
      type: 'good',
      validate: () => ({ valid: true, data: {} }),
      run: async () => ({ success: true, message: 'ok', durationMs: 5 }),
      teardown: vi.fn(),
    };
    register(goodTool);

    const results = await run(baseConfig([{ type: 'good', params: {} }]));
    expect(results).toMatchObject([{ success: true, message: 'ok' }]);
  });
});
