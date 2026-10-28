import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAccessibilityTrust, parseTrustOutput } from './accessibility-permission';

const tempDirs: string[] = [];

afterEach(() => {
  tempDirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

/** A real executable standing in for `wl-helper trust`. */
function fakeHelper(script: string, executable = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'wl-trust-test-'));
  tempDirs.push(dir);
  const path = join(dir, 'wl-helper');
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, executable ? 0o755 : 0o644);
  return path;
}

describe('parseTrustOutput', () => {
  it('reads the helper’s one-line answer', () => {
    expect(parseTrustOutput('{"trusted":true}\n')).toEqual({ ok: true, trusted: true });
    expect(parseTrustOutput('{"trusted":false}')).toEqual({ ok: true, trusted: false });
  });

  it('rejects anything else loudly rather than guessing', () => {
    for (const output of ['', 'yes', '{"trusted":"true"}', '[]', 'null']) {
      const result = parseTrustOutput(output);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain('unexpected output');
    }
  });
});

describe('checkAccessibilityTrust', () => {
  it('runs the helper’s trust mode and returns its answer', async () => {
    const helper = fakeHelper('[ "$1" = trust ] && echo \'{"trusted":false}\'');
    await expect(checkAccessibilityTrust(helper)).resolves.toEqual({ ok: true, trusted: false });
  });

  it('reports a missing helper with how to build it', async () => {
    const result = await checkAccessibilityTrust('/nonexistent/wl-helper');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('npm run build:helper');
  });

  it('reports a helper that isn’t executable', async () => {
    const result = await checkAccessibilityTrust(fakeHelper('echo hi', false));
    expect(!result.ok && result.error).toContain("isn't executable");
  });

  it('reports a failing helper with its stderr', async () => {
    const result = await checkAccessibilityTrust(fakeHelper('echo boom >&2; exit 2'));
    expect(!result.ok && result.error).toContain('boom');
  });
});
