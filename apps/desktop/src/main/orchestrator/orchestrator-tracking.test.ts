import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ResourceSpec,
  StepResult,
  ToolPlugin,
  WorkspaceConfig,
} from '@workspace-launcher/shared';
import {
  closeRemovedSteps,
  closeWorkspace,
  getActiveWorkspaceIds,
  markWorkspaceDetectedActive,
  previewWorkspaceStepRemoval,
  releaseDeletedWorkspace,
  retryStep,
  runWorkspace,
  switchToWorkspace,
} from './orchestrator';
import * as processControl from '../platform/macos/process-control';
import * as activityStore from './workspace-activity-store';
import { registerTool } from '../tools/registry';
import { registerResourceKind } from '../resources/kind-registry';
import { addResource, emptyLedger, resourcesOwnedBy } from '../resources/ledger';
import { ResourceLedgerStore } from '../resources/ledger-store';
import { reconcileOpeningRecords, setLedgerStore } from '../resources/runtime';
import type { CloseOutcome, ResourceHandle, ResourceKindPlugin } from '../resources/types';

// The tracked path end to end: the real orchestrator, ledger and
// tracking code against fake resource kinds whose "world" (what's
// running) each test scripts. The app-level path's own behavior is
// covered by orchestrator.test.ts; here it only appears where the two
// meet (coexistence, the upgrade fallback, tracking turned off).

vi.mock('../platform/macos/process-control', () => ({
  isAppRunning: vi.fn(),
  quitApp: vi.fn(),
  waitForAppRunning: vi.fn(() => Promise.resolve({ detected: true, elapsedMs: 0 })),
}));

vi.mock('./workspace-activity-store', () => {
  const intent = new Map<string, boolean>();
  return {
    isIntentActive: vi.fn((id: string) => intent.get(id) === true),
    setIntentActive: vi.fn((id: string, active: boolean) => intent.set(id, active)),
    __reset: () => intent.clear(),
  };
});

vi.mock('./step-timing-history', () => ({
  getStepTimeoutMs: () => 5000,
  recordSuccessfulStepDuration: vi.fn(),
}));

/** What's "running", per identity key: instance ids. */
const world = new Map<string, number[]>();
let nextInstance = 1;
const closeOutcome = new Map<string, CloseOutcome['outcome']>();
const closes: string[] = [];
const runs: string[] = [];

function makeKind(
  kind: string,
  openIsIdempotent: boolean,
  closesWholeApp: boolean,
): ResourceKindPlugin {
  const key = (identity: ResourceSpec['identity']): string => String(identity['name']);
  const running = (identity: ResourceSpec['identity']): number[] => world.get(key(identity)) ?? [];
  return {
    kind,
    openIsIdempotent,
    closesWholeApp,
    async snapshot(identity) {
      return [...running(identity)];
    },
    async capture(identity, snapshot) {
      const before = snapshot as number[];
      const now = running(identity);
      if (now.length === 0) return { found: false, reason: 'nothing running' };
      const fresh = now.find((i) => !before.includes(i));
      return {
        found: true,
        handle: { name: key(identity), instance: fresh ?? now[0] },
        preexisting: fresh === undefined,
      };
    },
    async findLive(identity) {
      const now = running(identity);
      return now.length > 0 ? { name: key(identity), instance: now[0] } : null;
    },
    async check(handle: ResourceHandle) {
      return (world.get(String(handle['name'])) ?? []).includes(handle['instance'] as number)
        ? { state: 'alive' }
        : { state: 'gone' };
    },
    async close(handle: ResourceHandle) {
      const name = String(handle['name']);
      const outcome = closeOutcome.get(name) ?? 'closed';
      closes.push(name);
      if (outcome === 'closed') {
        world.set(
          name,
          (world.get(name) ?? []).filter((i) => i !== handle['instance']),
        );
        return { outcome: 'closed' };
      }
      if (outcome === 'already-gone') return { outcome: 'already-gone' };
      return { outcome, detail: `${outcome} for test` } as CloseOutcome;
    },
    async reconcileOpening(identity) {
      const now = running(identity);
      return now.length > 0
        ? { found: true, handle: { name: key(identity), instance: now[0] }, preexisting: false }
        : { found: false, reason: 'not running' };
    },
  };
}

