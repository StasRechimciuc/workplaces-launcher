import type { ResourceSpec } from '@workspace-launcher/shared';
import type { ResourceKindPlugin } from './types';

/**
 * Resource kinds by name — the same registry shape as
 * tools/registry.ts (docs/architecture.md #2), so adding a kind means
 * adding a module, not a branch in the orchestrator.
 */
const kinds = new Map<string, ResourceKindPlugin>();

export function registerResourceKind(plugin: ResourceKindPlugin): void {
  if (kinds.has(plugin.kind)) {
    throw new Error(`Resource kind "${plugin.kind}" is already registered.`);
  }
  kinds.set(plugin.kind, plugin);
}

export function getResourceKind(kind: string): ResourceKindPlugin | undefined {
  return kinds.get(kind);
}

/**
 * The ledger's identity key for a spec: kind-scoped, with identity
 * fields in sorted order so `{a, b}` and `{b, a}` are the same key.
 */
export function identityKeyFor(spec: Pick<ResourceSpec, 'identity'>): string {
  const sorted = Object.fromEntries(
    Object.entries(spec.identity).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return JSON.stringify(sorted);
}
