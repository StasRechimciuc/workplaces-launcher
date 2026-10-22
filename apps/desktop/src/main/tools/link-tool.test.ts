import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@workspace-launcher/shared';
import { linkTool } from './link-tool';
import { getPlatformLauncher } from '../platform';
import * as fsPromises from 'node:fs/promises';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const openInApp = vi.fn();
const openFileDefault = vi.fn();
const openUrlDefault = vi.fn();
const stat = vi.mocked(fsPromises.stat);

beforeEach(() => {
  openInApp.mockReset();
  openFileDefault.mockReset();
  openUrlDefault.mockReset();
  stat.mockReset();
  mockedGetPlatformLauncher.mockReset().mockReturnValue({
    launchApp: vi.fn(),
    openInApp,
    openUrlInBrowserProfile: vi.fn(),
    openTerminal: vi.fn(),
    openFileDefault,
    openUrlDefault,
  });
});

describe('linkTool', () => {
  it('has type "link"', () => {
    expect(linkTool.type).toBe('link');
  });

  describe('validate', () => {
    it('accepts a valid https URL', () => {
      expect(linkTool.validate({ target: 'https://www.notion.so/My-Page-abc123' }).valid).toBe(
        true,
      );
    });

    it('accepts a valid http URL', () => {
      expect(linkTool.validate({ target: 'http://example.com' }).valid).toBe(true);
    });

    it('accepts an absolute file path', () => {
      expect(linkTool.validate({ target: '/Users/stas/Documents/plan.pdf' }).valid).toBe(true);
    });

    it('accepts a ~-form file path', () => {
      expect(linkTool.validate({ target: '~/Documents/plan.pdf' }).valid).toBe(true);
    });

    it('accepts an optional appPath', () => {
      const result = linkTool.validate({
        target: 'https://figma.com/file/abc',
        appPath: '/Applications/Figma.app',
      });
      expect(result).toEqual({
        valid: true,
        data: { target: 'https://figma.com/file/abc', appPath: '/Applications/Figma.app' },
      });
    });

    it('rejects a missing target', () => {
      expect(linkTool.validate({}).valid).toBe(false);
    });

    it('rejects an empty string target', () => {
      expect(linkTool.validate({ target: '' }).valid).toBe(false);
    });

    it('rejects a relative file path — resolves unpredictably, not an http(s) link either', () => {
      expect(linkTool.validate({ target: 'notes.txt' }).valid).toBe(false);
    });

    it('rejects a non-http(s) URL scheme', () => {
      expect(linkTool.validate({ target: 'mailto:someone@example.com' }).valid).toBe(false);
      expect(linkTool.validate({ target: 'ftp://files.example.com/x' }).valid).toBe(false);
      expect(linkTool.validate({ target: 'notion://doc/abc123' }).valid).toBe(false);
    });

    it('rejects a Windows-style path via the PATH-acceptability message, not the URL-scheme one — regression for a real classification bug', () => {
      // `new URL("C:\\Users\\...")` parses successfully with protocol
      // "c:" in Node's WHATWG URL implementation — without the
      // drive-letter check in classifyTarget, this would be wrongly
      // rejected as "must start with http://" instead of correctly
      // being treated as a file path (then rejected for not being
      // absolute on this non-Windows test machine, which is the
      // RIGHT reason). Confirms classifyTarget never sends a
      // Windows-style path down the "invalid URL scheme" branch.
      const result = linkTool.validate({ target: 'C:\\Users\\bob\\file.pdf' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join(' ')).toMatch(/must be absolute/);
        expect(result.errors.join(' ')).not.toMatch(/http/);
      }
    });

    it('rejects non-object input', () => {
      expect(linkTool.validate('nope').valid).toBe(false);
    });
  });

  describe('run — URL target', () => {
    it('opens with the default browser when no appPath is set', async () => {
      openUrlDefault.mockResolvedValueOnce({ success: true, message: 'Opened https://x.' });

      const result = await linkTool.run(
        { target: 'https://www.notion.so/My-Page' },
        { workspaceId: 'ws-1' },
      );

      expect(openUrlDefault).toHaveBeenCalledWith('https://www.notion.so/My-Page');
      expect(openInApp).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('opens with the chosen app when appPath is set — the real https link, not a synthesized custom-scheme one', async () => {
      openInApp.mockResolvedValueOnce({ success: true, message: 'Opened in Figma.' });

      const result = await linkTool.run(
        { target: 'https://www.figma.com/file/abc123/MyProject', appPath: '/Applications/Figma.app' },
        { workspaceId: 'ws-1' },
      );

      expect(openInApp).toHaveBeenCalledWith(
        '/Applications/Figma.app',
        'https://www.figma.com/file/abc123/MyProject',
      );
      expect(openUrlDefault).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('surfaces a failed open as a failed StepResult with the link error code', async () => {
      openUrlDefault.mockResolvedValueOnce({ success: false, message: 'blocked' });

      const result = await linkTool.run({ target: 'https://example.com' }, { workspaceId: 'ws-1' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('blocked');
      expect(result.code).toBe(ERROR_CODES.LINK_OPEN_FAILED.code);
    });
  });

  describe('run — file target', () => {
    it('checks existence, then opens with the OS default when no appPath is set', async () => {
      stat.mockResolvedValueOnce({} as never);
      openFileDefault.mockResolvedValueOnce({ success: true, message: 'Opened.' });

      const result = await linkTool.run(
        { target: '/Users/stas/Documents/plan.pdf' },
        { workspaceId: 'ws-1' },
      );

      expect(stat).toHaveBeenCalledWith('/Users/stas/Documents/plan.pdf');
      expect(openFileDefault).toHaveBeenCalledWith('/Users/stas/Documents/plan.pdf');
      expect(openInApp).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('opens with the chosen app when appPath is set', async () => {
      stat.mockResolvedValueOnce({} as never);
      openInApp.mockResolvedValueOnce({ success: true, message: 'Opened in Preview.' });

      const result = await linkTool.run(
        { target: '/Users/stas/Documents/plan.pdf', appPath: '/Applications/Preview.app' },
        { workspaceId: 'ws-1' },
      );

      expect(openInApp).toHaveBeenCalledWith(
        '/Applications/Preview.app',
        '/Users/stas/Documents/plan.pdf',
      );
      expect(openFileDefault).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('expands a leading ~ before checking existence and opening', async () => {
      stat.mockResolvedValueOnce({} as never);
      openFileDefault.mockResolvedValueOnce({ success: true, message: 'Opened.' });

      await linkTool.run({ target: '~/Documents/plan.pdf' }, { workspaceId: 'ws-1' });

      const [statArg] = stat.mock.calls[0]!;
      expect(statArg).not.toBe('~/Documents/plan.pdf');
      expect(String(statArg)).toContain('/Documents/plan.pdf');
      expect(openFileDefault).toHaveBeenCalledWith(statArg);
    });

    it('fails loudly, naming the exact configured path, when the file no longer exists — never silently skips or opens something else', async () => {
      stat.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await linkTool.run(
        { target: '/Users/stas/Documents/gone.pdf' },
        { workspaceId: 'ws-1' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('/Users/stas/Documents/gone.pdf');
      expect(result.code).toBe(ERROR_CODES.LINK_TARGET_NOT_FOUND.code);
      expect(openFileDefault).not.toHaveBeenCalled();
      expect(openInApp).not.toHaveBeenCalled();
    });

    it('surfaces a failed open as a failed StepResult with the link error code', async () => {
      stat.mockResolvedValueOnce({} as never);
      openFileDefault.mockResolvedValueOnce({ success: false, message: 'no handler app' });

      const result = await linkTool.run(
        { target: '/Users/stas/Documents/plan.psd' },
        { workspaceId: 'ws-1' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('no handler app');
      expect(result.code).toBe(ERROR_CODES.LINK_OPEN_FAILED.code);
    });
  });

  describe('teardown', () => {
    it('is a successful no-op (Tier 2 not built yet)', async () => {
      const result = await linkTool.teardown({ target: 'https://example.com' });
      expect(result.success).toBe(true);
    });
  });

  describe('detail', () => {
    it('describes the configured target', () => {
      expect(linkTool.detail?.({ target: 'https://example.com' })).toBe('Opens https://example.com.');
    });

    it('names the chosen app when appPath is set', () => {
      expect(
        linkTool.detail?.({
          target: 'https://www.figma.com/file/abc',
          appPath: '/Applications/Figma.app',
        }),
      ).toBe('Opens https://www.figma.com/file/abc with Figma.');
    });

    it('falls back to a generic message when target is missing or not a string', () => {
      expect(linkTool.detail?.({})).toBe('Opens a file or link.');
      expect(linkTool.detail?.({ target: 42 })).toBe('Opens a file or link.');
    });
  });

  describe('expand', () => {
    it('returns the target row only when no appPath is set', () => {
      expect(linkTool.expand?.({ target: 'https://example.com' })).toEqual([
        { i: 'externalLink', label: 'Opens', mono: 'https://example.com' },
      ]);
    });

    it('returns both rows when appPath is set', () => {
      expect(
        linkTool.expand?.({
          target: 'https://www.figma.com/file/abc',
          appPath: '/Applications/Figma.app',
        }),
      ).toEqual([
        { i: 'externalLink', label: 'Opens', mono: 'https://www.figma.com/file/abc' },
        { i: 'appWindow', label: 'With', mono: 'Figma' },
      ]);
    });

    it('returns undefined when target is missing or not a string', () => {
      expect(linkTool.expand?.({})).toBeUndefined();
      expect(linkTool.expand?.({ target: 42 })).toBeUndefined();
    });
  });
});