registerResourceKind(makeKind('fake-app', true, true));
registerResourceKind(makeKind('fake-window', false, false));

/**
 * A step that opens one resource of `kind` named `params.name`. Its
 * label doubles as the app name the app-level path would use for it.
 */
function trackedTool(type: string, kind: string): ToolPlugin<{ name: string; fail?: boolean }> {
  return {
    type,
    validate: (params) => ({ valid: true, data: params as { name: string; fail?: boolean } }),
    async run(params): Promise<StepResult> {
      runs.push(params.name);
      const existing = world.get(params.name) ?? [];
      // An app is reused by the OS if running; a window always opens anew.
      if (kind === 'fake-window' || existing.length === 0) {
        world.set(params.name, [...existing, nextInstance++]);
      }
      return params.fail
        ? { success: false, message: 'failed after opening', durationMs: 1 }
        : { success: true, message: 'opened', durationMs: 1 };
    },
    async teardown() {
      return { success: true, message: '', durationMs: 0 };
    },
    async resources(params) {
      // An app resource is the app itself, so its app-level name is its label.
      return [
        {
          kind,
          identity: { name: params.name },
          label: params.name,
          ...(kind === 'fake-app' ? { appName: params.name } : {}),
        },
      ];
    },
  };
}

registerTool(trackedTool('t-app', 'fake-app') as ToolPlugin);
registerTool(trackedTool('t-window', 'fake-window') as ToolPlugin);
// A tracked step whose type the app-level path also knows by name
// (tool-identity.ts maps 'spotify' to "Spotify") — for the upgrade case.
registerTool(trackedTool('spotify', 'fake-app') as ToolPlugin);
// Untracked: the real 'app' type's app-level name is the bundle's
// display name (tool-identity.ts), so `path: '/Applications/Music.app'`
// is app-level "Music".
registerTool({
  type: 'app',
  validate: (params) => ({ valid: true, data: params }),
  run: async () => ({ success: true, message: 'opened', durationMs: 1 }),
  teardown: async () => ({ success: true, message: '', durationMs: 0 }),
});

function memoryStore(): ResourceLedgerStore {
  let stored: unknown;
  const store = new ResourceLedgerStore({
    read: () => stored,
    write: (l) => {
      stored = JSON.parse(JSON.stringify(l));
    },
  });
  store.load('boot-1');
  return store;
}

let store: ResourceLedgerStore;

function ws(
  id: string,
  steps: { id?: string; type: string; params: Record<string, unknown> }[],
): WorkspaceConfig {
  return {
    version: 2,
    id,
    name: id,
    steps: steps.map((s, i) => ({ id: s.id ?? `${id}-step-${i}`, type: s.type, params: s.params })),
  };
}

beforeEach(() => {
  world.clear();
  closeOutcome.clear();
  closes.length = 0;
  runs.length = 0;
  store = memoryStore();
  setLedgerStore(store);
  (activityStore as unknown as { __reset: () => void }).__reset();
  vi.mocked(activityStore.setIntentActive).mockClear();
  vi.mocked(processControl.isAppRunning).mockReset().mockResolvedValue(false);
  vi.mocked(processControl.quitApp)
    .mockReset()
    .mockResolvedValue({ success: true, message: 'quit' });
});

afterEach(() => {
  setLedgerStore(null);
});

