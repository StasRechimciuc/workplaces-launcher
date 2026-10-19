import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolPlugin, WorkspaceConfig } from '@workspace-launcher/shared';
import { ERROR_CODES } from '@workspace-launcher/shared';
import { closeWorkspace, runWorkspace, switchToWorkspace } from './orchestrator';
import * as processControl from '../platform/macos/process-control';
import * as activityStore from './workspace-activity-store';

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

// Same electron-store hazard as step-timing-history.ts above — mocked
// wholesale; its own get/set logic is covered directly by
// workspace-activity-store.test.ts.
vi.mock('./workspace-activity-store', () => ({
  isIntentActive: vi.fn(() => false),
  setIntentActive: vi.fn(),
}));

// Never shell out to real osascript in a test — slow, non-deterministic,
// and would fail outright off-macOS. Its own parsing/success-shape
// logic is covered directly by process-control.test.ts.
vi.mock('../platform/macos/process-control', () => ({
  isAppRunning: vi.fn(async () => false),
  quitApp: vi.fn(async () => ({ success: true, message: '' })),
  waitForAppRunning: vi.fn(async () => ({ detected: false, elapsedMs: 0 })),
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
      {
        success: false,
        message: 'No registered tool for step type "nonexistent".',
        durationMs: 0,
        code: ERROR_CODES.TOOL_NOT_FOUND.code,
      },
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
    expect(results[0]?.code).toBe(ERROR_CODES.INVALID_STEP_PARAMS.code);
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
    expect(results[1]?.code).toBe(ERROR_CODES.STEP_FAILED.code);
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

  describe('macOS launch-time measurement', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      vi.mocked(processControl.waitForAppRunning).mockReset();
    });

    afterEach(() => {
      // configurable: true defensively, even though every test in this
      // block currently calls setPlatform() (which already sets it)
      // before this runs — this restore must stay redefinable even if
      // a future test in this block is added without calling it first.
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    function setPlatform(platform: string): void {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    }

    it("on macOS, records the step type's instant-return duration plus the detected app-launch delay — detached, never blocking the step's own return", async () => {
      setPlatform('darwin');
      vi.mocked(processControl.waitForAppRunning).mockResolvedValue({
        detected: true,
        elapsedMs: 100,
      });
      const { registerTool: register } = await import('../tools/registry');
      const { runWorkspace: run } = await import('./orchestrator');
      const vscodeTool: ToolPlugin = {
        type: 'vscode',
        validate: () => ({ valid: true, data: {} }),
        run: async () => ({ success: true, message: 'ok', durationMs: 5 }),
        teardown: vi.fn(),
      };
      register(vscodeTool);

      const results = await run(baseConfig([{ type: 'vscode', params: { path: '/x' } }]));

      // The returned result reflects only the synchronously-known value
      // — the improved measurement isn't known yet at return time.
      expect(results[0]).toMatchObject({ success: true, durationMs: 5 });
      await vi.waitFor(() => {
        expect(recordSuccessfulStepDuration).toHaveBeenCalledWith('vscode', 105);
      });
    });

    it('falls back to the plain instant-return duration, not an inflated timeout value, when the app is never detected running', async () => {
      setPlatform('darwin');
      vi.mocked(processControl.waitForAppRunning).mockResolvedValue({
        detected: false,
        elapsedMs: 120000,
      });
      const { registerTool: register } = await import('../tools/registry');
      const { runWorkspace: run } = await import('./orchestrator');
      const vscodeTool: ToolPlugin = {
        type: 'vscode',
        validate: () => ({ valid: true, data: {} }),
        run: async () => ({ success: true, message: 'ok', durationMs: 5 }),
        teardown: vi.fn(),
      };
      register(vscodeTool);

      await run(baseConfig([{ type: 'vscode', params: { path: '/x' } }]));

      await vi.waitFor(() => {
        expect(recordSuccessfulStepDuration).toHaveBeenCalledWith('vscode', 5);
      });
    });

    it('never polls for a step type with no mac app mapping, even on macOS', async () => {
      setPlatform('darwin');
      const { registerTool: register } = await import('../tools/registry');
      const { runWorkspace: run } = await import('./orchestrator');
      const goodTool: ToolPlugin = {
        type: 'good',
        validate: () => ({ valid: true, data: {} }),
        run: async () => ({ success: true, message: 'ok', durationMs: 5 }),
        teardown: vi.fn(),
      };
      register(goodTool);

      await run(baseConfig([{ type: 'good', params: {} }]));

      expect(processControl.waitForAppRunning).not.toHaveBeenCalled();
      expect(recordSuccessfulStepDuration).toHaveBeenCalledWith('good', 5);
    });

    it('never polls on a non-macOS platform, even for a step type with a mac app mapping', async () => {
      setPlatform('win32');
      const { registerTool: register } = await import('../tools/registry');
      const { runWorkspace: run } = await import('./orchestrator');
      const vscodeTool: ToolPlugin = {
        type: 'vscode',
        validate: () => ({ valid: true, data: {} }),
        run: async () => ({ success: true, message: 'ok', durationMs: 5 }),
        teardown: vi.fn(),
      };
      register(vscodeTool);

      await run(baseConfig([{ type: 'vscode', params: { path: '/x' } }]));

      expect(processControl.waitForAppRunning).not.toHaveBeenCalled();
      expect(recordSuccessfulStepDuration).toHaveBeenCalledWith('vscode', 5);
    });

    it('still reports the step as successful, and still records the plain duration, if the poll itself rejects', async () => {
      setPlatform('darwin');
      vi.mocked(processControl.waitForAppRunning).mockRejectedValue(new Error('osascript exploded'));
      const { registerTool: register } = await import('../tools/registry');
      const { runWorkspace: run } = await import('./orchestrator');
      const vscodeTool: ToolPlugin = {
        type: 'vscode',
        validate: () => ({ valid: true, data: {} }),
        run: async () => ({ success: true, message: 'ok', durationMs: 5 }),
        teardown: vi.fn(),
      };
      register(vscodeTool);

      const results = await run(baseConfig([{ type: 'vscode', params: { path: '/x' } }]));

      expect(results[0]).toMatchObject({ success: true, durationMs: 5 });
      // A rejected poll never records anything — there's nothing to fall
      // back to inside a .catch(), and that's fine: this run's duration
      // measurement for history is simply skipped, not corrupted.
      await vi.waitFor(() => {
        expect(processControl.waitForAppRunning).toHaveBeenCalled();
      });
      expect(recordSuccessfulStepDuration).not.toHaveBeenCalled();
    });
  });
});

