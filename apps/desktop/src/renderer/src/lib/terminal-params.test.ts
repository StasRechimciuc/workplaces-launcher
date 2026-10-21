import { describe, expect, it } from 'vitest';
import {
  addTerminalEntry,
  getTerminalEntries,
  removeTerminalEntry,
  updateTerminalEntry,
} from './terminal-params';

describe('getTerminalEntries', () => {
  it('returns [] when terminals is missing or not an array', () => {
    expect(getTerminalEntries({})).toEqual([]);
    expect(getTerminalEntries({ terminals: 'nope' })).toEqual([]);
  });

  it('reads cwd/commands, defaulting malformed fields safely', () => {
    expect(getTerminalEntries({ terminals: [{ cwd: '~/x', commands: ['npm i'] }] })).toEqual([
      { cwd: '~/x', commands: ['npm i'] },
    ]);
    expect(getTerminalEntries({ terminals: [{}] })).toEqual([{ cwd: '', commands: [] }]);
    expect(getTerminalEntries({ terminals: [null, 'garbage'] })).toEqual([
      { cwd: '', commands: [] },
      { cwd: '', commands: [] },
    ]);
  });

  it('filters non-string entries out of commands', () => {
    expect(getTerminalEntries({ terminals: [{ cwd: '~/x', commands: ['a', 1, null, 'b'] }] })).toEqual(
      [{ cwd: '~/x', commands: ['a', 'b'] }],
    );
  });
});

describe('addTerminalEntry', () => {
  it('appends a new entry defaulting to the home directory, preserving existing ones', () => {
    expect(addTerminalEntry({})).toEqual([{ cwd: '~', commands: [] }]);
    expect(addTerminalEntry({ terminals: [{ cwd: '~/x', commands: [] }] })).toEqual([
      { cwd: '~/x', commands: [] },
      { cwd: '~', commands: [] },
    ]);
  });
});

describe('removeTerminalEntry', () => {
  it('removes only the entry at the given index', () => {
    const params = {
      terminals: [
        { cwd: '~/a', commands: [] },
        { cwd: '~/b', commands: [] },
        { cwd: '~/c', commands: [] },
      ],
    };
    expect(removeTerminalEntry(params, 1)).toEqual([
      { cwd: '~/a', commands: [] },
      { cwd: '~/c', commands: [] },
    ]);
  });
});

describe('updateTerminalEntry', () => {
  it('merges the given fields into only the entry at the given index', () => {
    const params = {
      terminals: [
        { cwd: '~/a', commands: ['npm i'] },
        { cwd: '~/b', commands: [] },
      ],
    };
    expect(updateTerminalEntry(params, 0, { cwd: '~/a2' })).toEqual([
      { cwd: '~/a2', commands: ['npm i'] },
      { cwd: '~/b', commands: [] },
    ]);
    expect(updateTerminalEntry(params, 1, { commands: ['npm run dev'] })).toEqual([
      { cwd: '~/a', commands: ['npm i'] },
      { cwd: '~/b', commands: ['npm run dev'] },
    ]);
  });
});
