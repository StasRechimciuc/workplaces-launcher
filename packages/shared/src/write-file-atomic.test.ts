import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from './write-file-atomic';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'write-file-atomic-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('writes the file with the given contents', async () => {
    const target = join(dir, 'config.json');
    await writeFileAtomic(target, '{"a":1}');
    expect(await readFile(target, 'utf-8')).toBe('{"a":1}');
  });

  it('leaves no temp file behind on success', async () => {
    await writeFileAtomic(join(dir, 'config.json'), 'hello');
    expect(await readdir(dir)).toEqual(['config.json']);
  });

  it('overwrites an existing file completely, not appending', async () => {
    const target = join(dir, 'config.json');
    await writeFileAtomic(target, 'aaaaaaaaaa');
    await writeFileAtomic(target, 'b');
    expect(await readFile(target, 'utf-8')).toBe('b');
  });

  it('leaves no partial file and no temp file when the write fails', async () => {
    // The target's parent directory doesn't exist, so the internal
    // writeFile() to the sibling temp path fails too (ENOENT) —
    // nothing should be left behind anywhere in `dir`.
    const target = join(dir, 'missing-subdir', 'config.json');
    await expect(writeFileAtomic(target, 'x')).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
