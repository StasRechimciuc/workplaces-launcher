import { describe, expect, it } from 'vitest';
import {
  addOwner,
  addResource,
  applyBootSession,
  emptyLedger,
  findByIdentity,
  isWorkspaceActive,
  migrateLedger,
  releaseUnknownWorkspaces,
  releaseWorkspace,
  removeOwner,
  removeResource,
  resourcesOwnedBy,
  updateResource,
  type Ledger,
  type NewResource,
} from './ledger';

const A1 = { workspaceId: 'ws-a', stepId: 'step-1' };
const A2 = { workspaceId: 'ws-a', stepId: 'step-2' };
const B1 = { workspaceId: 'ws-b', stepId: 'step-1' };

function newResource(overrides: Partial<NewResource> = {}): NewResource {
  return {
    kind: 'app',
    identityKey: '{"bundleId":"com.spotify.client"}',
    label: 'Spotify',
    owner: A1,
    createdByApp: true,
    handle: { pid: 123 },
    state: 'open',
    ...overrides,
  };
}

function withResource(overrides: Partial<NewResource> = {}): { ledger: Ledger; id: string } {
  const { ledger, resource } = addResource(emptyLedger('boot-1'), newResource(overrides), 1000);
  return { ledger, id: resource.id };
}

describe('migrateLedger', () => {
  it('accepts a current ledger as-is', () => {
    const { ledger } = withResource();
    expect(migrateLedger(JSON.parse(JSON.stringify(ledger)))).toEqual({ ok: true, ledger });
  });

  it('refuses a ledger from a newer version instead of discarding it', () => {
    const result = migrateLedger({ schemaVersion: 99, bootSessionUuid: null, resources: [] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('newer version');
  });

  it('refuses a corrupt ledger instead of discarding it', () => {
    for (const raw of [null, 'x', { schemaVersion: 1, resources: 'nope' }]) {
      const result = migrateLedger(raw);
      expect(result.ok).toBe(false);
    }
  });
});

describe('applyBootSession', () => {
  it('keeps handles from the same boot session', () => {
    const { ledger } = withResource();
    expect(applyBootSession(ledger, 'boot-1')).toBe(ledger);
  });

  it('drops every handle after a reboot but keeps resources and owners', () => {
    const { ledger, id } = withResource();
    const after = applyBootSession(ledger, 'boot-2');
    expect(after.bootSessionUuid).toBe('boot-2');
    expect(after.resources).toEqual([{ ...ledger.resources[0], id, handle: null }]);
  });

  it('drops handles when the current session is unknown', () => {
    const { ledger } = withResource();
    expect(applyBootSession(ledger, null).resources[0]?.handle).toBeNull();
  });
});

describe('ownership', () => {
  it('a workspace is active exactly while it owns something', () => {
    const { ledger, id } = withResource();
    expect(isWorkspaceActive(ledger, 'ws-a')).toBe(true);
    expect(isWorkspaceActive(ledger, 'ws-b')).toBe(false);
    expect(isWorkspaceActive(removeOwner(ledger, id, A1), 'ws-a')).toBe(false);
  });

  it('shares one resource between workspaces without duplicating a claim', () => {
    const { ledger, id } = withResource();
    const shared = addOwner(addOwner(ledger, id, B1), id, B1);
    expect(shared.resources[0]?.owners).toEqual([A1, B1]);
    expect(resourcesOwnedBy(shared, 'ws-b').map((r) => r.id)).toEqual([id]);
  });

  it('finds resources by step', () => {
    const first = withResource();
    const { ledger, resource } = addResource(
      first.ledger,
      newResource({ owner: A2, identityKey: 'other' }),
    );
    expect(resourcesOwnedBy(ledger, 'ws-a', 'step-2').map((r) => r.id)).toEqual([resource.id]);
    expect(resourcesOwnedBy(ledger, 'ws-a')).toHaveLength(2);
  });

  it('releases a workspace everywhere, or only some of its steps, leaving other owners', () => {
    const { ledger, id } = withResource();
    const shared = addOwner(addOwner(ledger, id, A2), id, B1);
    expect(releaseWorkspace(shared, 'ws-a').resources[0]?.owners).toEqual([B1]);
    expect(releaseWorkspace(shared, 'ws-a', new Set(['step-2'])).resources[0]?.owners).toEqual([
      A1,
      B1,
    ]);
  });

  it('keeps an ownerless resource in the ledger until it is removed explicitly', () => {
    const { ledger, id } = withResource();
    const released = releaseWorkspace(ledger, 'ws-a');
    expect(released.resources).toHaveLength(1);
    expect(removeResource(released, id).resources).toEqual([]);
  });

  it('drops claims by workspaces that no longer exist', () => {
    const { ledger, id } = withResource();
    const shared = addOwner(ledger, id, B1);
    expect(releaseUnknownWorkspaces(shared, new Set(['ws-b'])).resources[0]?.owners).toEqual([B1]);
  });
});

describe('lookup and updates', () => {
  it('finds by kind and identity key', () => {
    const { ledger, id } = withResource();
    expect(findByIdentity(ledger, 'app', newResource().identityKey).map((r) => r.id)).toEqual([id]);
    expect(findByIdentity(ledger, 'compose', newResource().identityKey)).toEqual([]);
  });

  it('records a write-ahead opening, then its handle once open', () => {
    const { ledger, id } = withResource({ state: 'opening', handle: null });
    const opened = updateResource(ledger, id, { state: 'open', handle: { pid: 9 } });
    expect(opened.resources[0]).toMatchObject({ state: 'open', handle: { pid: 9 } });
  });

  it('fails loudly on an unknown resource id', () => {
    expect(() => updateResource(emptyLedger(null), 'missing', { state: 'open' })).toThrow(
      'No resource missing',
    );
  });
});
