import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreWorkspace } from './handlers';
import { registerBuiltInTools } from '../tools';
import { getPlatformLauncher } from '../platform';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

// step-timing-history.ts (used by the orchestrator this transitively
// calls into) is backed by electron-store, which needs a real
// Electron `app` — unavailable under Vitest. See
// orchestrator.test.ts/step-timing-history.test.ts for the same mock
// and where that module's own logic is actually tested.
vi.mock('../orchestrator/step-timing-history', () => ({
  getStepTimeoutMs: () => 5000,
  recordSuccessfulStepDuration: () => {},
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const openInApp = vi.fn();

beforeAll(() => {
  // Real startup wiring (main/index.ts calls this once) — needed so
  // 'vscode' steps resolve to the real vscode-tool instead of "no
  // registered tool," same as it will at runtime.
  registerBuiltInTools();
});

beforeEach(() => {
  openInApp.mockReset().mockResolvedValue({ success: true, message: 'Opened.' });
  mockedGetPlatformLauncher.mockReset().mockReturnValue({
    launchApp: vi.fn(),
    openInApp,
    openUrlInBrowserProfile: vi.fn(),
  });
});

describe('restoreWorkspace', () => {
  it('throws for a non-string workspace id', async () => {
    await expect(restoreWorkspace(123)).rejects.toThrow(/workspace id/);
  });

  it('throws for an unknown workspace id', async () => {
    await expect(restoreWorkspace('does-not-exist')).rejects.toThrow(/No workspace found/);
  });

  it("runs a known workspace's steps through the orchestrator", async () => {
    const results = await restoreWorkspace('client-a');

    // client-a has 6 mock steps: vscode (registered) + 5 tool types
    // that don't have a plugin built yet.
    expect(results).toHaveLength(6);
    expect(openInApp).toHaveBeenCalledTimes(1);
  });

  it('runs the registered vscode step as a real success, not a stub', async () => {
    const results = await restoreWorkspace('client-a');
    expect(results[0]).toMatchObject({ success: true });
  });

  it('reports a not-yet-built tool type as a failed step, not a crash', async () => {
    const results = await restoreWorkspace('client-a');
    const dockerResult = results[1];
    expect(dockerResult?.success).toBe(false);
    expect(dockerResult?.message).toContain('docker');
  });
});
