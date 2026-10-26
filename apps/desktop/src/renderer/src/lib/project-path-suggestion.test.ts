import { describe, expect, it } from 'vitest';
import { getProjectPathSuggestion } from './project-path-suggestion';

describe('getProjectPathSuggestion', () => {
  it('returns undefined when no other step has a project-path value', () => {
    const steps = [
      { key: 1, type: 'docker', params: {} },
      { key: 2, type: 'chrome', params: { profile: 'Default' } },
    ];
    expect(getProjectPathSuggestion(steps, 1)).toBeUndefined();
  });

  it("suggests VS Code's path for an empty Docker row", () => {
    const steps = [
      { key: 1, type: 'vscode', params: { path: '~/projects/x' } },
      { key: 2, type: 'docker', params: {} },
    ];
    expect(getProjectPathSuggestion(steps, 2)).toEqual({
      sourceLabel: 'VS Code',
      path: '~/projects/x',
    });
  });

  it("suggests Docker's directory for an empty VS Code row (the reverse direction)", () => {
    const steps = [
      { key: 1, type: 'docker', params: { directory: '~/projects/x' } },
      { key: 2, type: 'vscode', params: {} },
    ];
    expect(getProjectPathSuggestion(steps, 2)).toEqual({
      sourceLabel: 'Docker',
      path: '~/projects/x',
    });
  });

  it("suggests a standalone Terminal step's first entry cwd", () => {
    const steps = [
      { key: 1, type: 'terminal', params: { terminals: [{ cwd: '~/projects/x', commands: [] }] } },
      { key: 2, type: 'docker', params: {} },
    ];
    expect(getProjectPathSuggestion(steps, 2)).toEqual({
      sourceLabel: 'Terminal',
      path: '~/projects/x',
    });
  });

  it('ignores a terminal step with zero entries', () => {
    const steps = [
      { key: 1, type: 'terminal', params: { terminals: [] } },
      { key: 2, type: 'docker', params: {} },
    ];
    expect(getProjectPathSuggestion(steps, 2)).toBeUndefined();
  });

  it('is order-independent — whichever step comes first in the array wins, regardless of type', () => {
    const steps = [
      { key: 1, type: 'docker', params: { directory: '~/from-docker' } },
      { key: 2, type: 'vscode', params: { path: '~/from-vscode' } },
      { key: 3, type: 'terminal', params: {} },
    ];
    expect(getProjectPathSuggestion(steps, 3)).toEqual({
      sourceLabel: 'Docker',
      path: '~/from-docker',
    });
  });

  it('never suggests a row its own current value to itself', () => {
    const steps = [{ key: 1, type: 'vscode', params: { path: '~/x' } }];
    expect(getProjectPathSuggestion(steps, 1)).toBeUndefined();
  });

  it('ignores step types with no project-path-shaped field (chrome, spotify, app, link)', () => {
    const steps = [
      { key: 1, type: 'chrome', params: { profile: 'Default', urls: ['https://x.com'] } },
      { key: 2, type: 'app', params: { path: '/Applications/Figma.app' } },
      { key: 3, type: 'docker', params: {} },
    ];
    expect(getProjectPathSuggestion(steps, 3)).toBeUndefined();
  });

  it('treats an empty-string path/directory/cwd as not set', () => {
    const steps = [
      { key: 1, type: 'vscode', params: { path: '' } },
      { key: 2, type: 'docker', params: { directory: '' } },
      { key: 3, type: 'terminal', params: { terminals: [{ cwd: '', commands: [] }] } },
      { key: 4, type: 'docker', params: {} },
    ];
    expect(getProjectPathSuggestion(steps, 4)).toBeUndefined();
  });
});
