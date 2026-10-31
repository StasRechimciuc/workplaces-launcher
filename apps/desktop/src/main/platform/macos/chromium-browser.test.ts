import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shellExec from '../../lib/shell-exec';
import { placeholderUrl } from '../browser-placeholder';
import { createChromiumAdapter, parseWindows } from './chromium-browser';

vi.mock('../../lib/shell-exec', () => ({ runCommand: vi.fn() }));
const runCommand = vi.mocked(shellExec.runCommand);

const US = '\u001f';
const RS = '\u001e';
const record = (...fields: (string | number)[]): string => fields.join(US);

beforeEach(() => runCommand.mockReset());

describe('reading windows', () => {
  it('parses each window with its tabs, frame, name and active tab', () => {
    const output = [
      record('W', '672900223', 'VSC Test', 0, 33, 1470, 956, 'normal', 2),
      record('T', 'Python', 'https://www.python.org/'),
      record('T', 'Go', placeholderUrl('https://go.dev/', 'Go')),
      record('W', '7', '', 10, 20, 110, 220, 'incognito', 1),
    ].join(RS);
    expect(parseWindows(output)).toEqual([
      {
        scriptId: '672900223',
        name: 'VSC Test',
        frame: { x: 0, y: 33, width: 1470, height: 923 },
        incognito: false,
        activeTabIndex: 2,
        tabs: [
          { title: 'Python', url: 'https://www.python.org/' },
          // A placeholder never visited is saved as the tab it stands for.
          { title: 'Go', url: 'https://go.dev/' },
        ],
      },
      {
        scriptId: '7',
        name: '',
        frame: { x: 10, y: 20, width: 100, height: 200 },
        incognito: true,
        activeTabIndex: 1,
        tabs: [],
      },
    ]);
  });

  it('passes the browser and every value as arguments, never inside the script', async () => {
    runCommand.mockResolvedValue({ success: true, stdout: 'OK\n', stderr: '' });
    const adapter = createChromiumAdapter('Brave Browser');
    await adapter.nameWindow('42', '"; do shell script "rm -rf ~" --');
    const [command, args] = runCommand.mock.calls[0]!;
    expect(command).toBe('osascript');
    expect(args!.slice(2)).toEqual(['Brave Browser', '42', '"; do shell script "rm -rf ~" --']);
    expect(args![1]).not.toContain('rm -rf');
  });

  it('names a missing permission plainly, with where to turn it on', async () => {
    runCommand.mockResolvedValue({
      success: false,
      message: 'Command failed',
      stdout: '',
      stderr: 'execution error: Not authorized to send Apple events to Google Chrome. (-1743)',
      code: 1,
    });
    await expect(createChromiumAdapter('Google Chrome').readWindows()).resolves.toMatchObject({
      ok: false,
      code: 'denied',
      message: expect.stringContaining('Automation'),
    });
  });

  it('never launches a browser that isn’t running', async () => {
    runCommand.mockResolvedValue({ success: true, stdout: 'NOT-RUNNING\n', stderr: '' });
    await expect(createChromiumAdapter('Google Chrome').readWindows()).resolves.toMatchObject({
      ok: false,
      code: 'not-running',
    });
  });

  it('reports a window that’s gone instead of pretending it was named', async () => {
    runCommand.mockResolvedValue({ success: true, stdout: 'NO-WINDOW\n', stderr: '' });
    await expect(
      createChromiumAdapter('Google Chrome').nameWindow('1', 'x'),
    ).resolves.toMatchObject({
      ok: false,
      code: 'failed',
    });
  });
});
