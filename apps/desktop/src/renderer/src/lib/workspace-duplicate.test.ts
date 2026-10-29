import { describe, expect, it } from 'vitest';
import type { WorkspaceDisplay, WorkspaceToolStepDisplay } from '../../../preload';
import { findDuplicateWorkspace, withStepIdsOf } from './workspace-duplicate';

function makeTool(type: string, params: Record<string, unknown>): WorkspaceToolStepDisplay {
  return {
    id: `${type}-step`,
    icon: 'box',
    color: 'blue',
    name: type,
    launchTime: { display: '', state: 'unmeasured' },
    detail: '',
    type,
    params,
  };
}

function makeWorkspace(
  name: string,
  tools: WorkspaceToolStepDisplay[],
  id = name,
): WorkspaceDisplay {
  return {
    id,
    name,
    tag: '',
    subtitle: '',
    description: '',
    launchTime: { display: '', state: 'no-steps' },
    tools,
  };
}

describe('findDuplicateWorkspace', () => {
  it('finds a workspace with the exact same name and steps', () => {
    const existing = [makeWorkspace('Client A', [makeTool('vscode', { path: '~/a' })])];
    const match = findDuplicateWorkspace(
      { name: 'Client A', steps: [{ type: 'vscode', params: { path: '~/a' } }] },
      existing,
    );
    expect(match?.id).toBe('Client A');
  });

  it('is case-insensitive and trims whitespace on the name', () => {
    const existing = [makeWorkspace('Client A', [makeTool('vscode', { path: '~/a' })])];
    const match = findDuplicateWorkspace(
      { name: '  client a  ', steps: [{ type: 'vscode', params: { path: '~/a' } }] },
      existing,
    );
    expect(match?.id).toBe('Client A');
  });

  it('ignores param key order — the same params rebuilt from scratch must still match', () => {
    const existing = [
      makeWorkspace('Client A', [makeTool('chrome', { profile: 'Default', profileName: 'Work' })]),
    ];
    const match = findDuplicateWorkspace(
      {
        name: 'Client A',
        steps: [{ type: 'chrome', params: { profileName: 'Work', profile: 'Default' } }],
      },
      existing,
    );
    expect(match?.id).toBe('Client A');
  });

  it('does not match on name alone when the steps differ', () => {
    const existing = [makeWorkspace('Client A', [makeTool('vscode', { path: '~/a' })])];
    const match = findDuplicateWorkspace(
      { name: 'Client A', steps: [{ type: 'vscode', params: { path: '~/different' } }] },
      existing,
    );
    expect(match).toBeUndefined();
  });

  it('does not match on steps alone when the name differs', () => {
    const existing = [makeWorkspace('Client A', [makeTool('vscode', { path: '~/a' })])];
    const match = findDuplicateWorkspace(
      { name: 'Client B', steps: [{ type: 'vscode', params: { path: '~/a' } }] },
      existing,
    );
    expect(match).toBeUndefined();
  });

  it('treats step order as meaningful — same steps, different order, is not a duplicate', () => {
    const existing = [
      makeWorkspace('Client A', [makeTool('vscode', { path: '~/a' }), makeTool('spotify', {})]),
    ];
    const match = findDuplicateWorkspace(
      {
        name: 'Client A',
        steps: [
          { type: 'spotify', params: {} },
          { type: 'vscode', params: { path: '~/a' } },
        ],
      },
      existing,
    );
    expect(match).toBeUndefined();
  });

  it('excludes the given id — editing a workspace in place is never a duplicate of itself', () => {
    const existing = [makeWorkspace('Client A', [makeTool('vscode', { path: '~/a' })], 'ws-1')];
    const match = findDuplicateWorkspace(
      { name: 'Client A', steps: [{ type: 'vscode', params: { path: '~/a' } }] },
      existing,
      'ws-1',
    );
    expect(match).toBeUndefined();
  });

  it('returns undefined for an empty name', () => {
    const existing = [makeWorkspace('', [])];
    expect(findDuplicateWorkspace({ name: '   ', steps: [] }, existing)).toBeUndefined();
  });

  it('returns undefined when nothing matches', () => {
    expect(findDuplicateWorkspace({ name: 'New', steps: [] }, [])).toBeUndefined();
  });
});

describe('withStepIdsOf', () => {
  it('gives each step the id of the duplicate’s step at the same position', () => {
    const steps = [
      { type: 'a', params: {} },
      { type: 'b', params: {} },
    ];
    expect(withStepIdsOf(steps, [{ id: 'x' }, { id: 'y' }]).map((s) => s.id)).toEqual(['x', 'y']);
  });

  it('leaves a step without a counterpart id-less, for the main process to assign', () => {
    const [step] = withStepIdsOf([{ type: 'a', params: {} }], []);
    expect(step).toEqual({ type: 'a', params: {} });
    expect(step && 'id' in step).toBe(false);
  });
});
