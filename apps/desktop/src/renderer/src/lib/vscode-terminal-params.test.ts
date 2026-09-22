import { describe, expect, it } from 'vitest';
import { getFirstTerminalCommands, mergeFirstTerminalCommands } from './vscode-terminal-params';

describe('getFirstTerminalCommands', () => {
  it('returns [] when terminals is absent', () => {
    expect(getFirstTerminalCommands({})).toEqual([]);
  });

  it('returns [] when terminals is present but empty', () => {
    expect(getFirstTerminalCommands({ terminals: [] })).toEqual([]);
  });

  it("returns the first terminal's commands", () => {
    const params = { terminals: [{ commands: ['npm install', 'npm run dev'] }] };
    expect(getFirstTerminalCommands(params)).toEqual(['npm install', 'npm run dev']);
  });

  it('ignores any terminals beyond the first', () => {
    const params = {
      terminals: [{ commands: ['first'] }, { commands: ['second'] }],
    };
    expect(getFirstTerminalCommands(params)).toEqual(['first']);
  });

  it('filters out non-string entries defensively', () => {
    const params = { terminals: [{ commands: ['ok', 42, null, 'also ok'] }] };
    expect(getFirstTerminalCommands(params)).toEqual(['ok', 'also ok']);
  });

  it('does not throw on malformed shapes', () => {
    expect(getFirstTerminalCommands({ terminals: 'not-an-array' })).toEqual([]);
    expect(getFirstTerminalCommands({ terminals: [null] })).toEqual([]);
    expect(getFirstTerminalCommands({ terminals: [{ commands: 'not-an-array' }] })).toEqual([]);
  });
});

describe('mergeFirstTerminalCommands', () => {
  it('creates a single terminal entry when there were none before', () => {
    expect(mergeFirstTerminalCommands({}, ['npm run dev'])).toEqual([
      { commands: ['npm run dev'] },
    ]);
  });

  it("replaces terminal[0]'s commands only, preserving terminals[1+]", () => {
    const params = {
      terminals: [{ commands: ['old command'] }, { commands: ['second terminal, untouched'] }],
    };
    const result = mergeFirstTerminalCommands(params, ['new command']);
    expect(result).toEqual([
      { commands: ['new command'] },
      { commands: ['second terminal, untouched'] },
    ]);
  });

  it('drops terminal[0] entirely (not an empty-commands entry) when cleared, but keeps the rest', () => {
    const params = {
      terminals: [{ commands: ['old command'] }, { commands: ['second terminal, untouched'] }],
    };
    const result = mergeFirstTerminalCommands(params, []);
    expect(result).toEqual([{ commands: ['second terminal, untouched'] }]);
  });

  it('returns [] when clearing the only terminal', () => {
    const params = { terminals: [{ commands: ['old command'] }] };
    expect(mergeFirstTerminalCommands(params, [])).toEqual([]);
  });

  it('does not throw when terminals is absent from params entirely', () => {
    expect(mergeFirstTerminalCommands({ path: '/tmp/x' }, ['echo hi'])).toEqual([
      { commands: ['echo hi'] },
    ]);
  });
});
