import { describe, expect, it } from 'vitest';
import {
  assignStepIds,
  CURRENT_WORKSPACE_CONFIG_VERSION,
  migrateWorkspaceConfig,
  parseWorkspaceConfig,
} from './config-schema';

describe('parseWorkspaceConfig', () => {
  it('rejects a config missing version', () => {
    const result = parseWorkspaceConfig({ id: 'ws-1', name: 'My Workspace', steps: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a non-object input', () => {
    const result = parseWorkspaceConfig('not a config');
    expect(result.success).toBe(false);
  });

  it('accepts a minimal valid config', () => {
    const result = parseWorkspaceConfig({
      version: 2,
      id: 'ws-1',
      name: 'My Workspace',
      steps: [{ id: 'step-1', type: 'docker', params: { command: 'compose up' } }],
    });
    expect(result.success).toBe(true);
  });

  it('exposes the current config version as a named constant, not a scattered literal', () => {
    expect(CURRENT_WORKSPACE_CONFIG_VERSION).toBe(2);
  });

  it('rejects a version other than the current one', () => {
    for (const version of [1, 3]) {
      const result = parseWorkspaceConfig({ version, id: 'ws-1', name: 'X', steps: [] });
      expect(result.success).toBe(false);
    }
  });

  it('accepts a real randomUUID()-shaped id', () => {
    const result = parseWorkspaceConfig({
      version: 2,
      id: 'a1b2c3d4-e5f6-4789-a012-b3c4d5e6f789',
      name: 'X',
      steps: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an id containing path-traversal or path-separator characters', () => {
    // config/loader.ts uses `id` directly as `<id>.json` on disk —
    // this must never be allowed to escape the workspaces directory.
    for (const id of ['../../etc/evil', '..\\..\\evil', 'a/b', 'a\\b']) {
      const result = parseWorkspaceConfig({ version: 2, id, name: 'X', steps: [] });
      expect(result.success).toBe(false);
    }
  });

  it('rejects a step without an id, with a malformed id, or with a duplicated one', () => {
    const step = (id?: string): object => ({
      ...(id === undefined ? {} : { id }),
      type: 'x',
      params: {},
    });
    for (const steps of [[step()], [step('a/b')], [step('')], [step('same'), step('same')]]) {
      const result = parseWorkspaceConfig({ version: 2, id: 'ws-1', name: 'X', steps });
      expect(result.success).toBe(false);
    }
  });
});

describe('migrateWorkspaceConfig', () => {
  it('upgrades v1 to v2, giving every step a unique id and keeping everything else', () => {
    const v1 = {
      version: 1,
      id: 'ws-1',
      name: 'X',
      steps: [
        { type: 'vscode', params: { path: '~/a' } },
        { type: 'vscode', params: { path: '~/a' } },
      ],
    };
    const { migrated, value } = migrateWorkspaceConfig(v1);
    expect(migrated).toBe(true);
    const parsed = parseWorkspaceConfig(value);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.config.steps.map(({ type, params }) => ({ type, params }))).toEqual(v1.steps);
    expect(new Set(parsed.config.steps.map((s) => s.id)).size).toBe(2);
  });

  it('leaves a current, newer or unrecognizable config untouched for the parser to judge', () => {
    for (const input of [
      { version: 2, id: 'ws-1', name: 'X', steps: [] },
      { version: 3, id: 'ws-1', name: 'X', steps: [] },
      { version: 1, id: 'ws-1', name: 'X', steps: 'nope' },
      'not a config',
      null,
    ]) {
      expect(migrateWorkspaceConfig(input)).toEqual({ migrated: false, value: input });
    }
  });
});

describe('assignStepIds', () => {
  it('fills in ids only for steps that have none', () => {
    const result = assignStepIds([
      { id: 'keep', type: 'a', params: {} },
      { type: 'b', params: {} },
    ]) as { id: string }[];
    expect(result[0]?.id).toBe('keep');
    expect(result[1]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('passes untrusted non-array input straight through to the parser', () => {
    expect(assignStepIds('nope')).toBe('nope');
    expect(assignStepIds([null, 'x'])).toEqual([null, 'x']);
  });
});
