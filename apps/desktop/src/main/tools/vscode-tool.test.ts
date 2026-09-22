import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vscodeTool } from './vscode-tool';
import { getPlatformLauncher } from '../platform';
import {
  deletePendingVscodeRestore,
  writePendingVscodeRestore,
} from '@workspace-launcher/shared/vscode-restore';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

vi.mock('@workspace-launcher/shared/vscode-restore', () => ({
  writePendingVscodeRestore: vi.fn(),
  deletePendingVscodeRestore: vi.fn(),
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const mockedWritePendingVscodeRestore = vi.mocked(writePendingVscodeRestore);
const mockedDeletePendingVscodeRestore = vi.mocked(deletePendingVscodeRestore);

const openInApp = vi.fn();

beforeEach(() => {
  openInApp.mockReset();
  mockedGetPlatformLauncher.mockReset();
  mockedGetPlatformLauncher.mockReturnValue({
    launchApp: vi.fn(),
    openInApp,
    openUrlInBrowserProfile: vi.fn(),
  });
  mockedWritePendingVscodeRestore.mockReset().mockResolvedValue(undefined);
  mockedDeletePendingVscodeRestore.mockReset().mockResolvedValue(undefined);
});

describe('vscodeTool', () => {
  it('has type "vscode"', () => {
    expect(vscodeTool.type).toBe('vscode');
  });

  describe('validate', () => {
    it('accepts a params object with a non-empty path', () => {
      const result = vscodeTool.validate({ path: '/Users/me/projects/client-a' });
      expect(result).toEqual({
        valid: true,
        data: { path: '/Users/me/projects/client-a', terminals: [] },
      });
    });

    it('rejects params missing path', () => {
      const result = vscodeTool.validate({});
      if (result.valid) {
        throw new Error('expected validation to fail');
      }
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects an empty-string path', () => {
      const result = vscodeTool.validate({ path: '' });
      expect(result.valid).toBe(false);
    });

    it('rejects a relative path', () => {
      // A relative path silently breaks the terminal-restore handoff
      // (hashes to a different file than the extension's absolute
      // folder.uri.fsPath ever will) and may open the wrong folder — see
      // lib/paths.ts's isAcceptableToolPath.
      const result = vscodeTool.validate({ path: 'my-project' });
      if (result.valid) {
        throw new Error('expected validation to fail');
      }
      expect(result.errors.join(' ')).toContain('absolute');
    });

    it('accepts a "~"-prefixed path', () => {
      const result = vscodeTool.validate({ path: '~/projects/client-a' });
      expect(result).toEqual({ valid: true, data: { path: '~/projects/client-a', terminals: [] } });
    });

    it('rejects non-object input', () => {
      const result = vscodeTool.validate('/Users/me/projects/client-a');
      expect(result.valid).toBe(false);
    });

    it('accepts params missing terminals, defaulting to an empty array', () => {
      const result = vscodeTool.validate({ path: '/Users/me/projects/client-a' });
      expect(result).toEqual({
        valid: true,
        data: { path: '/Users/me/projects/client-a', terminals: [] },
      });
    });

    it('accepts a valid terminals array', () => {
      const result = vscodeTool.validate({
        path: '/Users/me/projects/client-a',
        terminals: [{ commands: ['npm install', 'npm run dev'] }],
      });
      expect(result).toEqual({
        valid: true,
        data: {
          path: '/Users/me/projects/client-a',
          terminals: [{ commands: ['npm install', 'npm run dev'] }],
        },
      });
    });

    it('rejects a terminal with an empty-string command', () => {
      const result = vscodeTool.validate({
        path: '/Users/me/projects/client-a',
        terminals: [{ commands: [''] }],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('run', () => {
    it('opens the given path in Visual Studio Code via the platform launcher', async () => {
      openInApp.mockResolvedValueOnce({ success: true, message: 'Opened.' });

      const result = await vscodeTool.run(
        { path: '/Users/me/projects/client-a', terminals: [] },
        { workspaceId: 'ws-1' },
      );

      expect(openInApp).toHaveBeenCalledWith('Visual Studio Code', '/Users/me/projects/client-a');
      expect(result.success).toBe(true);
      expect(typeof result.durationMs).toBe('number');
    });

    it('expands a leading ~ before calling the platform launcher', async () => {
      openInApp.mockResolvedValueOnce({ success: true, message: 'Opened.' });

      await vscodeTool.run({ path: '~/projects/client-a', terminals: [] }, { workspaceId: 'ws-1' });

      const [, calledPath] = openInApp.mock.calls[0]!;
      expect(calledPath).not.toContain('~');
      expect(calledPath.endsWith('/projects/client-a')).toBe(true);
    });

    it('surfaces a platform-launcher failure as a failed StepResult, not a throw', async () => {
      openInApp.mockResolvedValueOnce({ success: false, message: 'app not found' });

      const result = await vscodeTool.run(
        { path: '/Users/me/projects/client-a', terminals: [] },
        { workspaceId: 'ws-1' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('app not found');
    });

    it('does not stage a restore file when terminals is empty', async () => {
      openInApp.mockResolvedValueOnce({ success: true, message: 'Opened.' });

      await vscodeTool.run(
        { path: '/Users/me/projects/client-a', terminals: [] },
        { workspaceId: 'ws-1' },
      );

      expect(mockedWritePendingVscodeRestore).not.toHaveBeenCalled();
    });

    it('does not crash when terminals is entirely absent from params (not just empty)', async () => {
      // Regression-shaped test mirroring chrome-tool.ts's own urls
      // guard: validate()'s zod default([]) only affects pass/fail, it
      // never rewrites what run() actually receives.
      openInApp.mockResolvedValueOnce({ success: true, message: 'Opened.' });

      const result = await vscodeTool.run(
        { path: '/Users/me/projects/client-a' } as unknown as Parameters<typeof vscodeTool.run>[0],
        { workspaceId: 'ws-1' },
      );

      expect(mockedWritePendingVscodeRestore).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('stages a restore file BEFORE opening VS Code when terminals are configured', async () => {
      const callOrder: string[] = [];
      mockedWritePendingVscodeRestore.mockImplementationOnce(async () => {
        callOrder.push('write');
      });
      openInApp.mockImplementationOnce(async () => {
        callOrder.push('open');
        return { success: true, message: 'Opened.' };
      });

      await vscodeTool.run(
        { path: '/Users/me/projects/client-a', terminals: [{ commands: ['npm run dev'] }] },
        { workspaceId: 'ws-1' },
      );

      expect(callOrder).toEqual(['write', 'open']);
      expect(mockedWritePendingVscodeRestore).toHaveBeenCalledWith('/Users/me/projects/client-a', {
        terminals: [{ commands: ['npm run dev'] }],
      });
    });

    it('fails loudly and never opens VS Code when staging the restore file fails', async () => {
      mockedWritePendingVscodeRestore.mockRejectedValueOnce(new Error('disk full'));

      const result = await vscodeTool.run(
        { path: '/Users/me/projects/client-a', terminals: [{ commands: ['npm run dev'] }] },
        { workspaceId: 'ws-1' },
      );

      expect(openInApp).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.message).toContain('disk full');
    });

    it('cleans up the staged restore file when openInApp fails after terminals were configured', async () => {
      openInApp.mockResolvedValueOnce({ success: false, message: 'app not found' });

      const result = await vscodeTool.run(
        { path: '/Users/me/projects/client-a', terminals: [{ commands: ['npm run dev'] }] },
        { workspaceId: 'ws-1' },
      );

      expect(mockedDeletePendingVscodeRestore).toHaveBeenCalledWith('/Users/me/projects/client-a');
      expect(result.success).toBe(false);
    });

    it('does not attempt cleanup when openInApp fails and there were no terminals to stage', async () => {
      openInApp.mockResolvedValueOnce({ success: false, message: 'app not found' });

      await vscodeTool.run(
        { path: '/Users/me/projects/client-a', terminals: [] },
        { workspaceId: 'ws-1' },
      );

      expect(mockedDeletePendingVscodeRestore).not.toHaveBeenCalled();
    });

    it('appends the manual-restore hint only when terminals were configured', async () => {
      openInApp.mockResolvedValue({ success: true, message: 'Opened.' });

      const withTerminals = await vscodeTool.run(
        { path: '/Users/me/projects/client-a', terminals: [{ commands: ['npm run dev'] }] },
        { workspaceId: 'ws-1' },
      );
      const withoutTerminals = await vscodeTool.run(
        { path: '/Users/me/projects/client-a', terminals: [] },
        { workspaceId: 'ws-1' },
      );

      expect(withTerminals.message).toContain('Restore Terminals');
      expect(withoutTerminals.message).not.toContain('Restore Terminals');
    });
  });

  describe('detail', () => {
    it('names the path', () => {
      expect(vscodeTool.detail?.({ path: '~/projects/client-a' })).toBe(
        'Opens ~/projects/client-a',
      );
    });

    it('degrades gracefully when path is missing/invalid raw input', () => {
      // detail() takes RAW params, not validated data — must never
      // throw on a hand-edited/legacy config that fails validate().
      expect(vscodeTool.detail?.({})).toBe('Opens the configured folder path.');
      expect(vscodeTool.detail?.({ path: 42 })).toBe('Opens the configured folder path.');
    });
  });

  describe('expand', () => {
    it('returns a Path row when path is present', () => {
      expect(vscodeTool.expand?.({ path: '~/projects/client-a' })).toEqual([
        { i: 'folder', label: 'Path', mono: '~/projects/client-a' },
      ]);
    });

    it('returns undefined when path is missing/invalid raw input', () => {
      expect(vscodeTool.expand?.({})).toBeUndefined();
      expect(vscodeTool.expand?.({ path: 42 })).toBeUndefined();
    });
  });

  describe('teardown', () => {
    it('is a successful no-op (Tier 2 not built yet)', async () => {
      const result = await vscodeTool.teardown({
        path: '/Users/me/projects/client-a',
        terminals: [],
      });
      expect(result.success).toBe(true);
    });
  });
});