describe('retryStep', () => {
  beforeEach(() => {
    vi.resetModules();
    getStepTimeoutMs.mockClear();
    recordSuccessfulStepDuration.mockClear();
  });

  function baseConfig(steps: WorkspaceConfig['steps']): WorkspaceConfig {
    return { version: 1, id: 'ws-1', name: 'Test workspace', steps };
  }

  it('re-runs exactly the step at the given index', async () => {
    const { registerTool: register } = await import('../tools/registry');
    const { retryStep: retry } = await import('./orchestrator');

    const goodTool: ToolPlugin = {
      type: 'good',
      validate: (params) => ({ valid: true, data: params }),
      run: vi.fn(async () => ({ success: true, message: 'ok', durationMs: 5 })),
      teardown: vi.fn(),
    };
    register(goodTool);

    const result = await retry(
      baseConfig([
        { type: 'good', params: { a: 1 } },
        { type: 'good', params: { a: 2 } },
      ]),
      1,
    );

    expect(result).toMatchObject({ success: true, message: 'ok' });
    expect(goodTool.run).toHaveBeenCalledTimes(1);
    expect(goodTool.run).toHaveBeenCalledWith({ a: 2 }, { workspaceId: 'ws-1' });
  });

  it('reports a failed result, not a throw, for an out-of-range index', async () => {
    const { retryStep: retry } = await import('./orchestrator');

    const result = await retry(baseConfig([{ type: 'good', params: {} }]), 5);

    expect(result.success).toBe(false);
    expect(result.message).toContain('No step at index 5');
    expect(result.code).toBe(ERROR_CODES.RETRY_STEP_NOT_FOUND.code);
  });

  it('reports a failed result for a negative index, without throwing', async () => {
    const { retryStep: retry } = await import('./orchestrator');

    const result = await retry(baseConfig([{ type: 'good', params: {} }]), -1);

    expect(result.success).toBe(false);
    expect(result.code).toBe(ERROR_CODES.RETRY_STEP_NOT_FOUND.code);
  });

  it('surfaces a failing retried step as a failed result, same as a normal run', async () => {
    const { registerTool: register } = await import('../tools/registry');
    const { retryStep: retry } = await import('./orchestrator');

    const failingTool: ToolPlugin = {
      type: 'fails',
      validate: () => ({ valid: true, data: {} }),
      run: async () => ({ success: false, message: 'still broken', durationMs: 3 }),
      teardown: vi.fn(),
    };
    register(failingTool);

    const result = await retry(baseConfig([{ type: 'fails', params: {} }]), 0);

    expect(result).toMatchObject({ success: false, message: 'still broken' });
  });
});