describe('restore', () => {
  it('records what a step opened as ours', async () => {
    const a = ws('A', [{ type: 't-window', params: { name: 'term' } }]);
    await runWorkspace(a);
    const [resource] = store.get().resources;
    expect(resource).toMatchObject({ state: 'open', createdByApp: true, label: 'term' });
    expect(resource?.owners).toEqual([{ workspaceId: 'A', stepId: 'A-step-0' }]);
  });

  it('reuses a live window instead of opening a second one', async () => {
    const a = ws('A', [{ type: 't-window', params: { name: 'term' } }]);
    await runWorkspace(a);
    const [second] = await runWorkspace(a);
    expect(runs).toEqual(['term']);
    expect(world.get('term')).toHaveLength(1);
    expect(second).toMatchObject({ success: true, message: 'Already open — reused.' });
  });

  it('re-runs an app step (its link/playlist is the point) without duplicating the app', async () => {
    const a = ws('A', [{ type: 't-app', params: { name: 'Spotify' } }]);
    await runWorkspace(a);
    await runWorkspace(a);
    expect(runs).toEqual(['Spotify', 'Spotify']);
    expect(store.get().resources).toHaveLength(1);
  });

  it('records an app the user already had open as not ours', async () => {
    world.set('Spotify', [99]);
    await runWorkspace(ws('A', [{ type: 't-app', params: { name: 'Spotify' } }]));
    expect(store.get().resources[0]).toMatchObject({ createdByApp: false });
  });

  it('still records what a failed step opened', async () => {
    const [result] = await runWorkspace(
      ws('A', [{ type: 't-window', params: { name: 'term', fail: true } }]),
    );
    expect(result?.success).toBe(false);
    expect(store.get().resources[0]).toMatchObject({ state: 'open', label: 'term' });
  });

  it('drops a write-ahead record when nothing turned up', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerTool({
      ...(trackedTool('t-noop', 'fake-window') as ToolPlugin),
      run: async () => ({ success: false, message: 'never opened', durationMs: 1 }),
    });
    await runWorkspace(ws('A', [{ type: 't-noop', params: { name: 'ghost' } }]));
    expect(store.get().resources).toEqual([]);
    errorSpy.mockRestore();
  });

  it('releases and closes what steps edited out of the workspace had opened', async () => {
    const before = ws('A', [
      { id: 'keep', type: 't-window', params: { name: 'one' } },
      { id: 'gone', type: 't-window', params: { name: 'two' } },
    ]);
    await runWorkspace(before);
    const after = ws('A', [{ id: 'keep', type: 't-window', params: { name: 'one' } }]);
    await runWorkspace(after, { allConfigs: [after] });
    expect(closes).toEqual(['two']);
    expect(store.get().resources.map((r) => r.label)).toEqual(['one']);
  });
});

