import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * The resource ledger (WCs/WC__window-tracking.md, Stage 2 plan
 * section 3): every window, app and process a workspace step opened
 * or reused, who currently claims it, and how to find it again. The
 * single source of truth for "is this workspace active" once the
 * operations are built on it — an inactive workspace owns nothing.
 *
 * Pure functions over an immutable Ledger value; persistence lives in
 * ledger-store.ts. Nothing here knows how a given kind of resource is
 * opened, found or closed — `handle` is opaque, validated and used by
 * that kind's own plugin.
 */

/** Bump on any incompatible change, and add a step to migrateLedger. */
export const LEDGER_SCHEMA_VERSION = 1;

const OwnerSchema = z.object({
  workspaceId: z.string().min(1),
  /** WorkspaceStep.id — which of the workspace's steps claims it. */
  stepId: z.string().min(1),
});

export type ResourceOwner = z.infer<typeof OwnerSchema>;

const ResourceSchema = z.object({
  id: z.string().min(1),
  /** Which plugin owns its mechanics ('app', 'compose', 'vscode-window', …). */
  kind: z.string().min(1),
  /**
   * What makes two resources "the same" within a kind — a
   * JSON-serialized identity built by the kind's plugin (bundle id,
   * normalized path, command, occurrence index…). Opening a step whose
   * key matches a live resource reuses it instead of opening another.
   */
  identityKey: z.string().min(1),
  /**
   * Shown in Close/Switch results. For an app it's the same name
   * tool-identity.ts's getMacAppName gives, which is how the ledger and
   * the untracked, app-name-based path tell they mean the same app.
   */
  label: z.string(),
  owners: z.array(OwnerSchema),
  /**
   * True only when this app opened it. Decision 1: something the user
   * opened by hand is reused and focused, never closed.
   */
  createdByApp: z.boolean(),
  /** Kind-specific way to find this exact instance again; null once dropped. */
  handle: z.record(z.string(), z.unknown()).nullable(),
  /**
   * 'opening' is the write-ahead record made before the open call, so
   * a crash, helper restart or timed-out-then-finished open can never
   * leave an untracked window behind; reconciled at startup.
   */
  state: z.enum(['opening', 'open']),
  createdAt: z.number(),
});

export type Resource = z.infer<typeof ResourceSchema>;

const LedgerSchema = z.object({
  schemaVersion: z.literal(LEDGER_SCHEMA_VERSION),
  /**
   * kern.bootsessionuuid when the handles were recorded. Window ids
   * and pids are reset and reused across a reboot or logout, so a
   * handle from another boot session could point at a stranger's
   * window — see applyBootSession.
   */
  bootSessionUuid: z.string().nullable(),
  resources: z.array(ResourceSchema),
});

export type Ledger = z.infer<typeof LedgerSchema>;

export function emptyLedger(bootSessionUuid: string | null): Ledger {
  return { schemaVersion: LEDGER_SCHEMA_VERSION, bootSessionUuid, resources: [] };
}

export type LedgerLoadResult = { ok: true; ledger: Ledger } | { ok: false; error: string };

/**
 * Reads a persisted ledger, upgrading older schema versions step by
 * step. Never "fixes" what it doesn't understand by starting over: a
 * wipe would orphan every window this app opened, which it could then
 * never close. A newer or corrupt ledger is an error the caller must
 * surface, not a reason to discard it.
 */
export function migrateLedger(raw: unknown): LedgerLoadResult {
  const version =
    typeof raw === 'object' && raw !== null
      ? (raw as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (typeof version === 'number' && version > LEDGER_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `The resource ledger was written by a newer version of Workspace Launcher (schema ${version}, this build understands ${LEDGER_SCHEMA_VERSION}).`,
    };
  }
  const parsed = LedgerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `The resource ledger is unreadable: ${parsed.error.message}` };
  }
  return { ok: true, ledger: parsed.data };
}

/**
 * Drops every handle recorded in a different boot session (or with
 * none recorded), keeping the resources and their owners so each
 * kind's revalidation can decide what's still there. An unknown
 * current boot session drops them too — trusting a possibly reused
 * pid is the one thing this guard exists to prevent.
 */
export function applyBootSession(ledger: Ledger, current: string | null): Ledger {
  if (current !== null && ledger.bootSessionUuid === current) return ledger;
  return {
    ...ledger,
    bootSessionUuid: current,
    resources: ledger.resources.map((r) => ({ ...r, handle: null })),
  };
}

export interface NewResource {
  kind: string;
  identityKey: string;
  label: string;
  owner: ResourceOwner;
  createdByApp: boolean;
  handle: Record<string, unknown> | null;
  state: Resource['state'];
}

