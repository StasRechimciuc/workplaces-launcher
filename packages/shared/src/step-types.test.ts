import { describe, expect, it } from 'vitest';
import { getStepTypeDefinition, STEP_TYPES } from './step-types';

describe('STEP_TYPES', () => {
  it('has a unique type key per Tier 1 step type', () => {
    const types = STEP_TYPES.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual([
      'vscode',
      'docker',
      'terminal',
      'chrome',
      'slack',
      'spotify',
      'clockify',
    ]);
  });

  it('marks the built tool types as implemented and the rest as not yet built', () => {
    for (const type of ['vscode', 'chrome', 'spotify', 'clockify']) {
      expect(getStepTypeDefinition(type)?.implemented).toBe(true);
    }
    for (const type of ['docker', 'terminal', 'slack']) {
      expect(getStepTypeDefinition(type)?.implemented).toBe(false);
    }
  });

  it('returns undefined for a step type not on the Tier 1 list, without throwing', () => {
    expect(getStepTypeDefinition('nonexistent')).toBeUndefined();
  });
});
