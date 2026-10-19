import { describe, expect, it } from 'vitest';
import {
  getStepFieldsComponent,
  stepFieldsHasPrimaryInput,
  stepFieldsIsCollapsible,
} from './registry';

describe('stepFieldsHasPrimaryInput', () => {
  it('is true for vscode', () => {
    expect(stepFieldsHasPrimaryInput('vscode')).toBe(true);
  });

  it.each(['spotify', 'chrome', 'app'])(
    'is false for %s (collapsible, but its UI is buttons/a picker, not a plain input)',
    (type) => {
      expect(stepFieldsHasPrimaryInput(type)).toBe(false);
    },
  );

  it.each(['docker', 'terminal', 'slack', 'clockify', 'unknown-type'])(
    'is false for %s (no registry entry)',
    (type) => {
      expect(stepFieldsHasPrimaryInput(type)).toBe(false);
    },
  );
});

describe('stepFieldsIsCollapsible', () => {
  it.each(['vscode', 'chrome', 'spotify', 'app'])('is true for %s', (type) => {
    expect(stepFieldsIsCollapsible(type)).toBe(true);
  });

  it.each(['docker', 'terminal', 'slack', 'clockify', 'unknown-type'])(
    'is false for %s (no registry entry)',
    (type) => {
      expect(stepFieldsIsCollapsible(type)).toBe(false);
    },
  );
});

describe('getStepFieldsComponent', () => {
  it('returns undefined for clockify (implemented, but genuinely nothing to configure — no registry entry)', () => {
    expect(getStepFieldsComponent('clockify')).toBeUndefined();
  });

  it('returns a component for app', () => {
    expect(getStepFieldsComponent('app')).toBeDefined();
  });

  it('returns undefined for an unregistered type', () => {
    expect(getStepFieldsComponent('docker')).toBeUndefined();
  });
});