export function addResource(
  ledger: Ledger,
  input: NewResource,
  now: number = Date.now(),
): { ledger: Ledger; resource: Resource } {
  const resource: Resource = {
    id: randomUUID(),
    kind: input.kind,
    identityKey: input.identityKey,
    label: input.label,
    owners: [input.owner],
    createdByApp: input.createdByApp,
    handle: input.handle,
    state: input.state,
    createdAt: now,
  };
  return { ledger: { ...ledger, resources: [...ledger.resources, resource] }, resource };
}

export function findResource(ledger: Ledger, resourceId: string): Resource | undefined {
  return ledger.resources.find((r) => r.id === resourceId);
}

/** Every resource of this kind with this identity (normally zero or one). */
export function findByIdentity(ledger: Ledger, kind: string, identityKey: string): Resource[] {
  return ledger.resources.filter((r) => r.kind === kind && r.identityKey === identityKey);
}

/** Resources claimed by a workspace, or by one of its steps. */
export function resourcesOwnedBy(ledger: Ledger, workspaceId: string, stepId?: string): Resource[] {
  return ledger.resources.filter((r) =>
    r.owners.some(
      (o) => o.workspaceId === workspaceId && (stepId === undefined || o.stepId === stepId),
    ),
  );
}

/** A workspace is active exactly when it owns something. */
export function isWorkspaceActive(ledger: Ledger, workspaceId: string): boolean {
  return ledger.resources.some((r) => r.owners.some((o) => o.workspaceId === workspaceId));
}

export function updateResource(
  ledger: Ledger,
  resourceId: string,
  patch: Partial<Pick<Resource, 'handle' | 'state' | 'createdByApp'>>,
): Ledger {
  return mapResource(ledger, resourceId, (r) => ({ ...r, ...patch }));
}

/** Adds a claim; a claim that's already there isn't duplicated. */
export function addOwner(ledger: Ledger, resourceId: string, owner: ResourceOwner): Ledger {
  return mapResource(ledger, resourceId, (r) =>
    r.owners.some((o) => sameOwner(o, owner)) ? r : { ...r, owners: [...r.owners, owner] },
  );
}

export function removeOwner(ledger: Ledger, resourceId: string, owner: ResourceOwner): Ledger {
  return mapResource(ledger, resourceId, (r) => ({
    ...r,
    owners: r.owners.filter((o) => !sameOwner(o, owner)),
  }));
}

/**
 * Removes a workspace's claims everywhere — or only those whose step
 * is in `stepIds`. Resources left with no owners stay in the ledger:
 * closing them (if they're ours) is the operation's job, which also
 * removes them once they're really gone.
 */
export function releaseWorkspace(
  ledger: Ledger,
  workspaceId: string,
  stepIds?: ReadonlySet<string>,
): Ledger {
  const released = (o: ResourceOwner): boolean =>
    o.workspaceId === workspaceId && (stepIds === undefined || stepIds.has(o.stepId));
  return {
    ...ledger,
    resources: ledger.resources.map((r) =>
      r.owners.some(released) ? { ...r, owners: r.owners.filter((o) => !released(o)) } : r,
    ),
  };
}

/**
 * Drops claims by workspaces that no longer exist (deleted, or a
 * config that failed to load), keeping the "an inactive workspace owns
 * nothing" invariant true however a workspace disappeared.
 */
export function releaseUnknownWorkspaces(
  ledger: Ledger,
  knownWorkspaceIds: ReadonlySet<string>,
): Ledger {
  return {
    ...ledger,
    resources: ledger.resources.map((r) =>
      r.owners.every((o) => knownWorkspaceIds.has(o.workspaceId))
        ? r
        : { ...r, owners: r.owners.filter((o) => knownWorkspaceIds.has(o.workspaceId)) },
    ),
  };
}

export function removeResource(ledger: Ledger, resourceId: string): Ledger {
  return { ...ledger, resources: ledger.resources.filter((r) => r.id !== resourceId) };
}

function mapResource(ledger: Ledger, resourceId: string, fn: (r: Resource) => Resource): Ledger {
  if (!ledger.resources.some((r) => r.id === resourceId)) {
    throw new Error(`No resource ${resourceId} in the ledger.`);
  }
  return {
    ...ledger,
    resources: ledger.resources.map((r) => (r.id === resourceId ? fn(r) : r)),
  };
}

function sameOwner(a: ResourceOwner, b: ResourceOwner): boolean {
  return a.workspaceId === b.workspaceId && a.stepId === b.stepId;
}