describe('close', () => {
  it('closes what it opened and nothing claims, and removes it from the ledger', async () => {
    const a = ws('A', [{ type: 't-window', params: { name: 'term' } }]);
    await runWorkspace(a);
    await expect(closeWorkspace(a, [a])).resolves.toEqual({ closed: ['term'], leftOpen: [] });
    expect(store.get().resources).toEqual([]);
    expect(activityStore.setIntentActive).toHaveBeenLastCalledWith('A', false);
  });

  it('leaves the user’s own app alone', async () => {
    world.set('Spotify', [99]);
    const a = ws('A', [{ type: 't-app', params: { name: 'Spotify' } }]);
    await runWorkspace(a);
    const result = await closeWorkspace(a, [a]);
    expect(result).toEqual({ closed: [], leftOpen: [{ appName: 'Spotify', reason: 'not-ours' }] });
    expect(closes).toEqual([]);
  });

  it('keeps a resource another workspace still claims', async () => {
    const a = ws('A', [{ type: 't-app', params: { name: 'Spotify' } }]);
    const b = ws('B', [{ type: 't-app', params: { name: 'Spotify' } }]);
    await runWorkspace(a);
    await runWorkspace(b);
    await expect(closeWorkspace(a, [a, b])).resolves.toEqual({
      closed: [],
      leftOpen: [{ appName: 'Spotify', reason: 'still-used', usedBy: ['B'] }],
    });
    expect(closes).toEqual([]);
    expect(resourcesOwnedBy(store.get(), 'B')).toHaveLength(1);
  });

  it('keeps an app an active workspace’s untracked step uses by name', async () => {
    const a = ws('A', [{ type: 't-app', params: { name: 'Music' } }]);
    const b = ws('B', [{ type: 'app', params: { path: '/Applications/Music.app' } }]);
    await runWorkspace(a);
    await runWorkspace(b);
    vi.mocked(processControl.isAppRunning).mockResolvedValue(true);
    const result = await closeWorkspace(a, [a, b]);
    expect(result.leftOpen).toEqual([{ appName: 'Music', reason: 'still-used' }]);
    expect(closes).toEqual([]);
  });

  it('never lets the app-level path quit an app the ledger still has owners for', async () => {
    const a = ws('A', [{ type: 'app', params: { path: '/Applications/Music.app' } }]);
    const b = ws('B', [{ type: 't-app', params: { name: 'Music' } }]);
    await runWorkspace(a);
    await runWorkspace(b);
    vi.mocked(processControl.isAppRunning).mockResolvedValue(true);
    const result = await closeWorkspace(a, [a, b]);
    expect(result.leftOpen).toEqual([{ appName: 'Music', reason: 'still-used' }]);
    expect(processControl.quitApp).not.toHaveBeenCalled();
  });

  it('reports an app that chose to stay open, and forgets it', async () => {
    const a = ws('A', [{ type: 't-app', params: { name: 'Editor' } }]);
    await runWorkspace(a);
    closeOutcome.set('Editor', 'kept-running');
    const result = await closeWorkspace(a, [a]);
    expect(result.leftOpen).toEqual([
      { appName: 'Editor', reason: 'kept-running', detail: 'kept-running for test' },
    ]);
    expect(store.get().resources).toEqual([]);
  });

  it('keeps a refused close (unsaved changes) claimed, so Close works again once dealt with', async () => {
    const a = ws('A', [{ type: 't-window', params: { name: 'editor' } }]);
    await runWorkspace(a);
    closeOutcome.set('editor', 'refused');
    const first = await closeWorkspace(a, [a]);
    expect(first.leftOpen).toEqual([
      { appName: 'editor', reason: 'kept-running', detail: 'refused for test' },
    ]);
    expect(resourcesOwnedBy(store.get(), 'A')).toHaveLength(1);
    expect(await getActiveWorkspaceIds([a])).toEqual(new Set(['A']));

    closeOutcome.delete('editor');
    await expect(closeWorkspace(a, [a])).resolves.toEqual({ closed: ['editor'], leftOpen: [] });
    expect(store.get().resources).toEqual([]);
  });

  it('keeps a failed close in the ledger and the workspace marked active', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = ws('A', [{ type: 't-window', params: { name: 'term' } }]);
    await runWorkspace(a);
    closeOutcome.set('term', 'failed');
    const result = await closeWorkspace(a, [a]);
    expect(result.leftOpen).toEqual([
      { appName: 'term', reason: 'failed', detail: 'failed for test' },
    ]);
    expect(store.get().resources).toHaveLength(1);
    expect(activityStore.setIntentActive).not.toHaveBeenCalledWith('A', false);
    errorSpy.mockRestore();
  });

  it('gives a workspace made active before tracking the app-level close one last time', async () => {
    const a = ws('A', [{ type: 'spotify', params: { name: 'Spotify' } }]);
    vi.mocked(activityStore.setIntentActive)('A', true);
    vi.mocked(processControl.isAppRunning).mockResolvedValue(true);
    const result = await closeWorkspace(a, [a]);
    expect(processControl.quitApp).toHaveBeenCalledWith('Spotify');
    expect(result.closed).toEqual(['Spotify']);
  });
});

