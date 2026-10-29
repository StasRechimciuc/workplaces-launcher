import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@workspace-launcher/shared';
import { terminalTool } from './terminal-tool';
import { getPlatformLauncher } from '../platform';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const openTerminal = vi.fn();

beforeEach(() => {
  openTerminal.mockReset();
  mockedGetPlatformLauncher.mockReset();
  mockedGetPlatformLauncher.mockReturnValue({
    launchApp: vi.fn(),
    openInApp: vi.fn(),
    openUrlInBrowserProfile: vi.fn(),
    openTerminal,
    openFileDefault: vi.fn(),
    openUrlDefault: vi.fn(),
  });
});

describe('terminalTool', () => {
  it('has type "terminal"', () => {
    expect(terminalTool.type).toBe('terminal');
  });

  describe('validate', () => {
    it('accepts an empty object, defaulting terminals to []', () => {
      expect(terminalTool.validate({})).toEqual({ valid: true, data: { terminals: [] } });
    });

    it('accepts a terminal with an absolute cwd and zero or more commands', () => {
      const result = terminalTool.validate({
        terminals: [{ cwd: '/Users/stas/projects/x', commands: ['npm run dev'] }],
      });
      expect(result).toEqual({
        valid: true,
        data: { terminals: [{ cwd: '/Users/stas/projects/x', commands: ['npm run dev'] }] },
      });
    });

    it('accepts a ~-prefixed cwd', () => {
      expect(
        terminalTool.validate({ terminals: [{ cwd: '~/projects/x', commands: [] }] }).valid,
      ).toBe(true);
    });

    it('accepts a bare "~" as cwd', () => {
      expect(terminalTool.validate({ terminals: [{ cwd: '~', commands: [] }] }).valid).toBe(true);
    });

    it("rejects a relative cwd — same precedent as vscode-tool.ts's path field", () => {
      const result = terminalTool.validate({ terminals: [{ cwd: 'projects/x', commands: [] }] });
      expect(result.valid).toBe(false);
    });

    it('rejects a whitespace-only command', () => {
      const result = terminalTool.validate({
        terminals: [{ cwd: '~/x', commands: ['   '] }],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects a command containing a newline', () => {
      const result = terminalTool.validate({
        terminals: [{ cwd: '~/x', commands: ['npm run dev\nrm -rf /'] }],
      });
      expect(result.valid).toBe(false);
    });

    it('trims incidental whitespace off a command', () => {
      const result = terminalTool.validate({
        terminals: [{ cwd: '~/x', commands: ['  npm run dev  '] }],
      });
      expect(result).toEqual({
        valid: true,
        data: { terminals: [{ cwd: '~/x', commands: ['npm run dev'] }] },
      });
    });

    it('accepts exactly 8 terminals', () => {
      const terminals = Array.from({ length: 8 }, () => ({ cwd: '~/x', commands: [] }));
      expect(terminalTool.validate({ terminals }).valid).toBe(true);
    });

    it('rejects more than 8 terminals', () => {
      const terminals = Array.from({ length: 9 }, () => ({ cwd: '~/x', commands: [] }));
      expect(terminalTool.validate({ terminals }).valid).toBe(false);
    });

    it('rejects non-object input', () => {
      expect(terminalTool.validate('nope').valid).toBe(false);
    });
  });

  describe('run', () => {
    it('is a successful no-op when no terminals are configured', async () => {
      const result = await terminalTool.run({ terminals: [] }, { workspaceId: 'ws-1' });

      expect(result.success).toBe(true);
      expect(result.message).toBe('No terminals configured for this step.');
      expect(openTerminal).not.toHaveBeenCalled();
    });

    it('opens each terminal via the platform launcher, in order', async () => {
      openTerminal.mockResolvedValue({ success: true, message: 'Opened a terminal.' });

      const result = await terminalTool.run(
        {
          terminals: [
            { cwd: '~/a', commands: ['npm run dev'] },
            { cwd: '~/b', commands: [] },
          ],
        },
        { workspaceId: 'ws-1' },
      );

      expect(openTerminal).toHaveBeenNthCalledWith(1, '~/a', ['npm run dev'], {
        marker: expect.stringMatching(/^wl-[0-9a-f]{12}$/),
      });
      expect(openTerminal).toHaveBeenNthCalledWith(2, '~/b', [], {
        marker: expect.stringMatching(/^wl-[0-9a-f]{12}$/),
      });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Opened 2 terminals.');
    });

    it("opens the rest even when one terminal fails, aggregating the failure — same precedent as chrome-tool.ts's multi-url handling", async () => {
      openTerminal
        .mockResolvedValueOnce({ success: true, message: 'Opened a terminal.' })
        .mockResolvedValueOnce({
          success: false,
          message: '"~/gone" doesn\'t exist.',
          detail: {
            cwd: '~/gone',
            openFailed: { stage: 'cd', reason: '"~/gone" doesn\'t exist.' },
            commands: [],
          },
        });

      const result = await terminalTool.run(
        {
          terminals: [
            { cwd: '~/a', commands: [] },
            { cwd: '~/gone', commands: [] },
          ],
        },
        { workspaceId: 'ws-1' },
      );

      expect(openTerminal).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(false);
      expect(result.message).toBe('Opened 1 of 2 terminal(s); failed: "~/gone" doesn\'t exist.');
      expect(result.code).toBe(ERROR_CODES.TERMINAL_START_FAILED.code);
    });

    it('picks TERMINAL_COMMAND_FAILED when a command actually ran and failed, not TERMINAL_START_FAILED', async () => {
      openTerminal.mockResolvedValueOnce({
        success: false,
        message:
          '"npm run dev" failed with exit code 127 shortly after the terminal at ~/a opened.',
        detail: {
          cwd: '~/a',
          commands: [
            {
              index: 0,
              command: 'npm run dev',
              status: 'failed',
              exitCode: 127,
              reason: 'zsh: command not found: npm',
            },
          ],
        },
      });

      const result = await terminalTool.run(
        { terminals: [{ cwd: '~/a', commands: ['npm run dev'] }] },
        { workspaceId: 'ws-1' },
      );

      expect(result.code).toBe(ERROR_CODES.TERMINAL_COMMAND_FAILED.code);
    });

    it("picks TERMINAL_COMMAND_FAILED when the FIRST failed entry never started but a LATER entry's command did run and fail", async () => {
      openTerminal
        .mockResolvedValueOnce({
          success: false,
          message: '"~/gone" doesn\'t exist.',
          detail: {
            cwd: '~/gone',
            openFailed: { stage: 'cd', reason: '"~/gone" doesn\'t exist.' },
            commands: [],
          },
        })
        .mockResolvedValueOnce({
          success: false,
          message:
            '"npm run dev" failed with exit code 127 shortly after the terminal at ~/b opened.',
          detail: {
            cwd: '~/b',
            commands: [
              {
                index: 0,
                command: 'npm run dev',
                status: 'failed',
                exitCode: 127,
                reason: 'zsh: command not found: npm',
              },
            ],
          },
        });

      const result = await terminalTool.run(
        {
          terminals: [
            { cwd: '~/gone', commands: [] },
            { cwd: '~/b', commands: ['npm run dev'] },
          ],
        },
        { workspaceId: 'ws-1' },
      );

      // The real command failure (entry 2) is the more specific, more
      // actionable case — it must win even though entry 1 (a "never
      // started" failure) comes first in the array.
      expect(result.code).toBe(ERROR_CODES.TERMINAL_COMMAND_FAILED.code);
    });

    it('builds StepResult.details.entries with one entry per terminal — a successful entry synthesized from params, a failed one passed through verbatim', async () => {
      const failedDetail = {
        cwd: '~/b',
        commands: [
          {
            index: 0,
            command: 'npm run dev',
            status: 'failed',
            exitCode: 127,
            reason: 'zsh: command not found: npm',
          },
        ],
      };
      openTerminal
        .mockResolvedValueOnce({ success: true, message: 'Opened a terminal.' })
        .mockResolvedValueOnce({
          success: false,
          message:
            '"npm run dev" failed with exit code 127 shortly after the terminal at ~/b opened.',
          detail: failedDetail,
        });

      const result = await terminalTool.run(
        {
          terminals: [
            { cwd: '~/a', commands: ['npm i'] },
            { cwd: '~/b', commands: ['npm run dev'] },
          ],
        },
        { workspaceId: 'ws-1' },
      );

      expect(result.details).toEqual({
        entries: [
          { cwd: '~/a', commands: [{ index: 0, command: 'npm i', status: 'success' }] },
          failedDetail,
        ],
      });
    });

    it('uses singular wording for exactly one terminal', async () => {
      openTerminal.mockResolvedValueOnce({ success: true, message: 'Opened a terminal.' });

      const result = await terminalTool.run(
        { terminals: [{ cwd: '~/a', commands: [] }] },
        { workspaceId: 'ws-1' },
      );

      expect(result.message).toBe('Opened 1 terminal.');
    });

    it('reports failure correctly when every terminal fails, not just a partial failure', async () => {
      openTerminal
        .mockResolvedValueOnce({
          success: false,
          message: '"~/gone-a" doesn\'t exist.',
          detail: {
            cwd: '~/gone-a',
            openFailed: { stage: 'cd', reason: '"~/gone-a" doesn\'t exist.' },
            commands: [],
          },
        })
        .mockResolvedValueOnce({
          success: false,
          message: '"~/gone-b" doesn\'t exist.',
          detail: {
            cwd: '~/gone-b',
            openFailed: { stage: 'cd', reason: '"~/gone-b" doesn\'t exist.' },
            commands: [],
          },
        });

      const result = await terminalTool.run(
        {
          terminals: [
            { cwd: '~/gone-a', commands: [] },
            { cwd: '~/gone-b', commands: [] },
          ],
        },
        { workspaceId: 'ws-1' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        'Opened 0 of 2 terminal(s); failed: "~/gone-a" doesn\'t exist.; "~/gone-b" doesn\'t exist.',
      );
      expect(result.code).toBe(ERROR_CODES.TERMINAL_START_FAILED.code);
    });

    it('truly runs sequentially — the second terminal is not opened until the first resolves', async () => {
      const order: string[] = [];
      let resolveFirst!: () => void;
      const firstPending = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      openTerminal.mockImplementationOnce(async () => {
        order.push('a-start');
        await firstPending;
        order.push('a-end');
        return { success: true, message: 'Opened a terminal.' };
      });
      openTerminal.mockImplementationOnce(async () => {
        order.push('b-start');
        return { success: true, message: 'Opened a terminal.' };
      });

      const runPromise = terminalTool.run(
        {
          terminals: [
            { cwd: '~/a', commands: [] },
            { cwd: '~/b', commands: [] },
          ],
        },
        { workspaceId: 'ws-1' },
      );

      // Give the first call's synchronous prefix a chance to run, then
      // confirm the second hasn't started yet — a Promise.all-based
      // implementation would have started both immediately.
      await Promise.resolve();
      await Promise.resolve();
      expect(order).toEqual(['a-start']);

      resolveFirst();
      await runPromise;

      expect(order).toEqual(['a-start', 'a-end', 'b-start']);
    });
  });

  describe('teardown', () => {
    it('is a successful no-op (Tier 2 not built yet)', async () => {
      const result = await terminalTool.teardown({ terminals: [] });
      expect(result.success).toBe(true);
    });
  });

  describe('detail', () => {
    it('reports no terminals configured when empty', () => {
      expect(terminalTool.detail?.({})).toBe('No terminals configured.');
      expect(terminalTool.detail?.({ terminals: [] })).toBe('No terminals configured.');
    });

    it('reports a singular/plural terminal count', () => {
      expect(terminalTool.detail?.({ terminals: [{ cwd: '~/x' }] })).toBe('Opens 1 terminal.');
      expect(terminalTool.detail?.({ terminals: [{ cwd: '~/x' }, { cwd: '~/y' }] })).toBe(
        'Opens 2 terminals.',
      );
    });

    it('never throws on garbage/legacy params, filtering out non-object entries', () => {
      expect(terminalTool.detail?.({ terminals: 'not-an-array' })).toBe('No terminals configured.');
      // 1 and 'x' and null aren't objects — filtered out entirely, not
      // counted as (malformed) terminals.
      expect(terminalTool.detail?.({ terminals: [1, 'x', null] })).toBe('No terminals configured.');
    });

    it('filters out an array-shaped entry rather than counting it as a phantom terminal', () => {
      expect(terminalTool.detail?.({ terminals: [[1, 2]] })).toBe('No terminals configured.');
    });
  });

  describe('expand', () => {
    it('returns undefined when no terminals are configured', () => {
      expect(terminalTool.expand?.({})).toBeUndefined();
      expect(terminalTool.expand?.({ terminals: [] })).toBeUndefined();
    });

    it('returns one row per terminal, with its cwd and joined commands', () => {
      const rows = terminalTool.expand?.({
        terminals: [
          { cwd: '~/a', commands: ['npm i', 'npm run dev'] },
          { cwd: '~/b', commands: [] },
        ],
      });

      expect(rows).toEqual([
        { i: 'terminal', label: 'Terminal 1', mono: '~/a — npm i && npm run dev' },
        { i: 'terminal', label: 'Terminal 2', mono: '~/b' },
      ]);
    });

    it('never throws on garbage/legacy params, filtering out non-object entries', () => {
      expect(terminalTool.expand?.({ terminals: 'not-an-array' })).toBeUndefined();
      // null isn't an object — filtered out entirely; { cwd: 42 } is an
      // object but its cwd isn't a string, so it degrades to ''.
      expect(terminalTool.expand?.({ terminals: [null, { cwd: 42 }] })).toEqual([
        { i: 'terminal', label: 'Terminal 1', mono: '' },
      ]);
    });
  });
});
