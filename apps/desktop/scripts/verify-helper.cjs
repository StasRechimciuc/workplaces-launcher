// electron-builder afterPack hook (see electron-builder.yml): fails the
// macOS package outright unless the packed app really contains a
// runnable, universal wl-helper at Contents/Helpers/wl-helper.
//
// electron-builder only warns when an `extraFiles` source is missing,
// so without this check a build where `npm run build:helper` was
// skipped or failed would still produce an app — one where every
// window feature silently degrades to reduced mode on users' machines.

const { execFileSync } = require('node:child_process');
const { accessSync, constants } = require('node:fs');
const { join } = require('node:path');

const REQUIRED_ARCHS = ['arm64', 'x86_64'];

exports.default = async function verifyHelper(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const helper = join(context.appOutDir, appName, 'Contents', 'Helpers', 'wl-helper');

  try {
    accessSync(helper, constants.X_OK);
  } catch {
    throw new Error(
      `wl-helper is missing or not executable at ${helper}. Run "npm run build:helper" — package:mac must never ship without it.`,
    );
  }

  const archs = execFileSync('lipo', ['-archs', helper], { encoding: 'utf8' }).trim().split(/\s+/);
  const missing = REQUIRED_ARCHS.filter((arch) => !archs.includes(arch));
  if (missing.length > 0) {
    throw new Error(
      `wl-helper at ${helper} is missing architectures: ${missing.join(', ')} (has: ${archs.join(', ')}).`,
    );
  }
};
