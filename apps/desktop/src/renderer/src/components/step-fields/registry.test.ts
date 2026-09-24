import { describe, expect, it } from 'vitest';
import { getStepFieldsComponent, stepFieldsHasPrimaryInput } from './registry';

describe('stepFieldsHasPrimaryInput', () => {
  it.each(['vscode', 'chrome', 'spotify'])('is true for %s', (type) => {
    expect(stepFieldsHasPrimaryInput(type)).toBe(true);
  });

  it('is false for clockify (registered, but no primary input)', () => {
    // The bug this regression test guards against: clockify is an
    // *implemented* type with nothing to configure — previously
    // WorkspaceFormModal.tsx derived "has an input to focus" from
    // `preset.implemented` alone, which would have wrongly been true
    // here, suppressing Radix's fallback refocus while nothing was
    // ever registered to focus instead (focus silently falls through
    // to <body>).
    expect(stepFieldsHasPrimaryInput('clockify')).toBe(false);
  });

  it.each(['docker', 'terminal', 'slack', 'unknown-type'])(
    'is false for %s (no registry entry)',
    (type) => {
      expect(stepFieldsHasPrimaryInput(type)).toBe(false);
    },
  );
});

describe('getStepFieldsComponent', () => {
  it('still returns a component for clockify', () => {
    expect(getStepFieldsComponent('clockify')).toBeDefined();
  });

  it('returns undefined for an unregistered type', () => {
    expect(getStepFieldsComponent('docker')).toBeUndefined();
  });
});
