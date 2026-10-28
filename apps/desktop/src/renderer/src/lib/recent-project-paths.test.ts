import { describe, expect, it } from 'vitest';
import type { WorkspaceDisplay, WorkspaceToolStepDisplay } from '../../../preload';
import { getRecentProjectPaths } from './recent-project-paths';

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

function makeWorkspace(tools: WorkspaceToolStepDisplay[], id = 'ws'): WorkspaceDisplay {
  return {
    id,
    name: id,
    tag: '',
    subtitle: '',
    description: '',
    launchTime: { display: '', state: 'no-steps' },
    tools,
  };
}

describe('getRecentProjectPaths', () => {
  it('dedupes identical paths across multiple workspaces/steps', () => {
    const workspaces = [
      makeWorkspace([makeTool('vscode', { path: '~/projects/a' })], 'ws-1'),
      makeWorkspace([makeTool('vscode', { path: '~/projects/a' })], 'ws-2'),
      makeWorkspace([makeTool('vscode', { path: '~/projects/b' })], 'ws-3'),
    ];
    expect(getRecentProjectPaths(workspaces)).toEqual(['~/projects/a', '~/projects/b']);
  });

  it('ignores non-vscode steps and steps with a missing or blank path', () => {
    const workspaces = [
      makeWorkspace([
        makeTool('chrome', { profile: 'Default' }),
        makeTool('vscode', {}),
        makeTool('vscode', { path: '   ' }),
        makeTool('vscode', { path: '~/projects/a' }),
      ]),
    ];
    expect(getRecentProjectPaths(workspaces)).toEqual(['~/projects/a']);
  });

  it('caps results at the default limit of 5', () => {
    const tools = Array.from({ length: 8 }, (_, i) => makeTool('vscode', { path: `~/p${i}` }));
    const workspaces = [makeWorkspace(tools)];
    expect(getRecentProjectPaths(workspaces)).toEqual(['~/p0', '~/p1', '~/p2', '~/p3', '~/p4']);
  });

  it('respects a custom limit', () => {
    const tools = Array.from({ length: 8 }, (_, i) => makeTool('vscode', { path: `~/p${i}` }));
    const workspaces = [makeWorkspace(tools)];
    expect(getRecentProjectPaths(workspaces, undefined, 2)).toEqual(['~/p0', '~/p1']);
  });

  it('excludes the given path when provided', () => {
    const workspaces = [
      makeWorkspace([
        makeTool('vscode', { path: '~/projects/a' }),
        makeTool('vscode', { path: '~/projects/b' }),
      ]),
    ];
    expect(getRecentProjectPaths(workspaces, '~/projects/a')).toEqual(['~/projects/b']);
  });

  it('returns [] for an empty workspaces array', () => {
    expect(getRecentProjectPaths([])).toEqual([]);
  });
});
