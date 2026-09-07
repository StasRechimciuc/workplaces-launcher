import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAllWorkspaceConfigs } from './loader';

// config/loader.ts only uses app.getPath('userData') — faked with a
// real temp directory so the rest of the test can do real file I/O
// against it, rather than mocking node:fs/promises itself.
let testUserDataDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataDir,
  },
}));

function workspacesDir(): string {
  return join(testUserDataDir, 'workspaces');
}

async function writeConfig(fileName: string, contents: unknown): Promise<void> {
  await mkdir(workspacesDir(), { recursive: true });
  await writeFile(join(workspacesDir(), fileName), JSON.stringify(contents));
}

describe('loadAllWorkspaceConfigs', () => {
  beforeEach(async () => {
    testUserDataDir = await mkdtemp(join(tmpdir(), 'workspace-launcher-test-'));
  });

  afterEach(async () => {
    await rm(testUserDataDir, { recursive: true, force: true });
  });

  it('returns an empty result (and creates the directory) when none exists yet', async () => {
    const result = await loadAllWorkspaceConfigs();
    expect(result).toEqual({ configs: [], errors: {} });
  });

  it('loads a valid config file', async () => {
    await writeConfig('a.json', { version: 1, id: 'ws-a', name: 'A', steps: [] });

    const result = await loadAllWorkspaceConfigs();

    expect(result.configs).toEqual([{ version: 1, id: 'ws-a', name: 'A', steps: [] }]);
    expect(result.errors).toEqual({});
  });

  it('reports malformed JSON by file name instead of throwing', async () => {
    await mkdir(workspacesDir(), { recursive: true });
    await writeFile(join(workspacesDir(), 'broken.json'), '{ not valid json');

    const result = await loadAllWorkspaceConfigs();

    expect(result.configs).toEqual([]);
    expect(result.errors['broken.json']).toBeDefined();
  });

  it('reports a config that fails schema validation by file name', async () => {
    await writeConfig('invalid.json', { id: 'missing-required-fields' });

    const result = await loadAllWorkspaceConfigs();

    expect(result.configs).toEqual([]);
    expect(result.errors['invalid.json']).toBeDefined();
  });

  it('skips and reports a duplicate id, keeping only the first file loaded', async () => {
    await writeConfig('a-first.json', { version: 1, id: 'dup', name: 'First', steps: [] });
    await writeConfig('b-second.json', { version: 1, id: 'dup', name: 'Second', steps: [] });

    const result = await loadAllWorkspaceConfigs();

    expect(result.configs).toHaveLength(1);
    expect(result.configs[0]?.name).toBe('First');
    expect(result.errors['b-second.json']).toContain('Duplicate workspace id');
  });

  it('returns configs in a stable, sorted order regardless of write order', async () => {
    await writeConfig('c.json', { version: 1, id: 'c', name: 'C', steps: [] });
    await writeConfig('a.json', { version: 1, id: 'a', name: 'A', steps: [] });
    await writeConfig('b.json', { version: 1, id: 'b', name: 'B', steps: [] });

    const result = await loadAllWorkspaceConfigs();

    expect(result.configs.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('reports a directory-access failure gracefully instead of throwing', async () => {
    // A regular file, not a directory — mkdir('.../workspaces') under
    // it must fail (ENOTDIR), simulating a permissions/access problem.
    const blockerFile = join(testUserDataDir, 'blocker');
    await writeFile(blockerFile, 'not a directory');
    testUserDataDir = blockerFile;

    const result = await loadAllWorkspaceConfigs();

    expect(result.configs).toEqual([]);
    expect(Object.keys(result.errors)).toHaveLength(1);
  });
});
