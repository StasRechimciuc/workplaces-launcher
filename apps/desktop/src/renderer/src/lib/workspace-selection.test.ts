import { describe, expect, it } from 'vitest';
import { resolveActiveWorkspaceId } from './workspace-selection';

describe('resolveActiveWorkspaceId', () => {
  it('keeps the target id when it still exists in the loaded list', () => {
    const loaded = [{ id: 'a' }, { id: 'b' }];
    expect(resolveActiveWorkspaceId(loaded, 'b')).toBe('b');
  });

  it('falls back to the first workspace when the target no longer exists', () => {
    // The concrete bug this fixes: deleting the currently-active
    // workspace previously left activeId pointing at a dead id.
    const loaded = [{ id: 'a' }, { id: 'b' }];
    expect(resolveActiveWorkspaceId(loaded, 'deleted-id')).toBe('a');
  });

  it('falls back to "" when the target is missing and the list is empty', () => {
    expect(resolveActiveWorkspaceId([], 'anything')).toBe('');
  });

  it('falls back to "" when the target is already ""', () => {
    expect(resolveActiveWorkspaceId([], '')).toBe('');
  });
});
