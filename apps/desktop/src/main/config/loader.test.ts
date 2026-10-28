import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteWorkspaceConfig,
  getWorkspacesDir,
  loadAllWorkspaceConfigs,
  saveWorkspaceConfig,
} from './loader';

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

  describe('migrating a v1 config', () => {
    const v1 = {
      version: 1,
      id: 'ws-old',
      name: 'Old',
      steps: [
        { type: 'vscode', params: { path: '~/a' } },
        { type: 'chrome', params: { profile: 'Default', urls: [] } },
      ],
    };

    it('gives every step a unique id and writes the upgraded file back', async () => {
      await writeConfig('ws-old.json', v1);

      const { configs, errors } = await loadAllWorkspaceConfigs();
      expect(errors).toEqual({});
      const [config] = configs;
      expect(config?.version).toBe(2);
      const ids = config?.steps.map((s) => s.id) ?? [];
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      expect(config?.steps.map(({ type, params }) => ({ type, params }))).toEqual(v1.steps);

      const onDisk = JSON.parse(await readFile(join(workspacesDir(), 'ws-old.json'), 'utf-8'));
      expect(onDisk).toEqual(config);
      const backup = JSON.parse(
        await readFile(join(workspacesDir(), 'ws-old.json.v1.bak'), 'utf-8'),
      );
      expect(backup).toEqual(v1);
    });

    it('keeps the same step ids on every later load', async () => {
      await writeConfig('ws-old.json', v1);
      const first = await loadAllWorkspaceConfigs();
      const second = await loadAllWorkspaceConfigs();
      expect(second.configs[0]?.steps.map((s) => s.id)).toEqual(
        first.configs[0]?.steps.map((s) => s.id),
      );
    });

    it('skips the workspace loudly when the upgraded file can’t be saved', async () => {
      await writeConfig('ws-old.json', v1);
      // A read-only directory: the atomic write's temp file can't be created.
      await chmod(workspacesDir(), 0o555);
      try {
        const { configs, errors } = await loadAllWorkspaceConfigs();
        expect(configs).toEqual([]);
        expect(errors['ws-old.json']).toContain("couldn't save it");
      } finally {
        await chmod(workspacesDir(), 0o755);
      }
      const onDisk = JSON.parse(await readFile(join(workspacesDir(), 'ws-old.json'), 'utf-8'));
      expect(onDisk.version).toBe(1);
    });

    it('rejects a config from a newer version instead of guessing', async () => {
      await writeConfig('ws-new.json', { version: 3, id: 'ws-new', name: 'New', steps: [] });
      const { configs, errors } = await loadAllWorkspaceConfigs();
      expect(configs).toEqual([]);
      expect(errors['ws-new.json']).toBeDefined();
    });
  });

  it('returns an empty result (and creates the directory) when none exists yet', async () => {
    const result = await loadAllWorkspaceConfigs();
    expect(result).toEqual({ configs: [], errors: {} });
  });

  it('loads a valid config file', async () => {
    await writeConfig('a.json', { version: 2, id: 'ws-a', name: 'A', steps: [] });

    const result = await loadAllWorkspaceConfigs();

    expect(result.configs).toEqual([{ version: 2, id: 'ws-a', name: 'A', steps: [] }]);
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
    await writeConfig('a-first.json', { version: 2, id: 'dup', name: 'First', steps: [] });
    await writeConfig('b-second.json', { version: 2, id: 'dup', name: 'Second', steps: [] });

    const result = await loadAllWorkspaceConfigs();

    expect(result.configs).toHaveLength(1);
    expect(result.configs[0]?.name).toBe('First');
    expect(result.errors['b-second.json']).toContain('Duplicate workspace id');
  });

  it('returns configs in a stable, sorted order regardless of write order', async () => {
    await writeConfig('c.json', { version: 2, id: 'c', name: 'C', steps: [] });
    await writeConfig('a.json', { version: 2, id: 'a', name: 'A', steps: [] });
    await writeConfig('b.json', { version: 2, id: 'b', name: 'B', steps: [] });

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

describe('saveWorkspaceConfig', () => {
  beforeEach(async () => {
    testUserDataDir = await mkdtemp(join(tmpdir(), 'workspace-launcher-test-'));
  });

  afterEach(async () => {
    await rm(testUserDataDir, { recursive: true, force: true });
  });

  it('writes a config file named after its id, loadable afterward', async () => {
    const config = { version: 2 as const, id: 'ws-new', name: 'New workspace', steps: [] };
    await saveWorkspaceConfig(config);

    const written = await readFile(join(workspacesDir(), 'ws-new.json'), 'utf-8');
    expect(JSON.parse(written)).toEqual(config);

    const result = await loadAllWorkspaceConfigs();
    expect(result.configs).toEqual([config]);
  });

  it('creates the workspaces directory if it does not exist yet', async () => {
    const config = { version: 2 as const, id: 'ws-first', name: 'First', steps: [] };
    await saveWorkspaceConfig(config);
    expect(await readFile(join(workspacesDir(), 'ws-first.json'), 'utf-8')).toContain('ws-first');
  });

  it('overwrites an existing file for the same id', async () => {
    const first = { version: 2 as const, id: 'ws-dup', name: 'First name', steps: [] };
    const second = { version: 2 as const, id: 'ws-dup', name: 'Second name', steps: [] };
    await saveWorkspaceConfig(first);
    await saveWorkspaceConfig(second);

    const written = JSON.parse(await readFile(join(workspacesDir(), 'ws-dup.json'), 'utf-8'));
    expect(written.name).toBe('Second name');
  });
});

describe('deleteWorkspaceConfig', () => {
  beforeEach(async () => {
    testUserDataDir = await mkdtemp(join(tmpdir(), 'workspace-launcher-test-'));
  });

  afterEach(async () => {
    await rm(testUserDataDir, { recursive: true, force: true });
  });

  it('removes an existing config file', async () => {
    const config = { version: 2 as const, id: 'ws-del', name: 'To delete', steps: [] };
    await saveWorkspaceConfig(config);

    await deleteWorkspaceConfig('ws-del');

    const result = await loadAllWorkspaceConfigs();
    expect(result.configs).toEqual([]);
  });

  it('resolves without error when the file does not exist (ENOENT)', async () => {
    await expect(deleteWorkspaceConfig('never-existed')).resolves.toBeUndefined();
  });

  it('propagates a non-ENOENT fs error instead of treating it as success', async () => {
    // A directory, not a file, at the expected path — unlink() on it
    // fails with EPERM/EISDIR, not ENOENT, and must not be swallowed.
    await mkdir(join(workspacesDir(), 'weird.json'), { recursive: true });
    await expect(deleteWorkspaceConfig('weird')).rejects.toThrow();
  });
});

describe('getWorkspacesDir', () => {
  beforeEach(async () => {
    testUserDataDir = await mkdtemp(join(tmpdir(), 'workspace-launcher-test-'));
  });

  afterEach(async () => {
    await rm(testUserDataDir, { recursive: true, force: true });
  });

  it('returns a "workspaces" subdirectory of the userData path', () => {
    expect(getWorkspacesDir()).toBe(join(testUserDataDir, 'workspaces'));
  });
});
