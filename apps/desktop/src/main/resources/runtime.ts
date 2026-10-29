import type { WorkspaceConfig } from '@workspace-launcher/shared';
import { getWlHelper } from '../platform/macos/wl-helper';
import { readBootSessionUuid } from './boot-session';
import { getResourceKind, registerResourceKind } from './kind-registry';
import { createAppKind } from './kinds/app-kind';
import { releaseUnknownWorkspaces, removeResource, updateResource } from './ledger';
import { createResourceLedgerStore, type ResourceLedgerStore } from './ledger-store';
import { createComposeKind } from './kinds/compose-kind';
import {
  bundlePathOfAppRoot,
  createVscodeWindowKind,
  defaultCommandDeps,
  type VscodeWindowDeps,
} from './kinds/vscode-window-kind';
import { readBundleId } from '../platform/macos/bundle-id';

/**
 * The live resource ledger, or null when tracking is off: not macOS,
 * not started yet, or the stored ledger couldn't be loaded. With null,
 * every step runs untracked — today's app-level behavior — so a
 * tracking problem degrades the app instead of breaking restores.
 */
let ledgerStore: ResourceLedgerStore | null = null;

export function getLedgerStore(): ResourceLedgerStore | null {
  return ledgerStore;
}

/** Installs (or, with null, turns off) the ledger — startup below, and tests. */
export function setLedgerStore(store: ResourceLedgerStore | null): void {
  ledgerStore = store;
}

/**
 * Startup (main/index.ts, before IPC handlers can run anything):
 * loads the ledger with the boot-session guard, registers the
 * resource kinds, settles 'opening' records a crash left behind, and
 * drops claims by workspaces that no longer exist. Never throws: any
 * failure leaves tracking off, loudly.
 */
export async function initResourceTracking(configs: readonly WorkspaceConfig[]): Promise<void> {
  if (process.platform !== 'darwin') return;
  try {
    registerResourceKind(createAppKind(getWlHelper()));
    registerResourceKind(createComposeKind());
    registerResourceKind(createVscodeWindowKind(vscodeWindowDeps()));
    const store = createResourceLedgerStore();
    const loaded = store.load(await readBootSessionUuid());
    if (!loaded.ok) {
      console.error(`Resource tracking is off: ${loaded.error}`);
      return;
    }
    await reconcileOpeningRecords(store);
    store.update((ledger) => releaseUnknownWorkspaces(ledger, new Set(configs.map((c) => c.id))));
    ledgerStore = store;
  } catch (err) {
    console.error(`Resource tracking is off: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * An 'opening' record means the app stopped between writing it and
 * capturing what opened. The kind decides whether a running instance
 * is provably that open (it started after the record); otherwise the
 * record is dropped — never guessed into being ours.
 */
export async function reconcileOpeningRecords(store: ResourceLedgerStore): Promise<void> {
  for (const resource of store.get().resources.filter((r) => r.state === 'opening')) {
    const kind = getResourceKind(resource.kind);
    const identity = JSON.parse(resource.identityKey) as Record<string, string | number | boolean>;
    const result = kind?.reconcileOpening
      ? await kind.reconcileOpening(identity, resource.createdAt)
      : ({ found: false, reason: `No reconcile support for kind "${resource.kind}".` } as const);
    if (result.found) {
      store.update((l) =>
        updateResource(l, resource.id, {
          state: 'open',
          handle: result.handle,
          createdByApp: true,
        }),
      );
    } else {
      console.error(`Dropping an unfinished open of ${resource.label}: ${result.reason}`);
      store.update((l) => removeResource(l, resource.id));
    }
  }
}

/**
 * The VS Code window kind's real dependencies: the shared heartbeat and
 * command files, plus bundle ids (cached — an appRoot's bundle never
 * changes while it's installed) and the helper's is-running check.
 */
function vscodeWindowDeps(): VscodeWindowDeps {
  const bundleIds = new Map<string, Promise<string | null>>();
  return {
    ...defaultCommandDeps,
    bundleIdOfAppRoot: (appRoot) => {
      const bundlePath = bundlePathOfAppRoot(appRoot);
      if (!bundlePath) return Promise.resolve(null);
      let cached = bundleIds.get(bundlePath);
      if (!cached) {
        cached = readBundleId(bundlePath);
        bundleIds.set(bundlePath, cached);
      }
      return cached;
    },
    isAppRunning: async (bundleId) => {
      const response = await getWlHelper().request('isRunning', { bundleId });
      return response.ok ? response.result.running : null;
    },
  };
}
