import { describe, expect, it } from 'vitest';
import {
  getStepFieldsComponent,
  stepFieldsHasPrimaryInput,
  stepFieldsIsCollapsible,
  stepRowSummary,
} from './registry';

describe('stepFieldsHasPrimaryInput', () => {
  it('is true for vscode', () => {
    expect(stepFieldsHasPrimaryInput('vscode')).toBe(true);
  });

  it.each(['spotify', 'chrome', 'app', 'clockify'])(
    'is false for %s (collapsible, but its UI is buttons/a picker, not a plain input)',
    (type) => {
      expect(stepFieldsHasPrimaryInput(type)).toBe(false);
    },
  );

  it.each(['docker', 'terminal', 'slack', 'unknown-type'])(
    'is false for %s (no registry entry)',
    (type) => {
      expect(stepFieldsHasPrimaryInput(type)).toBe(false);
    },
  );
});

describe('stepFieldsIsCollapsible', () => {
  it.each(['vscode', 'chrome', 'spotify', 'app', 'clockify'])('is true for %s', (type) => {
    expect(stepFieldsIsCollapsible(type)).toBe(true);
  });

  it.each(['docker', 'terminal', 'slack', 'unknown-type'])(
    'is false for %s (no registry entry)',
    (type) => {
      expect(stepFieldsIsCollapsible(type)).toBe(false);
    },
  );
});

describe('stepRowSummary', () => {
  // Business logic for each type's actual summary text lives in, and is
  // fully covered by, step-summaries.test.ts — these just confirm the
  // type-keyed delegation itself is wired correctly.
  it("delegates to each collapsible type's own summary function", () => {
    expect(stepRowSummary('vscode', { path: '~/x' })).toBe('~/x');
    expect(stepRowSummary('chrome', { profile: 'Default' })).toBe('Default');
    expect(stepRowSummary('spotify', { playlistName: 'Deep Focus' })).toBe('Deep Focus');
    expect(stepRowSummary('clockify', { appPath: '/Applications/Clockify.app' })).toBe('Clockify');
  });

  it('returns an empty string for a type with no summary entry (app) or no registry entry at all', () => {
    expect(stepRowSummary('app', { path: '/Applications/Figma.app' })).toBe('');
    expect(stepRowSummary('docker', {})).toBe('');
  });
});

describe('getStepFieldsComponent', () => {
  it('returns a component for clockify (its own installed-app detection, same as vscode/chrome/spotify)', () => {
    expect(getStepFieldsComponent('clockify')).toBeDefined();
  });

  it('returns a component for app', () => {
    expect(getStepFieldsComponent('app')).toBeDefined();
  });

  it('returns undefined for an unregistered type', () => {
    expect(getStepFieldsComponent('docker')).toBeUndefined();
  });
});
