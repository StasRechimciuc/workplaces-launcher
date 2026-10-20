import { describe, expect, it } from 'vitest';
import { classifyAppPathCandidates } from './resolve-app-path';

describe('classifyAppPathCandidates', () => {
  it('returns "none" for an empty list', () => {
    expect(classifyAppPathCandidates([])).toEqual({ kind: 'none' });
  });

  it('returns "single" with the one candidate for a one-item list', () => {
    const candidate = { path: '/Applications/Visual Studio Code.app', displayName: 'Visual Studio Code' };
    expect(classifyAppPathCandidates([candidate])).toEqual({ kind: 'single', candidate });
  });

  it('returns "multiple" with every candidate preserved, in order, for 2+ items', () => {
    const candidates = [
      { path: '/Applications/Visual Studio Code.app', displayName: 'Visual Studio Code' },
      { path: '/Applications/Visual Studio Code - Insiders.app', displayName: 'Visual Studio Code - Insiders' },
    ];
    expect(classifyAppPathCandidates(candidates)).toEqual({ kind: 'multiple', candidates });
  });

  it('preserves two candidates with the same displayName but different paths', () => {
    const candidates = [
      { path: '/Applications/Visual Studio Code.app', displayName: 'Visual Studio Code' },
      { path: '/Users/me/Applications/Visual Studio Code.app', displayName: 'Visual Studio Code' },
    ];
    const result = classifyAppPathCandidates(candidates);
    expect(result).toEqual({ kind: 'multiple', candidates });
    if (result.kind === 'multiple') {
      expect(result.candidates[0]!.path).not.toBe(result.candidates[1]!.path);
    }
  });
});
