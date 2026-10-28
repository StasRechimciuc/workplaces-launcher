import { describe, expect, it } from 'vitest';
import type { WorkspaceDisplay, WorkspaceToolStepDisplay } from '../../../preload';
import { getRecentCommands } from './recent-commands';

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

function terminalTool(entries: { cwd: string; commands: unknown }[]): WorkspaceToolStepDisplay {
  return makeTool('terminal', { terminals: entries });
}

describe('getRecentCommands', () => {
  it('dedupes identical commands across multiple workspaces/terminals', () => {
    const workspaces = [
      makeWorkspace([terminalTool([{ cwd: '~/a', commands: ['npm run dev'] }])], 'ws-1'),
      makeWorkspace([terminalTool([{ cwd: '~/b', commands: ['npm run dev'] }])], 'ws-2'),
      makeWorkspace([terminalTool([{ cwd: '~/c', commands: ['npm test'] }])], 'ws-3'),
    ];
    expect(getRecentCommands(workspaces)).toEqual(['npm run dev', 'npm test']);
  });

  it('flattens across multiple terminal entries in one step', () => {
    const workspaces = [
      makeWorkspace([
        terminalTool([
          { cwd: '~/a', commands: ['npm i'] },
          { cwd: '~/b', commands: ['npm run dev'] },
        ]),
      ]),
    ];
    expect(getRecentCommands(workspaces)).toEqual(['npm i', 'npm run dev']);
  });

  it('ignores non-terminal steps and malformed/blank command entries', () => {
    const workspaces = [
      makeWorkspace([
        makeTool('chrome', { profile: 'Default' }),
        makeTool('terminal', {}),
        makeTool('terminal', { terminals: 'not-an-array' }),
        terminalTool([{ cwd: '~/a', commands: ['   ', 123, null] }]),
        terminalTool([{ cwd: '~/a', commands: ['npm run dev'] }]),
      ]),
    ];
    expect(getRecentCommands(workspaces)).toEqual(['npm run dev']);
  });

  it('caps results at the default limit of 8', () => {
    const commands = Array.from({ length: 10 }, (_, i) => `cmd${i}`);
    const workspaces = [makeWorkspace([terminalTool([{ cwd: '~/a', commands }])])];
    expect(getRecentCommands(workspaces)).toEqual([
      'cmd0',
      'cmd1',
      'cmd2',
      'cmd3',
      'cmd4',
      'cmd5',
      'cmd6',
      'cmd7',
    ]);
  });

  it('respects a custom limit', () => {
    const commands = Array.from({ length: 10 }, (_, i) => `cmd${i}`);
    const workspaces = [makeWorkspace([terminalTool([{ cwd: '~/a', commands }])])];
    expect(getRecentCommands(workspaces, [], 2)).toEqual(['cmd0', 'cmd1']);
  });

  it('excludes commands already in the given list', () => {
    const workspaces = [
      makeWorkspace([
        terminalTool([{ cwd: '~/a', commands: ['npm run dev', 'npm test', 'npm run build'] }]),
      ]),
    ];
    expect(getRecentCommands(workspaces, ['npm test'])).toEqual(['npm run dev', 'npm run build']);
  });

  it('returns [] for an empty workspaces array', () => {
    expect(getRecentCommands([])).toEqual([]);
  });
});