describe('switch', () => {
  it('closes the other workspace’s resources but hands over what the target also needs', async () => {
    const a = ws('A', [
      { type: 't-app', params: { name: 'Spotify' } },
      { type: 't-window', params: { name: 'a-term' } },
    ]);
    const b = ws('B', [{ type: 't-app', params: { name: 'Spotify' } }]);
    await runWorkspace(a);
    const result = await switchToWorkspace(b, [a, b]);
    expect(result.closed).toEqual(['a-term']);
    expect(closes).toEqual(['a-term']);
    expect(resourcesOwnedBy(store.get(), 'A')).toEqual([]);
    expect(resourcesOwnedBy(store.get(), 'B').map((r) => r.label)).toEqual(['Spotify']);
    expect(store.get().resources.find((r) => r.label === 'Spotify')?.createdByApp).toBe(true);
  });
});

describe('retry', () => {
  it('closes the step’s own window and opens a fresh one — never two side by side', async () => {
    const a = ws('A', [{ type: 't-window', params: { name: 'term', fail: true } }]);
    await runWorkspace(a);
    const firstInstance = world.get('term')?.[0];
    await retryStep(a, 0);
    expect(closes).toEqual(['term']);
    expect(world.get('term')).toHaveLength(1);
    expect(world.get('term')?.[0]).not.toBe(firstInstance);
    expect(store.get().resources).toHaveLength(1);
  });

  it('never quits an app to retry its step', async () => {
    const a = ws('A', [{ type: 't-app', params: { name: 'Spotify' } }]);
    await runWorkspace(a);
    await retryStep(a, 0);
    expect(closes).toEqual([]);
    expect(runs).toEqual(['Spotify', 'Spotify']);
  });
});

describe('activity, delete, save-current', () => {
  it('is active while it owns something, and stops once that’s gone', async () => {
    const a = ws('A', [{ type: 't-window', params: { name: 'term' } }]);
    await runWorkspace(a);
    expect(await getActiveWorkspaceIds([a])).toEqual(new Set(['A']));
    world.set('term', []);
    vi.mocked(activityStore.setIntentActive)('A', false);
    expect(await getActiveWorkspaceIds([a])).toEqual(new Set());
    expect(store.get().resources).toEqual([]);
  });

  it('deleting a workspace drops its claims without closing anything', async () => {
    const a = ws('A', [{ type: 't-window', params: { name: 'term' } }]);
    await runWorkspace(a);
    releaseDeletedWorkspace('A');
    expect(resourcesOwnedBy(store.get(), 'A')).toEqual([]);
    expect(closes).toEqual([]);
  });

  it('save-current records running apps as the workspace’s, but not ours', async () => {
    world.set('Spotify', [5]);
    const a = ws('A', [{ type: 't-app', params: { name: 'Spotify' } }]);
    await markWorkspaceDetectedActive(a);
    expect(store.get().resources[0]).toMatchObject({ createdByApp: false, label: 'Spotify' });
    await expect(closeWorkspace(a, [a])).resolves.toMatchObject({
      leftOpen: [{ appName: 'Spotify', reason: 'not-ours' }],
    });
  });
});

