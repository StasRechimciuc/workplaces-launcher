import { describe, expect, it, vi } from 'vitest';
import { addResource, emptyLedger, type Ledger } from './ledger';
import { ResourceLedgerStore, type LedgerBackend } from './ledger-store';

// The class under test takes its backend as a parameter; electron-store
// itself (createResourceLedgerStore) needs a real Electron app.
vi.mock('electron-store', () => ({ default: class {} }));

function memoryBackend(initial?: unknown): LedgerBackend & { writes: Ledger[] } {
  let stored = initial;
  const writes: Ledger[] = [];
  return {
    writes,
    read: () => stored,
    write: (ledger) => {
      writes.push(ledger);
      stored = JSON.parse(JSON.stringify(ledger));
    },
  };
}

function ledgerWithOneResource(boot: string): Ledger {
  return addResource(emptyLedger(boot), {
    kind: 'app',
    identityKey: 'k',
    owner: { workspaceId: 'ws', stepId: 's' },
    createdByApp: true,
    handle: { pid: 1 },
    state: 'open',
  }).ledger;
}

describe('ResourceLedgerStore', () => {
  it('creates and persists an empty ledger on first run', () => {
    const backend = memoryBackend();
    const store = new ResourceLedgerStore(backend);
    expect(store.load('boot-1')).toEqual({ ok: true });
    expect(store.get()).toEqual(emptyLedger('boot-1'));
    expect(backend.writes).toHaveLength(1);
  });

  it('loads an existing ledger without rewriting it in the same boot session', () => {
    const backend = memoryBackend(ledgerWithOneResource('boot-1'));
    const store = new ResourceLedgerStore(backend);
    store.load('boot-1');
    expect(store.get().resources[0]?.handle).toEqual({ pid: 1 });
    expect(backend.writes).toHaveLength(0);
  });

  it('drops and persists handles after a reboot', () => {
    const backend = memoryBackend(ledgerWithOneResource('boot-1'));
    const store = new ResourceLedgerStore(backend);
    store.load('boot-2');
    expect(store.get().resources[0]?.handle).toBeNull();
    expect(backend.writes.at(-1)?.bootSessionUuid).toBe('boot-2');
  });

  it('writes every update through', () => {
    const backend = memoryBackend();
    const store = new ResourceLedgerStore(backend);
    store.load('boot-1');
    const next = store.update((l) => ledgerWithOneResource(l.bootSessionUuid ?? ''));
    expect(backend.writes.at(-1)).toEqual(next);
    expect(store.get()).toBe(next);
  });

  it('keeps the previous ledger when a write fails', () => {
    const backend = memoryBackend();
    const store = new ResourceLedgerStore(backend);
    store.load('boot-1');
    const before = store.get();
    backend.write = () => {
      throw new Error('disk full');
    };
    expect(() => store.update((l) => ledgerWithOneResource(l.bootSessionUuid ?? ''))).toThrow(
      'disk full',
    );
    expect(store.get()).toBe(before);
  });

  it('fails closed on a ledger it can’t read, never overwriting it', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const newer = { schemaVersion: 99, bootSessionUuid: null, resources: [] };
    const backend = memoryBackend(newer);
    const store = new ResourceLedgerStore(backend);
    const result = store.load('boot-1');
    expect(result.ok).toBe(false);
    expect(() => store.get()).toThrow('newer version');
    expect(() => store.update((l) => l)).toThrow('newer version');
    expect(backend.writes).toHaveLength(0);
    expect(backend.read()).toEqual(newer);
    errorSpy.mockRestore();
  });

  it('refuses use before load', () => {
    expect(() => new ResourceLedgerStore(memoryBackend()).get()).toThrow('not been loaded');
  });
});
