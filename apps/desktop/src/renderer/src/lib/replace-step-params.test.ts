import { describe, expect, it } from 'vitest';
import { replaceStepParams } from './replace-step-params';

describe('replaceStepParams', () => {
  it('replaces only the target index, leaving every other step untouched', () => {
    const steps = [
      { type: 'vscode', params: { path: '~/a' } },
      { type: 'chrome', params: { profile: 'Default' } },
      { type: 'spotify', params: { playlist: 'spotify:playlist:x' } },
    ];

    const result = replaceStepParams(steps, 1, { profile: 'Work', profileName: 'Work' });

    expect(result[1]).toEqual({ type: 'chrome', params: { profile: 'Work', profileName: 'Work' } });
    // Untouched entries are reference-equal, not just deep-equal — no
    // unnecessary new objects for steps that didn't change.
    expect(result[0]).toBe(steps[0]);
    expect(result[2]).toBe(steps[2]);
  });

  it('handles index 0 and the last index', () => {
    const steps = [
      { type: 'vscode', params: { path: '~/a' } },
      { type: 'chrome', params: { profile: 'Default' } },
    ];

    expect(replaceStepParams(steps, 0, { path: '~/b' })[0]?.params).toEqual({ path: '~/b' });
    expect(replaceStepParams(steps, 1, { profile: 'X' })[1]?.params).toEqual({ profile: 'X' });
  });

  it('handles a single-step array', () => {
    const steps = [{ type: 'vscode', params: { path: '~/a' } }];
    const result = replaceStepParams(steps, 0, { path: '~/b' });
    expect(result).toEqual([{ type: 'vscode', params: { path: '~/b' } }]);
  });

  it('does not mutate the original array or step objects', () => {
    const steps = [{ type: 'vscode', params: { path: '~/a' } }];
    const original = steps[0];
    replaceStepParams(steps, 0, { path: '~/b' });
    expect(steps[0]).toBe(original);
    expect(original?.params).toEqual({ path: '~/a' });
  });
});