// These don't register a tool for 'vscode'/'chrome'/etc — stepResults
// will contain TOOL_NOT_FOUND failures, which is fine: these tests are
// about switchToWorkspace/closeWorkspace's own close/open bookkeeping,
// not tool execution (already covered by the runWorkspace tests above).
describe('switchToWorkspace', () => {
  const isAppRunningMock = vi.mocked(processControl.isAppRunning);
  const quitAppMock = vi.mocked(processControl.quitApp);
  const setIntentActiveMock = vi.mocked(activityStore.setIntentActive);
  const isIntentActiveMock = vi.mocked(activityStore.isIntentActive);

  beforeEach(() => {
    isAppRunningMock.mockReset().mockResolvedValue(false);
    quitAppMock.mockReset().mockResolvedValue({ success: true, message: '' });
    setIntentActiveMock.mockReset();
    isIntentActiveMock.mockReset().mockReturnValue(false);
  });

  function workspace(id: string, steps: WorkspaceConfig['steps']): WorkspaceConfig {
    return { version: 1, id, name: id, steps };
  }

  it("closes a running app an ACTIVE other workspace opened, runs the target's own steps, and updates intent for both sides", async () => {
    const a = workspace('a', [{ type: 'vscode', params: { path: '/a' } }]);
    const b = workspace('b', [{ type: 'clockify', params: {} }]);
    isIntentActiveMock.mockImplementation((id: string) => id === 'a');
    isAppRunningMock.mockImplementation(async (name) => name === 'Visual Studio Code');

    const result = await switchToWorkspace(b, [a, b]);

    expect(quitAppMock).toHaveBeenCalledWith('Visual Studio Code');
    expect(result.closed).toEqual(['Visual Studio Code']);
    expect(result.stepResults).toHaveLength(1);
    expect(setIntentActiveMock).toHaveBeenCalledWith('a', false);
    expect(setIntentActiveMock).toHaveBeenCalledWith('b', true); // set by runWorkspace itself
  });

  it("never touches an app just because SOME config (e.g. unused demo/mock data) mentions it — only a workspace that's actually active counts", async () => {
    // Regression test for a real bug found live: the user had their own
    // VS Code open for unrelated work; a bundled demo workspace (never
    // restored, never active) happened to have a vscode step. Switching
    // between two unrelated real workspaces (neither using VS Code at
    // all) must never touch it.
    const demo = workspace('demo-unused', [{ type: 'vscode', params: { path: '/demo' } }]);
    const figma = workspace('figma', [{ type: 'app', params: { path: '/Applications/Figma.app' } }]);
    const proton = workspace('proton', [
      { type: 'app', params: { path: '/Applications/ProtonVPN.app' } },
    ]);
    // demo-unused is never intent-active — isIntentActiveMock's default
    // (false for everything) already models that.
    isAppRunningMock.mockImplementation(async (name) => name === 'Visual Studio Code');

    const result = await switchToWorkspace(proton, [demo, figma, proton]);

    expect(quitAppMock).not.toHaveBeenCalled();
    expect(result.closed).toEqual([]);
    expect(result.leftOpen).toEqual([]);
  });

  it("leaves another workspace's intent untouched when one of its apps fails to quit", async () => {
    const a = workspace('a', [
      { type: 'vscode', params: { path: '/a' } },
      { type: 'spotify', params: {} },
    ]);
    const b = workspace('b', [{ type: 'clockify', params: {} }]);
    isIntentActiveMock.mockImplementation((id: string) => id === 'a');
    isAppRunningMock.mockImplementation(
      async (name) => name === 'Visual Studio Code' || name === 'Spotify',
    );
    quitAppMock.mockImplementation(async (name) =>
      name === 'Visual Studio Code'
        ? { success: false, message: 'declined to quit' }
        : { success: true, message: '' },
    );

    const result = await switchToWorkspace(b, [a, b]);

    expect(result.closed).toEqual(['Spotify']);
    expect(result.leftOpen).toEqual([
      { appName: 'Visual Studio Code', reason: 'failed', detail: 'declined to quit' },
    ]);
    expect(setIntentActiveMock).not.toHaveBeenCalledWith('a', false);
  });

  it('never closes Chrome even when an active other workspace owns it, reporting it excluded instead', async () => {
    const a = workspace('a', [{ type: 'chrome', params: { profile: 'Work' } }]);
    const b = workspace('b', [{ type: 'clockify', params: {} }]);
    isIntentActiveMock.mockImplementation((id: string) => id === 'a');
    isAppRunningMock.mockImplementation(async (name) => name === 'Google Chrome');

    const result = await switchToWorkspace(b, [a, b]);

    expect(quitAppMock).not.toHaveBeenCalled();
    expect(result.closed).toEqual([]);
    expect(result.leftOpen).toEqual([{ appName: 'Google Chrome', reason: 'excluded' }]);
  });

  it('never closes an app the target itself also needs', async () => {
    const a = workspace('a', [{ type: 'spotify', params: {} }]);
    const b = workspace('b', [{ type: 'spotify', params: {} }]);
    isAppRunningMock.mockImplementation(async (name) => name === 'Spotify');

    const result = await switchToWorkspace(b, [a, b]);

    expect(quitAppMock).not.toHaveBeenCalled();
    expect(result.closed).toEqual([]);
    expect(result.leftOpen).toEqual([]);
  });

  it('never attempts to close an app that is not actually running', async () => {
    const a = workspace('a', [{ type: 'vscode', params: { path: '/a' } }]);
    const b = workspace('b', [{ type: 'clockify', params: {} }]);
    isAppRunningMock.mockResolvedValue(false);

    const result = await switchToWorkspace(b, [a, b]);

    expect(quitAppMock).not.toHaveBeenCalled();
    expect(result.closed).toEqual([]);
  });

  it('clears intent on every other workspace that was active, not just one, regardless of how many were stacked up via Restore', async () => {
    // Mirrors a real usage pattern: Restore is additive, so a user can
    // stack up several active workspaces (figma, proton) before a
    // single Switch reconciles all of them down to just the target.
    const figma = workspace('figma', [{ type: 'app', params: { path: '/Applications/Figma.app' } }]);
    const proton = workspace('proton', [
      { type: 'app', params: { path: '/Applications/ProtonVPN.app' } },
    ]);
    const primary = workspace('primary', [{ type: 'vscode', params: { path: '/primary' } }]);
    isIntentActiveMock.mockImplementation((id: string) => id === 'figma' || id === 'proton');
    isAppRunningMock.mockImplementation(
      async (name) => name === 'Figma' || name === 'ProtonVPN',
    );

    const result = await switchToWorkspace(primary, [figma, proton, primary]);

    expect(result.closed.sort()).toEqual(['Figma', 'ProtonVPN']);
    expect(setIntentActiveMock).toHaveBeenCalledWith('figma', false);
    expect(setIntentActiveMock).toHaveBeenCalledWith('proton', false);
    expect(setIntentActiveMock).toHaveBeenCalledWith('primary', true); // set by runWorkspace itself
  });
});

