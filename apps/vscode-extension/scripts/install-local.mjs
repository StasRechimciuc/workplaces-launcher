// Packages this extension as a .vsix and installs it into the local VS
// Code — the one-command way to get the companion extension into your
// everyday editor (not just the F5 Extension Development Host). Run
// from the repo root: `npm run install:vscode-extension`.
//
// The `code` CLI is taken from PATH if present, otherwise from the
// standard VS Code app bundle, so this works without the user having
// run "Shell Command: Install 'code' command in PATH".

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const vsix = join(extensionDir, 'dist', 'workspace-launcher-vscode.vsix');
const BUNDLED_CODE_CLI = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';

function fail(message) {
  console.error(`install-local: ${message}`);
  process.exit(1);
}

function run(command, args) {
  try {
    execFileSync(command, args, { cwd: extensionDir, stdio: 'inherit' });
  } catch (err) {
    fail(
      `${command} ${args.join(' ')} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function findCodeCli() {
  try {
    execFileSync('code', ['--version'], { stdio: 'ignore' });
    return 'code';
  } catch {
    if (existsSync(BUNDLED_CODE_CLI)) return BUNDLED_CODE_CLI;
    return null;
  }
}

const code = findCodeCli();
if (!code) {
  fail("couldn't find VS Code's `code` command (not on PATH, and VS Code isn't in /Applications).");
}

run('node', ['esbuild.mjs']);
run('npx', [
  'vsce',
  'package',
  '--no-dependencies',
  '--allow-missing-repository',
  '--skip-license',
  '--out',
  vsix,
]);
run(code, ['--install-extension', vsix, '--force']);
console.log(
  'install-local: installed — reload any open VS Code windows (Developer: Reload Window) to start it.',
);
