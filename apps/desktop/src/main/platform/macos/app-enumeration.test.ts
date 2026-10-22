import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listForegroundApps } from './app-enumeration';
import * as shellExec from '../../lib/shell-exec';

vi.mock('../../lib/shell-exec', () => ({
  runCommand: vi.fn(),
}));

const runCommand = vi.mocked(shellExec.runCommand);

beforeEach(() => {
  runCommand.mockClear();
});

// A real, captured `lsappinfo list` excerpt — a mix of Foreground apps,
// a UIElement system helper, and a BackgroundOnly child process (a node
// process spawned under VS Code's own coalition) — exactly the shape
// the Foreground filter exists to separate.
const REAL_LSAPPINFO_EXCERPT = `
 1) "loginwindow" ASN:0x0-0x2002:
    bundleID="com.apple.loginwindow"
    bundle path="/System/Library/CoreServices/loginwindow.app"
    executable path="/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow"
    pid = 598 type="UIElement" flavor=3 Version="3085.6.3" fileType="APPL" creator="lgnw" Arch=ARM64
    checkin time = 2026/08/25 03:09:51
 40) "Google Chrome" ASN:0x0-0x2de3de1:
    bundleID="com.google.Chrome"
    bundle path="/Applications/Google Chrome.app"
    executable path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    pid = 54081 type="Foreground" flavor=3 Version="8037.58" fileType="APPL" creator="rimZ" Arch=ARM64
    coalition: 109117
 59) "Code" ASN:0x0-0x6e36e30: (in front)
    bundleID="com.microsoft.VSCode"
    bundle path="/Applications/Visual Studio Code.app"
    executable path="/Applications/Visual Studio Code.app/Contents/MacOS/Code"
    pid = 10233 type="Foreground" flavor=3 Version="1.142.0" fileType="APPL" creator="????" Arch=ARM64
    coalition: 232957
 61) "npm run dev" ASN:0x0-0x6e3be35:
    bundleID=[ NULL ]
    bundle path="/Users/stas/.nvm/versions/node/v24.19.0/bin/node"
    executable path="/Users/stas/.nvm/versions/node/v24.19.0/bin/node"
    pid = 14553 !cgsConnection !signalled type="BackgroundOnly" flavor=[ NULL ]  Version=[ NULL ]  Arch=ARM64
    parentASN="Code" ASN:0x0-0x6e36e30:
 53) "Terminal" ASN:0x0-0x626d267:
    bundleID="com.apple.Terminal"
    bundle path="/System/Applications/Utilities/Terminal.app"
    executable path="/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"
    pid = 54089 type="Foreground" flavor=3 Version="470.2" fileType="APPL" creator="????" Arch=ARM64
    coalition: 219075
`;

describe('listForegroundApps', () => {
  it('parses real lsappinfo output, keeping only type="Foreground" entries', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: REAL_LSAPPINFO_EXCERPT, stderr: '' });

    const result = await listForegroundApps();

    expect(result).toEqual({
      success: true,
      apps: [
        {
          name: 'Google Chrome',
          bundleId: 'com.google.Chrome',
          bundlePath: '/Applications/Google Chrome.app',
        },
        {
          name: 'Code',
          bundleId: 'com.microsoft.VSCode',
          bundlePath: '/Applications/Visual Studio Code.app',
        },
        {
          name: 'Terminal',
          bundleId: 'com.apple.Terminal',
          bundlePath: '/System/Applications/Utilities/Terminal.app',
        },
      ],
    });
  });

  it('excludes a UIElement system helper (loginwindow)', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: REAL_LSAPPINFO_EXCERPT, stderr: '' });

    const result = await listForegroundApps();

    expect(result.apps.find((a) => a.name === 'loginwindow')).toBeUndefined();
  });

  it('excludes a BackgroundOnly child process (a node process under VS Code\'s coalition)', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: REAL_LSAPPINFO_EXCERPT, stderr: '' });

    const result = await listForegroundApps();

    expect(result.apps.find((a) => a.name === 'npm run dev')).toBeUndefined();
  });

  it('reports success:false, not a throw and not success:true with an empty list, when lsappinfo itself fails', async () => {
    runCommand.mockResolvedValueOnce({
      success: false,
      message: 'command not found',
      stdout: '',
      stderr: '',
      code: 127,
    });

    // A total detection failure must be distinguishable from "genuinely
    // nothing is open" — collapsing both into the same empty-list shape
    // would let a broken lsappinfo call silently look like a clean,
    // successful scan that just found nothing.
    expect(await listForegroundApps()).toEqual({ success: false, apps: [] });
  });

  it('reports success:true with an empty list for empty or unparseable output — lsappinfo itself ran fine', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
    expect(await listForegroundApps()).toEqual({ success: true, apps: [] });
  });

  it('treats a missing bundleID (bundleID=[ NULL ]) as undefined, not a literal string', async () => {
    runCommand.mockResolvedValueOnce({
      success: true,
      stdout: `
 61) "a-tool" ASN:0x0-0x1:
    bundleID=[ NULL ]
    bundle path="/usr/local/bin/a-tool"
    pid = 1 type="Foreground"
`,
      stderr: '',
    });

    const result = await listForegroundApps();

    expect(result.apps).toEqual([{ name: 'a-tool', bundleId: undefined, bundlePath: '/usr/local/bin/a-tool' }]);
  });
});