describe('closeWorkspace', () => {
  const isAppRunningMock = vi.mocked(processControl.isAppRunning);
  const quitAppMock = vi.mocked(processControl.quitApp);
  const isIntentActiveMock = vi.mocked(activityStore.isIntentActive);
  const setIntentActiveMock = vi.mocked(activityStore.setIntentActive);

  beforeEach(() => {
    isAppRunningMock.mockReset().mockResolvedValue(false);
    quitAppMock.mockReset().mockResolvedValue({ success: true, message: '' });
    isIntentActiveMock.mockReset().mockReturnValue(false);
    setIntentActiveMock.mockReset();
  });

  function workspace(id: string, steps: WorkspaceConfig['steps']): WorkspaceConfig {
    return { version: 1, id, name: id, steps };
  }

  it('closes its own running app and clears only its own intent', async () => {
    const a = workspace('a', [{ type: 'vscode', params: { path: '/a' } }]);
    const b = workspace('b', [{ type: 'clockify', params: {} }]);
    isAppRunningMock.mockImplementation(async (name) => name === 'Visual Studio Code');

    const result = await closeWorkspace(a, [a, b]);

    expect(quitAppMock).toHaveBeenCalledWith('Visual Studio Code');
    expect(result.closed).toEqual(['Visual Studio Code']);
    expect(setIntentActiveMock).toHaveBeenCalledWith('a', false);
  });

  it('leaves Chrome open, reporting it excluded', async () => {
    const a = workspace('a', [{ type: 'chrome', params: { profile: 'Work' } }]);
    isAppRunningMock.mockImplementation(async (name) => name === 'Google Chrome');

    const result = await closeWorkspace(a, [a]);

    expect(quitAppMock).not.toHaveBeenCalled();
    expect(result.leftOpen).toEqual([{ appName: 'Google Chrome', reason: 'excluded' }]);
  });

  it('leaves an app open when another currently-active workspace still needs it', async () => {
    const a = workspace('a', [{ type: 'spotify', params: {} }]);
    const b = workspace('b', [{ type: 'spotify', params: {} }]);
    isAppRunningMock.mockImplementation(async (name) => name === 'Spotify');
    isIntentActiveMock.mockImplementation((id: string) => id === 'b');

    const result = await closeWorkspace(a, [a, b]);

    expect(quitAppMock).not.toHaveBeenCalled();
    expect(result.leftOpen).toEqual([{ appName: 'Spotify', reason: 'still-used' }]);
  });

  it('never opens anything, and never touches another workspace', async () => {
    const a = workspace('a', [{ type: 'vscode', params: { path: '/a' } }]);
    const b = workspace('b', [{ type: 'clockify', params: {} }]);
    isAppRunningMock.mockResolvedValue(false);

    await closeWorkspace(a, [a, b]);

    expect(setIntentActiveMock).not.toHaveBeenCalledWith('b', expect.anything());
  });

  it('does not clear intent when a quit fails, and reports the failure instead of swallowing it', async () => {
    const a = workspace('a', [{ type: 'vscode', params: { path: '/a' } }]);
    isAppRunningMock.mockImplementation(async (name) => name === 'Visual Studio Code');
    quitAppMock.mockResolvedValue({ success: false, message: 'declined to quit' });

    const result = await closeWorkspace(a, [a]);

    expect(result.closed).toEqual([]);
    expect(result.leftOpen).toEqual([
      { appName: 'Visual Studio Code', reason: 'failed', detail: 'declined to quit' },
    ]);
    expect(setIntentActiveMock).not.toHaveBeenCalled();
  });

  it('never reports "left open" for an app that was never running, excluded or not', async () => {
    const a = workspace('a', [{ type: 'chrome', params: { profile: 'Work' } }]);
    isAppRunningMock.mockResolvedValue(false);

    const result = await closeWorkspace(a, [a]);

    expect(result.leftOpen).toEqual([]);
    expect(setIntentActiveMock).toHaveBeenCalledWith('a', false);
  });
});