describe('removing a step from the Detail view', () => {
  it('asks before removing a step whose app only it opened and is running', async () => {
    const a = ws('A', [{ id: 'p', type: 't-app', params: { name: 'ProtonVPN' } }]);
    await runWorkspace(a);
    await expect(previewWorkspaceStepRemoval(a, 'p', [a])).resolves.toEqual(['ProtonVPN']);
  });

  it('removes without asking when the app is shared, was already open, isn’t running, or another step uses it', async () => {
    // Shared with another workspace.
    const a = ws('A', [{ id: 'p', type: 't-app', params: { name: 'Shared' } }]);
    const b = ws('B', [{ id: 'q', type: 't-app', params: { name: 'Shared' } }]);
    await runWorkspace(a);
    await runWorkspace(b);
    await expect(previewWorkspaceStepRemoval(a, 'p', [a, b])).resolves.toEqual([]);

    // Already open before this workspace touched it.
    world.set('Mine', [50]);
    const c = ws('C', [{ id: 'm', type: 't-app', params: { name: 'Mine' } }]);
    await runWorkspace(c);
    await expect(previewWorkspaceStepRemoval(c, 'm', [c])).resolves.toEqual([]);

    // Opened by this app but since quit.
    const d = ws('D', [{ id: 'g', type: 't-app', params: { name: 'Gone' } }]);
    await runWorkspace(d);
    world.set('Gone', []);
    await expect(previewWorkspaceStepRemoval(d, 'g', [d])).resolves.toEqual([]);

    // Two steps of the same workspace open the same app.
    const e = ws('E', [
      { id: 'one', type: 't-app', params: { name: 'Twice' } },
      { id: 'two', type: 't-app', params: { name: 'Twice' } },
    ]);
    await runWorkspace(e);
    await expect(previewWorkspaceStepRemoval(e, 'one', [e])).resolves.toEqual([]);
  });

  it('closes the removed step’s app once confirmed', async () => {
    const before = ws('A', [
      { id: 'keep', type: 't-app', params: { name: 'Figma' } },
      { id: 'p', type: 't-app', params: { name: 'ProtonVPN' } },
    ]);
    await runWorkspace(before);
    const after = ws('A', [{ id: 'keep', type: 't-app', params: { name: 'Figma' } }]);
    await expect(closeRemovedSteps(after, [after], true)).resolves.toEqual({
      closed: ['ProtonVPN'],
      leftOpen: [],
    });
    expect(store.get().resources.map((r) => r.label)).toEqual(['Figma']);
  });

  it('without confirmation only releases the claim — never closes', async () => {
    const before = ws('A', [{ id: 'p', type: 't-app', params: { name: 'ProtonVPN' } }]);
    await runWorkspace(before);
    const after = ws('A', []);
    await expect(closeRemovedSteps(after, [after], false)).resolves.toEqual({
      closed: [],
      leftOpen: [],
    });
    expect(closes).toEqual([]);
    expect(resourcesOwnedBy(store.get(), 'A')).toEqual([]);
  });

  it('keeps a shared app open when the removed step’s claim is released', async () => {
    const a = ws('A', [{ id: 'p', type: 't-app', params: { name: 'ProtonVPN' } }]);
    const b = ws('B', [{ id: 'q', type: 't-app', params: { name: 'ProtonVPN' } }]);
    await runWorkspace(a);
    await runWorkspace(b);
    const after = ws('A', []);
    await closeRemovedSteps(after, [after, b], false);
    expect(closes).toEqual([]);
    expect(resourcesOwnedBy(store.get(), 'B')).toHaveLength(1);
  });
});

describe('tracking off', () => {
  it('runs every step the app-level way when there is no ledger', async () => {
    setLedgerStore(null);
    const a = ws('A', [{ type: 't-window', params: { name: 'term' } }]);
    await runWorkspace(a);
    await runWorkspace(a);
    expect(runs).toEqual(['term', 'term']);
    expect(store.get().resources).toEqual([]);
  });
});

describe('startup reconcile of unfinished opens', () => {
  function withOpening(name: string): void {
    store.update(
      (l) =>
        addResource(l, {
          kind: 'fake-window',
          identityKey: JSON.stringify({ name }),
          label: name,
          owner: { workspaceId: 'A', stepId: 's' },
          createdByApp: true,
          handle: null,
          state: 'opening',
        }).ledger,
    );
  }

  it('adopts an open that did finish, and drops one that didn’t', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    world.set('finished', [7]);
    withOpening('finished');
    withOpening('never');
    await reconcileOpeningRecords(store);
    expect(store.get().resources).toEqual([
      expect.objectContaining({
        label: 'finished',
        state: 'open',
        handle: { name: 'finished', instance: 7 },
      }),
    ]);
    errorSpy.mockRestore();
  });

  it('starts from an empty ledger in a fresh boot session', () => {
    expect(emptyLedger('x').resources).toEqual([]);
  });
});
